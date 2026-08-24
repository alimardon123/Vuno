// Vuno — browser smoke test.
//
// The definition of done says "verified in a real browser against real data".
// That verification kept living in a scratch directory and dying with the
// session, so the same four bugs could come back unnoticed: a link to a
// conversation that does not exist, a message posting as "Unknown", a
// hydration mismatch throwing away the page, and a three-column desktop layout
// squeezed onto a phone.
//
// Run against a server you already started:
//   bun run dev        # in one terminal
//   bun run smoke      # in another
//
// It needs a Chromium. Playwright's default location is used unless
// PLAYWRIGHT_CHROMIUM is set. Nothing here is wired into `bun run check`:
// that stays fast and browserless.

import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
// Nothing is reachable signed out, so the run signs in first. On a freshly
// seeded org it claims the owner account; after that it signs in with what it
// set. Override both for an instance that already has real accounts.
const EMAIL = process.env.SMOKE_EMAIL ?? 'kai@acme.storage';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'smoke-test-password';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM;

const failures: string[] = [];
const checks: string[] = [];
/** Cookies from the signed-in session, reused by every context and every fetch. */
let storageState: Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>;
let cookieHeader = '';

function check(ok: boolean, what: string, detail = '') {
  if (ok) checks.push(what);
  else failures.push(detail ? `${what} — ${detail}` : what);
}

/** Records every way a page can be broken without looking broken. */
function watch(page: Page, problems: string[]) {
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text().split('\n')[0]}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
}

/**
 * `waitUntil: 'networkidle'` cannot be used here. A conversation holds an SSE
 * connection open for as long as it is on screen (src/app/api/stream), so the
 * network is never idle and every navigation would sit until it timed out.
 * Waiting for the app shell to render is the actual condition anyway.
 */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.locator('nav[aria-label="Sections"]').waitFor({ timeout: 15_000 });

  // Then wait for the page to stop moving, which is what a person does before
  // clicking anything. Two things move it: images arriving reflow the messages
  // above them, and React has not attached a single handler until it hydrates.
  // Clicking into that window is not a realistic test — it found a real jump on
  // first paint, which is fixed, and then kept failing on the part that is
  // simply a page still loading.
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(350);
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}


// ── Nothing is reachable signed out ─────────────────────────────────────────
//
// This is also the check that catches an auth path that only works in tests:
// the first version hashed with `Bun.password`, which is undefined inside
// Next's runtime, so every unit test passed against an app that returned 500.
async function signIn(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Signed out, a page redirects and an API call is refused.
  await page.goto(`${BASE}/ledger`, { waitUntil: 'domcontentloaded' });
  check(page.url().includes('/sign-in'), 'a page is not reachable signed out');
  check(page.url().includes('next='), 'it remembers where you were going');

  const refused = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: 'ch-storage', body: 'should not work' }),
  });
  check(refused.status === 401, 'an API call is refused signed out', `got ${refused.status}`);

  await page.waitForTimeout(1_200); // hydrate before typing into it
  const firstRun = (await page.getByText('Set a password').count()) > 0;

  if (firstRun) {
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Again').fill(PASSWORD);
    await page.getByRole('button', { name: /Set it/ }).click();
  } else {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  try {
    await page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20_000 });
  } catch {
    const said = await page.getByRole('alert').first().innerText().catch(() => '');
    check(false, firstRun ? 'the first run can claim the owner account' : 'signing in works', said || 'it never left the sign-in page');
    await ctx.close();
    return false;
  }

  check(true, firstRun ? 'the first run claims the owner account' : 'signing in works');
  check(page.url().endsWith('/ledger'), 'signing in lands where you were going');

  storageState = await ctx.storageState();
  cookieHeader = storageState.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  await ctx.close();
  return true;
}

// ── Every route reachable from the rail, and every link on it ────────────────
async function crawl(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  const problems: string[] = [];
  watch(page, problems);

  const seen = new Set<string>();
  for (const start of ['/activity', '/chats', '/channels', '/work', '/members', '/ledger']) {
    await open(page, start);
    seen.add(start);
    const hrefs = await page.$$eval('a[href^="/"]', (as) =>
      [...new Set(as.map((a) => a.getAttribute('href') ?? ''))].filter(Boolean),
    );
    for (const href of hrefs) {
      if (seen.has(href)) continue;
      seen.add(href);
      await open(page, href);
      const over = await overflow(page);
      if (over > 0) problems.push(`horizontal overflow on ${href}: ${over}px`);

      // A link with a fragment has to land on something.
      const [, id] = href.split('#');
      if (id) {
        const present = await page.evaluate((i) => !!document.getElementById(i), id);
        if (!present) problems.push(`${href} points at an element that does not exist`);
      }
    }
  }

  check(seen.size >= 10, `crawled ${seen.size} routes`, `only reached ${seen.size}`);
  check(problems.length === 0, 'no page errors, no 4xx, no overflow, no dangling anchors', problems.slice(0, 8).join('; '));
  await ctx.close();
}

// ── Posting a message, by button and by keyboard, attributed to a person ─────
async function posting(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/chats');
  const first = page.locator('a[href^="/chats/"]').first();
  if ((await first.count()) === 0) {
    check(false, 'a conversation exists to post into', 'the Chats pane listed none');
    await ctx.close();
    return;
  }
  await first.click();
  await page.waitForTimeout(600);

  const box = page.locator('textarea');
  const typed = `smoke ${Date.now()}`;
  await box.fill(typed);
  await page.getByRole('button', { name: /send/i }).click();
  await page.waitForTimeout(2500);

  // It lands twice — in the stream and in the sidebar preview — which is the
  // preview doing its job, so match the first rather than demanding one.
  check(await page.getByText(typed).first().isVisible(), 'a message sent with the button appears');
  check((await box.inputValue()) === '', 'the composer clears after sending');

  const shortcut = `smoke-kbd ${Date.now()}`;
  await box.fill(shortcut);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(2500);
  check(await page.getByText(shortcut).first().isVisible(), 'a message sent with ⌘↵/Ctrl↵ appears');

  // The event has to name who wrote it — an unattributed one renders "Unknown".
  const unattributed = await page.getByText('Unknown').count();
  check(unattributed === 0, 'every message names its author', `${unattributed} rendered as "Unknown"`);
  await ctx.close();
}


// ── Something posted elsewhere shows up here, without a reload ───────────────
//
// This matters more than it looks: an agent answering an @mention runs in the
// orchestrator and lands seconds later. Without this, the reply is invisible
// until someone reloads the page, and the org appears not to have answered.
async function liveUpdates(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  await open(page, '/channels');

  const first = page.locator('a[href^="/channels/"]').first();
  if ((await first.count()) === 0) {
    check(false, 'a channel exists to watch', 'the Channels pane listed none');
    await ctx.close();
    return;
  }
  await first.click();
  await page.waitForTimeout(800);
  const channelId = page.url().split('/channels/')[1]?.split('?')[0];

  // Posted from outside the browser entirely: another person, another tab, an agent.
  const text = `live ${Date.now()}`;
  const posted = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ channelId, body: text }),
  });
  check(posted.ok, 'a message can be posted out of band');

  try {
    // No reload, no interaction — the page updates itself.
    await page.getByText(text).first().waitFor({ timeout: 15_000 });
    check(true, 'a message posted elsewhere appears without a reload');
  } catch {
    check(false, 'a message posted elsewhere appears without a reload', 'it never arrived');
  }
  await ctx.close();
}

// ── A phone shows one column, and can get back from it ───────────────────────
async function phone(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState,
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  watch(page, problems);

  for (const r of ['/activity', '/work', '/members', '/ledger', '/chats', '/channels']) {
    await open(page, r);
    const over = await overflow(page);
    if (over > 0) problems.push(`${r}: ${over}px`);
  }
  check(problems.length === 0, 'no horizontal overflow on a 390px screen', problems.join('; '));

  await open(page, '/chats');
  const pane = page.locator('aside[aria-label="Chats"]');
  const listWidth = await pane.evaluate((el) => el.getBoundingClientRect().width);
  check(listWidth > 300, 'the list fills the screen rather than a sliver', `${listWidth}px`);

  await page.locator('a[href^="/chats/"]').first().click();
  await page.waitForTimeout(800);
  check(!(await pane.isVisible()), 'the list steps aside for an open conversation');

  const back = page.getByRole('link', { name: /back to chats/i });
  check((await back.count()) > 0, 'an open conversation has a way back');
  if ((await back.count()) > 0) {
    await back.click();
    await page.waitForTimeout(800);
    check(page.url().endsWith('/chats'), 'back returns to the list');
  }
  await ctx.close();
}


// ── A busy conversation: newest first, bounded DOM, and a smooth scroll ──────
//
// The claim is 60 fps at 5,000 messages. Seed one with
// `bun run scripts/load-messages.ts 5000 ch-storage` before running this;
// without it the check reports what it found and passes, rather than
// pretending it measured something.
async function busyConversation(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  await open(page, '/channels/ch-storage');

  const rendered = await page.locator('main p').count();
  const earlier = page.getByRole('link', { name: 'Earlier messages' });
  const isBusy = (await earlier.count()) > 0;

  if (!isBusy) {
    checks.push(`#storage-engine holds one window (${rendered} messages) — nothing to stress`);
    await ctx.close();
    return;
  }

  // However long the conversation, the DOM holds a window, not the log.
  check(rendered <= 260, 'the DOM holds a bounded window, not the whole log', `${rendered} paragraphs`);

  const newest = await page.locator('main p').last().innerText();

  // The claim being tested is that a point in a long conversation is a URL
  // somebody can send, so the URL is what gets exercised — the link is read off
  // the page and followed, rather than clicked. Clicking it tested Next's
  // client-side navigation finishing inside an arbitrary timeout, which on a
  // two-hundred-message window in dev it sometimes does not.
  const href = await earlier.getAttribute('href');
  check(/\?before=\d+/.test(href ?? ''), 'earlier messages is a URL, not a gesture', String(href));
  await open(page, href ?? '');

  check(/\?before=\d+/.test(page.url()), 'a point in history is a URL someone can send');
  check((await page.locator('main p').last().innerText()) !== newest, 'the window actually moves back');

  const jump = page.getByRole('link', { name: 'Jump to the latest' });
  check((await jump.count()) > 0, 'there is a way back to the live end');
  await open(page, (await jump.getAttribute('href')) ?? '');
  check((await page.locator('main p').last().innerText()) === newest, 'jumping returns to the newest message');

  // Frame budget while scrolling the stream.
  const frames = await page.evaluate(async () => {
    const el = [...document.querySelectorAll('*')].find(
      (e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible',
    );
    if (!el) return null;
    const times: number[] = [];
    let last = performance.now();
    let running = true;
    const tick = (now: number) => {
      times.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    el.scrollTop = 0;
    const step = (el.scrollHeight - el.clientHeight) / 60;
    for (let i = 0; i < 60; i++) {
      el.scrollTop += step;
      await new Promise((r) => requestAnimationFrame(r));
    }
    running = false;
    // Drop the first few: they include the work of starting to observe.
    const sorted = times.slice(3).sort((a, b) => a - b);
    return { p95: sorted[Math.floor(sorted.length * 0.95)], n: sorted.length };
  });

  if (frames && frames.n > 20) {
    // 16.7ms is one frame at 60 Hz; anything under ~20ms is not dropping them.
    check(frames.p95 < 20, `scrolling holds the frame budget (p95 ${frames.p95.toFixed(1)}ms)`, `p95 ${frames.p95.toFixed(1)}ms`);
  }
  await ctx.close();
}


// ── Changing who is in the org ───────────────────────────────────────────────
//
// Members was read-only: the roster showed who was there and offered no way to
// hire, promote or retire anyone. These are the actions the org's own
// composition depends on, and each one appends to the spine.
async function roster(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState });
  const page = await ctx.newPage();
  const dialog = () => page.getByRole('dialog');
  await open(page, '/members');

  // A handle nobody is using yet, so a re-run does not collide with itself.
  const handle = `smoke${Date.now().toString(36).slice(-6)}`;

  await page.getByRole('button', { name: 'Install an agent' }).click();
  await dialog().waitFor({ timeout: 5_000 });
  await dialog().getByLabel('Name').fill('Smoke Agent');
  await dialog().getByLabel('Handle').fill(handle);
  await dialog().getByRole('button', { name: 'Install' }).click();
  await page.waitForTimeout(2_500);
  check((await page.locator('main').innerText()).includes('Smoke Agent'), 'an agent can be installed from the roster');

  // A refusal has to be readable — not a stack trace, not "invalid input".
  await page.getByRole('button', { name: 'Install an agent' }).click();
  await dialog().waitFor({ timeout: 5_000 });
  await dialog().getByLabel('Name').fill('Someone Else');
  await dialog().getByLabel('Handle').fill(handle);
  await dialog().getByRole('button', { name: 'Install' }).click();
  await page.waitForTimeout(1_800);
  const refusal = await page.getByRole('alert').first().innerText().catch(() => '');
  check(refusal.includes('already Smoke Agent'), 'a taken handle is refused by naming who has it', refusal || '(no message shown)');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check((await dialog().count()) === 0, 'Escape closes a dialog');

  // Retire it again, so the check leaves the roster as it found it.
  const row = page.locator('main li', { hasText: 'Smoke Agent' }).first();
  await row.hover();
  await page.getByRole('button', { name: /Retire Smoke Agent/ }).click();
  await dialog().waitFor({ timeout: 5_000 });
  await dialog().getByLabel('Reason').fill('Smoke test cleanup.');
  await dialog().getByRole('button', { name: 'Retire' }).click();
  await page.waitForTimeout(2_500);

  // Lowercased: the section label is uppercased in CSS, which innerText reflects.
  const after = await page.locator('main').innerText();
  check(after.toLowerCase().includes('retired'), 'a retired member moves to its own section');
  // Retired, not deleted: they authored events and may carry a claim.
  check(after.includes('Smoke Agent'), 'a retired member stays on the roster');

  // Review lives inside Members rather than as a rail tab, and puts its state
  // in the URL.
  await open(page, '/members?view=review');
  check(
    (await page.locator('main').innerText()).toLowerCase().includes('escalation'),
    'Review is reachable by URL',
  );
  await ctx.close();
}

// ── The composer ────────────────────────────────────────────────────────────
// A communication app is judged on the box you type into. These check the four
// things that separate one from a textarea: markdown that renders, code that
// highlights, a file that goes up and comes back, and `@` that offers handles
// that exist rather than guessing at the text.
async function composer(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, storageState });
  const page = await ctx.newPage();
  const problems: string[] = [];
  watch(page, problems);

  await open(page, '/channels');
  await page.locator('a[href^="/channels/"]').first().click();
  await page.waitForTimeout(2_000);

  const box = page.getByRole('textbox', { name: /^Message / });
  const stamp = Date.now();

  // Markdown, including a fenced block with a language.
  await box.fill(`smoke ${stamp} with **bold** and \`inline\`\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\`\n\n- one\n- two`);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(2_500);

  const posted = page.locator('article').filter({ hasText: `smoke ${stamp}` }).last();
  await posted.waitFor({ timeout: 15_000 });
  check((await posted.locator('strong').count()) > 0, 'markdown renders as markup, not as asterisks');
  check((await posted.locator('pre').count()) > 0, 'a fenced block renders as a code block');
  check((await posted.locator('li').count()) >= 2, 'a list renders as a list');
  check(
    (await posted.getByRole('button', { name: /Copy/ }).count()) > 0,
    'a code block offers to copy itself',
  );

  // A file goes up and comes back down. A 1×1 PNG, written here rather than
  // committed — a fixture that lives in the repo is a fixture that rots.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.setInputFiles('input[type="file"]', { name: 'smoke-dot.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(2_500);
  check(
    (await page.getByRole('button', { name: 'Remove smoke-dot.png' }).count()) > 0,
    'an attached file appears in the composer before it is sent',
  );

  await box.fill(`file ${stamp}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(3_000);

  const withFile = page.locator('article').filter({ hasText: `file ${stamp}` }).last();
  await withFile.waitFor({ timeout: 15_000 });
  const img = withFile.locator('img').first();
  check((await img.count()) > 0, 'the file comes back as an image in the message');
  if ((await img.count()) > 0) {
    // Rendered, not just present: a broken image is an <img> too.
    const drawn = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0);
    check(drawn, 'the image actually loads through the access-checked route');
  }

  // The same file, requested without a session, must not be served.
  const src = (await img.count()) > 0 ? await img.getAttribute('src') : null;
  if (src) {
    const anon = await fetch(`${BASE}${src}`, { redirect: 'manual' });
    check(anon.status === 401, 'an attachment is refused to someone signed out', `got ${anon.status}`);
  }

  // Mentions, from the handles that exist.
  await box.click();
  await box.type('@pe', { delay: 40 });
  await page.waitForTimeout(700);
  check((await page.getByRole('option').count()) > 0, '@ offers members to mention');
  await page.keyboard.press('Escape');
  await box.fill('');

  // Emoji, keyboard-reachable and closable.
  await page.getByRole('button', { name: 'Emoji' }).click();
  await page.waitForTimeout(400);
  check((await page.getByRole('dialog', { name: 'Emoji' }).count()) > 0, 'the emoji picker opens');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog', { name: 'Emoji' }).count()) === 0, 'Escape closes the emoji picker');

  // Drafts survive leaving and coming back — the thing that makes a composer
  // feel trustworthy rather than disposable.
  const draft = `draft ${stamp}`;
  await box.fill(draft);
  await page.waitForTimeout(400);
  await open(page, '/activity');
  await page.goBack();
  await page.waitForTimeout(2_000);
  check(
    (await page.getByRole('textbox', { name: /^Message / }).inputValue()) === draft,
    'a half-written message survives navigating away',
  );
  await page.getByRole('textbox', { name: /^Message / }).fill('');

  check(problems.length === 0, 'the composer raises no page errors', problems.slice(0, 3).join(' | '));
  await ctx.close();
}

/** Take a plugin out if it is installed, so the round trip starts from nothing. */
async function removeIfInstalled(page: Page, name: string): Promise<void> {
  await open(page, '/extensions?tab=plugins');
  await page.locator('main li').first().waitFor({ timeout: 15_000 });

  // "Remove Incident Response", not "Remove": the row's button carries an
  // aria-label naming what it removes, because "Remove" alone in a list of rows
  // tells a screen reader nothing. The dialog's button is the bare one.
  const remove = page.locator('li').getByRole('button', { name: new RegExp(`^Remove ${name}$`) });
  if ((await remove.count()) === 0) return;

  await remove.first().click();
  // Confirm inside the dialog, not by name alone: the row's own Remove button
  // has the same label, and clicking that one just reopens what is already open.
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /^Remove$/ }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  await page.waitForTimeout(500);
}

// ── Extensions: skills, plugins, connectors ─────────────────────────────────
// The check that matters is the round trip. A plugin screen that lists things
// and installs nothing is the failure this whole section guards against, so the
// test installs one, watches the Skills count go up by exactly what the plugin
// carries, and takes it back out again.
async function extensions(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/extensions');
  const skillsText = await page.locator('main').innerText();
  check(
    skillsText.includes('Skills') && skillsText.includes('Connectors') && skillsText.includes('Plugins'),
    'Extensions has all three sections',
  );

  const read = page.getByRole('button', { name: 'Read' }).first();
  if ((await read.count()) > 0) {
    await read.click();
    await page.waitForTimeout(400);
    const shown = await page.locator('pre').first().innerText();
    // What the screen shows has to be what the agent is told — there is no
    // second, prettier version.
    check(shown.trim().length > 40, 'a skill shows the instructions it carries', `${shown.length} chars`);
  }

  // How many skills before. The count lives on the tab.
  const skillCount = async () => {
    await open(page, '/extensions');
    const label = await page.locator('nav[aria-label="Extensions view"] a').first().innerText();
    return Number(label.replace(/[^0-9]/g, ''));
  };
  await open(page, '/extensions?tab=plugins');
  check(
    (await page.locator('main').innerText()).includes('Incident Response'),
    'the bundled catalogue is listed',
  );

  // Chosen because it carries no agents: hiring one is an event on the spine
  // and would not be undone by removing the plugin, so the test could not run
  // twice against the same database.
  //
  // A previous run that died between install and remove leaves it here. Clear
  // that first — a test that only passes on a clean database is a test people
  // learn to ignore.
  await removeIfInstalled(page, 'Incident Response');
  const before = await skillCount();

  await open(page, '/extensions?tab=plugins');
  const install = page.locator('li').filter({ hasText: 'Incident Response' }).getByRole('button', { name: /^Install$/ });
  await install.first().click();
  await page.waitForTimeout(3_000);

  const after = await skillCount();
  check(after === before + 2, 'installing a plugin adds the skills it carries', `${before} → ${after}`);

  await open(page, '/extensions?tab=plugins');
  check(
    (await page.locator('main').innerText()).includes('Blameless') ||
      (await page.locator('li').filter({ hasText: 'Incident Response' }).first().innerText()).includes('in this org'),
    'an installed plugin says what it put in the org',
  );

  // And back out again, so the run leaves the database as it found it.
  await removeIfInstalled(page, 'Incident Response');

  const restored = await skillCount();
  check(restored === before, 'removing a plugin takes back what it installed', `${before} → ${restored}`);

  await ctx.close();
}

// ── Keyboard: reach content, see focus, escape a menu ────────────────────────
async function keyboard(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/activity');
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el?.getBoundingClientRect();
    return { text: (el?.textContent ?? '').trim(), visible: !!r && r.width > 1 && r.height > 1 };
  });
  check(skip.text === 'Skip to content' && skip.visible, 'the first Tab is a visible skip link', JSON.stringify(skip));

  // Every focus stop has to be visible and on screen.
  const noRing: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24),
        ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
        onScreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.top < 900,
      };
    });
    if (!info) break;
    if (!info.ring || !info.onScreen) noRing.push(info.label);
  }
  check(noRing.length === 0, 'every focus stop is visible and on screen', noRing.join(', '));

  // The theme menu must be escapable, or a keyboard user is stuck in it.
  const themeButton = page.getByRole('button', { name: 'Theme' });
  await themeButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab');
  const landed = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
  check(landed.length > 0, 'tabbing into the theme menu lands on a theme', 'landed on an empty element');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check((await page.getByRole('menu').count()) === 0, 'Escape closes the theme menu');
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('title') === 'Theme'),
    'Escape returns focus to the button that opened it',
  );
  await ctx.close();
}

// ── Each theme applies, and survives a reload ────────────────────────────────
/**
 * An agent reads apart from a person at a glance, in every theme.
 *
 * Two signals, deliberately: the shape (squircle vs circle) survives greyscale
 * and a colourblind reader, and the edge colour is what catches the eye
 * scrolling a roster. Asserting only one of them would let the other rot.
 */
async function agentEdge(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  await open(page, '/members');

  const both = await page.evaluate(
    () =>
      document.querySelector('[data-member-kind="agent"]') !== null &&
      document.querySelector('[data-member-kind="human"]') !== null,
  );
  check(both, 'the roster shows both people and agents', 'one of the two kinds is missing');

  for (const theme of ['ink', 'paper', 'warm', 'ledger', 'console'] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(150);
    const seen = await page.evaluate(() => {
      const read = (k: string) => {
        const el = document.querySelector(`[data-member-kind="${k}"]`);
        return el ? getComputedStyle(el).borderTopColor : null;
      };
      return { agent: read('agent'), human: read('human') };
    });
    check(
      seen.agent !== null && seen.agent !== seen.human,
      `an agent's avatar is edged apart from a person's in ${theme}`,
      `both drew ${seen.agent}`,
    );
  }

  await ctx.close();
}

async function themes(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  await open(page, '/activity');

  for (const [label, id] of [
    ['Ink', 'ink'],
    ['Paper', 'paper'],
    ['Warm', 'warm'],
    ['Ledger', 'ledger'],
    ['Console', 'console'],
  ] as const) {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitem', { name: new RegExp(label) }).click();
    await page.waitForTimeout(200);
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(applied === id, `the ${label} theme applies`, `root said "${applied}"`);

    // A theme that paints nothing is not a theme.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg !== 'rgba(0, 0, 0, 0)' && bg !== '', `${label} paints a background`, bg);
  }

  // A direction is not a palette: it changes the type and the shape language
  // too. Without this the two of them are two more colourways.
  const shape = async () =>
    page.evaluate(() => {
      const el = document.querySelector('.rounded-xl') ?? document.querySelector('.rounded-md');
      return {
        font: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, ''),
        radius: el ? getComputedStyle(el).borderRadius : 'n/a',
      };
    });

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ink'));
  await page.waitForTimeout(300);
  const ink = await shape();

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ledger'));
  await page.waitForTimeout(400);
  const ledger = await shape();
  check(ledger.font !== ink.font, 'Ledger sets its own type', `${ledger.font} vs ${ink.font}`);
  check(ledger.radius === '0px', 'Ledger is ruled, not boxed', ledger.radius);

  // The one place the direction earns its keep: a claim the org stopped
  // believing is struck through, the way a corrected entry is in a real ledger.
  await open(page, '/ledger');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ledger'));
  await page.waitForTimeout(400);
  const struck = await page.evaluate(() => {
    const el = document.querySelector('[data-claim-status="falsified"] [data-claim-statement]');
    return el ? getComputedStyle(el).textDecorationLine : null;
  });
  if (struck !== null) {
    check(struck.includes('line-through'), 'Ledger strikes a falsified claim through', struck);
  }

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'console'));
  await page.waitForTimeout(400);
  const console_ = await shape();
  check(console_.font !== ink.font && console_.font !== ledger.font, 'Console sets its own type', console_.font);
  check(console_.radius !== ink.radius, 'Console is hard-edged', console_.radius);

  // Through the menu, not by setting the attribute: only choosing one stores
  // it, and storing it is what this check is about.
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitem', { name: /Warm/ }).click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('nav[aria-label="Sections"]').waitFor({ timeout: 15_000 });
  check(
    (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'warm',
    'the chosen theme survives a reload',
  );
  await ctx.close();
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {}).catch((e: unknown) => {
  console.error(
    'Could not start Chromium. Install it with `bunx playwright install chromium`, ' +
      'or point PLAYWRIGHT_CHROMIUM at one you already have.\n' +
      (e instanceof Error ? e.message : String(e)),
  );
  process.exit(1);
});

try {
  await fetch(BASE).catch(() => {
    throw new Error(`Nothing is serving ${BASE}. Start it with \`bun run dev\`, or set SMOKE_BASE_URL.`);
  });

  if (!(await signIn(browser))) {
    // Everything else needs a session; running it signed out would report
    // thirty failures that all say the same thing.
    console.log('  (stopping — nothing else can run without a session)');
  } else {
    // Each section is isolated. One that throws — a selector that went stale, a
    // navigation that lost a race — used to take the whole report with it, so
    // sixty passing checks were replaced by a stack trace and the run had to be
    // repeated to find out what else was broken.
    const sections: Array<[string, (b: Browser) => Promise<void>]> = [
      ['crawl', crawl],
      ['posting', posting],
      ['busy conversation', busyConversation],
      ['live updates', liveUpdates],
      ['phone', phone],
      ['roster', roster],
      ['composer', composer],
      ['extensions', extensions],
      ['keyboard', keyboard],
      ['agent edge', agentEdge],
      ['themes', themes],
    ];
    for (const [name, run] of sections) {
      try {
        await run(browser);
      } catch (e) {
        failures.push(`${name} could not finish — ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      }
    }
  }
} finally {
  await browser.close();
}

for (const c of checks) console.log(`  ok    ${c}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n${checks.length} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
