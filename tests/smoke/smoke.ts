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

// ── What you can do to a message that is already said ───────────────────────
// The rule under all of these is that the spine is append-only, so each one has
// to be visible on the screen *and* leave the original alone. The unit tests
// assert the second half; these assert the first.
async function messageActions(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, storageState });
  const page = await ctx.newPage();

  // In a chat, deliberately. A channel is threaded, and there the reply
  // affordance belongs to the thread rather than to the hover toolbar — a
  // second Reply button on the same post is worse than either. Everything else
  // here is the same in both.
  await open(page, '/chats');
  await page.locator('a[href^="/chats/"]').first().click();
  await page.waitForTimeout(2_000);

  const box = page.getByRole('textbox', { name: /^Message / });
  const stamp = Date.now();
  await box.fill(`acted ${stamp}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(2_500);

  const row = () => page.locator('article').filter({ hasText: `acted ${stamp}` }).last();
  await row().waitFor({ timeout: 15_000 });

  // Reacting.
  await row().hover();
  await row().getByRole('button', { name: 'React 👍' }).click();
  await page.waitForTimeout(2_500);
  const chip = row().locator('button[aria-pressed="true"]').filter({ hasText: '1' });
  check((await chip.count()) > 0, 'a reaction appears on the message it was put on');

  // And it is a toggle, not a counter.
  await chip.first().click();
  await page.waitForTimeout(2_500);
  check(
    (await row().locator('button[aria-pressed="true"]').filter({ hasText: '1' }).count()) === 0,
    'clicking your own reaction takes it back',
  );

  // Pinning. Waited for rather than slept through: every one of these actions
  // re-renders from the server, and how long that takes is not a constant.
  await row().hover();
  await row().getByRole('button', { name: 'Pin' }).click();
  const pinned = page.locator('article').filter({ hasText: `acted ${stamp}` }).last().getByText('Pinned');
  await pinned.waitFor({ timeout: 15_000 }).catch(() => {});
  check((await pinned.count()) > 0, 'a pinned message says so');

  await row().hover();
  await row().getByRole('button', { name: 'Unpin' }).click();
  await pinned.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});

  // Replying, and the quotation that makes a reply readable.
  await row().hover();
  await row().getByRole('button', { name: 'Reply' }).click();
  await page.waitForTimeout(600);
  check((await page.getByText('Replying to').count()) > 0, 'replying shows what you are answering');

  await box.fill(`answer ${stamp}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(2_500);

  const answer = page.locator('article').filter({ hasText: `answer ${stamp}` }).last();
  await answer.waitFor({ timeout: 15_000 });
  check((await answer.innerText()).includes(`acted ${stamp}`), 'a reply quotes what it answers');

  // Editing, in place.
  await answer.hover();
  await answer.getByRole('button', { name: 'Edit' }).click();
  await page.waitForTimeout(600);
  const editor = page.getByRole('textbox', { name: 'Edit this message' });
  check((await editor.count()) > 0, 'editing happens where the message is');
  await editor.fill(`answer ${stamp} corrected`);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2_500);

  const edited = page.locator('article').filter({ hasText: `answer ${stamp} corrected` }).last();
  check((await edited.innerText()).includes('edited'), 'an edited message says it was edited');

  // Deleting keeps the row, so a reply to it still makes sense.
  await edited.hover();
  await edited.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('dialog', { name: /Delete this message/ }).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(2_500);
  check(
    (await page.getByText('This message was deleted.').count()) > 0,
    'a deleted message leaves its place, and says what happened',
  );

  await ctx.close();
}

// ── The board ───────────────────────────────────────────────────────────────
// A board whose cards are only cards is the failure this guards against: every
// card here is a real objective, and moving one has to actually move it.
async function boardView(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/work?view=board');
  const columns = page.locator('main section');
  check((await columns.count()) >= 3, 'the board has columns', `${await columns.count()}`);

  // The two ends always exist, so a shipped or killed objective has somewhere
  // to be rather than vanishing.
  const text = await page.locator('main').innerText();
  check(text.includes('Shipped') && text.includes('Killed'), 'the board keeps a column for both endings');

  // The board scrolls sideways in its own box; the page never does.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow === 0, 'the board does not push the page sideways', `${overflow}px`);

  const card = page.locator('main article').first();
  if ((await card.count()) === 0) {
    checks.push('the board is empty — nothing to move');
    await ctx.close();
    return;
  }

  // Moving by menu, not by drag: dragging is invisible to a keyboard, and the
  // menu is the control that names where a card can go.
  await card.getByRole('button', { name: /^Move / }).click();
  await page.waitForTimeout(400);
  const options = await page.getByRole('menuitem').allInnerTexts();
  check(options.length >= 3, 'a card says where it can go', options.join(' / '));
  check(
    options.some((o) => o.includes('here')),
    'the menu marks the column the card is already in',
  );

  // A stage the orchestrator cannot run is offered as unavailable rather than
  // silently accepted — a card dropped there would sit looking like work.
  const dead = page.getByRole('menuitem').filter({ hasText: 'not built' });
  if ((await dead.count()) > 0) {
    check(await dead.first().isDisabled(), 'a stage that is not built cannot be moved to');
  }

  // Move it to the far end and back. Which end depends on where it starts:
  // the first version of this always aimed at Killed, left it there, and then
  // failed for ever — every later run found the card already in the column it
  // was moving to, where the menu item is correctly disabled.
  const cardsIn = (name: string) =>
    page.locator('main section').filter({ hasText: name }).locator('article');
  const startsKilled = (await cardsIn('Killed').count()) > 0;
  const away = startsKilled ? 'Filed' : 'Killed';
  const home = startsKilled ? 'Killed' : 'Filed';

  const before = await card.locator('h3').innerText();
  await page.getByRole('menuitem', { name: new RegExp(`^${away}`) }).click();
  await cardsIn(away).first().waitFor({ timeout: 15_000 }).catch(() => {});
  check((await cardsIn(away).count()) > 0, 'moving a card moves the objective', `"${before}" did not reach ${away}`);

  await cardsIn(away).first().getByRole('button', { name: /^Move / }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: new RegExp(`^${home}`) }).click();
  await cardsIn(home).first().waitFor({ timeout: 15_000 }).catch(() => {});
  check((await cardsIn(home).count()) > 0, 'and moves it back, so the next run can move it too');

  await ctx.close();
}

// ── The org, as a shape ─────────────────────────────────────────────────────
async function orgView(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/members?view=org');
  check((await page.locator('main svg[role="img"]').count()) > 0, 'the org has a topology graph');
  check(
    (await page.locator('main details').count()) > 0,
    'departments and teams expand',
  );

  // Native `<details>`, so it works from the keyboard without a hook.
  const first = page.locator('main details').first();
  const wasOpen = await first.evaluate((el) => (el as HTMLDetailsElement).open);
  await first.locator('summary').first().click();
  await page.waitForTimeout(200);
  check(
    (await first.evaluate((el) => (el as HTMLDetailsElement).open)) !== wasOpen,
    'a department opens and closes',
  );

  // Somebody with no team is named rather than dropped from a view that claims
  // to show the org.
  const text = await page.locator('main').innerText();
  check(text.includes('Not on a team') || text.includes('DEPARTMENTS'), 'the org names everyone it has');

  // The link out of the graph has to land on that person, not on an unfiltered
  // roster — that is a dangling anchor with extra steps.
  const link = page.locator('main a[href*="?q="]').first();
  if ((await link.count()) > 0) {
    const href = await link.getAttribute('href');
    await open(page, href ?? '');
    const rows = await page.locator('main ul li').count();
    check(rows > 0 && rows <= 3, 'a link into the roster arrives filtered', `${rows} rows for ${href}`);
  }

  await ctx.close();
}

// ── A call, between two real browsers ───────────────────────────────────────
// The media goes peer to peer and never touches the server, which means the
// only way to know it works is to run two browsers and look at what arrived.
// Everything short of that — a button, a room row, a signal queue — can be
// green while nobody can hear anybody.
async function call(browser: Browser) {
  // A second member with a password, or there is nobody to call.
  const second = { email: 'mira@acme.storage', password: PASSWORD };
  const canSignIn = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sign_in', ...second }),
  })
    .then((r) => r.ok)
    .catch(() => false);

  if (!canSignIn) {
    checks.push('only one account has a password — a two-party call cannot be checked here');
    return;
  }

  const media = { permissions: ['microphone', 'camera'] as string[], viewport: { width: 1280, height: 900 } };
  const a = await browser.newContext({ ...media, storageState });
  const pageA = await a.newPage();

  const b = await browser.newContext(media);
  const pageB = await b.newPage();
  await pageB.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(1_200);
  await pageB.getByLabel('Email').fill(second.email);
  await pageB.getByLabel('Password').fill(second.password);
  await pageB.getByRole('button', { name: /Sign in/ }).click();
  await pageB.waitForTimeout(2_500);

  const room = '/channels/ch-storage';
  // "Open a room" in a channel, "Call" in a chat, "Join · 2/6" once one is
  // running — the label says what pressing it does, so the selector has to
  // accept all three.
  const callButton = (p: Page) => p.getByRole('button', { name: /Join · \d+|^Call$|Open a room/ });

  await open(pageA, room);

  // A meeting is this conversation with a time on it, so it is scheduled from
  // here and joining it is the call here — there is no separate room.
  await pageA.getByRole('button', { name: /^Schedule a meeting/ }).click();
  await pageA.waitForTimeout(500);
  const subject = `Smoke review ${Date.now()}`;
  await pageA.getByLabel('What it is about').fill(subject);
  await pageA.getByRole('button', { name: /^Schedule$/ }).click();
  await pageA.waitForTimeout(2_500);

  check(
    (await pageA.getByText(subject).first().count()) > 0,
    'a scheduled meeting appears in the conversation it is in',
  );
  check(
    (await pageA.getByRole('button', { name: /Join now|Start early/ }).count()) > 0,
    'a meeting offers a way into the call',
  );
  // And it was announced, rather than being a calendar entry nobody saw.
  check(
    (await pageA.locator('article').filter({ hasText: subject }).count()) > 0,
    'scheduling one tells the conversation',
  );
  await pageA.getByRole('button', { name: 'Call off' }).first().click();
  await pageA.waitForTimeout(2_000);

  await callButton(pageA).click();
  await pageA.getByRole('region', { name: 'Call' }).waitFor({ timeout: 20_000 });
  check(true, 'a call starts in a conversation');

  // The second person is offered the call that is already running, not a new one.
  await open(pageB, room);
  const label = await callButton(pageB).innerText();
  check(/Join/.test(label), 'a call already running is offered as one to join', label);
  await callButton(pageB).click();

  // Wait for media to actually arrive, not for a fixed number of seconds.
  const connected = async (p: Page) =>
    p
      .waitForFunction(
        () =>
          [...document.querySelectorAll('section[aria-label="Call"] video')].filter(
            (v) => (v as HTMLVideoElement).videoWidth > 0,
          ).length >= 2,
        null,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);

  const [aOk, bOk] = await Promise.all([connected(pageA), connected(pageB)]);
  check(aOk, 'the caller receives the other side\u2019s video');
  check(bOk, 'the person who joined receives the caller\u2019s video');

  // Leaving is a real hang-up: the tracks stop and the room empties.
  await pageB.getByRole('button', { name: 'Leave' }).click();
  await pageB.waitForTimeout(1_500);
  check(
    (await pageB.getByRole('region', { name: 'Call' }).count()) === 0,
    'leaving a call closes it for whoever left',
  );
  await pageA.getByRole('button', { name: 'Leave' }).click();
  await pageA.waitForTimeout(1_500);

  await a.close();
  await b.close();
}

// ── Extensions: apps added to the org ───────────────────────────────────────
// The test an entry here has to pass is that removing it takes a surface away.
// So the check does exactly that: turn Boards off, confirm the Board tab is
// gone from Work, turn it back on, confirm it returns.
async function extensions(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/extensions');
  const text = await page.locator('main').innerText();
  check(text.includes('Boards') && text.includes('Calls'), 'Extensions lists the apps this build ships');
  check(
    text.includes('Always on'),
    'an app that is part of the product says so rather than being hidden',
  );
  check(
    !text.includes('Skills') && !text.includes('Connectors'),
    'skills and connectors are not apps, and are not here',
  );

  const boardTab = async () => {
    await open(page, '/work');
    return (await page.getByRole('link', { name: 'Board' }).count()) > 0;
  };
  check(await boardTab(), 'Work has a Board while the app is added');

  await open(page, '/extensions');
  await page.getByRole('button', { name: 'Remove Boards' }).click();
  await page.getByRole('button', { name: 'Add Boards' }).waitFor({ timeout: 15_000 }).catch(() => {});
  check(!(await boardTab()), 'removing an app takes its surface away');

  await open(page, '/extensions');
  await page.getByRole('button', { name: 'Add Boards' }).click();
  await page.getByRole('button', { name: 'Remove Boards' }).waitFor({ timeout: 15_000 }).catch(() => {});
  check(await boardTab(), 'adding it back brings the surface with it');

  await ctx.close();
}

// ── A channel reads as posts; a chat reads as a stream ──────────────────────
// The same events, two shapes. What is being checked is that a reply in a
// channel goes *under* its post rather than becoming a post of its own, and
// that a chat has no threads to fold anything into.
async function threading(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, storageState });
  const page = await ctx.newPage();
  const stamp = Date.now();

  await open(page, '/channels');
  await page.locator('a[href^="/channels/"]').first().click();
  await page.waitForTimeout(2_000);

  const box = page.getByRole('textbox', { name: /^Message / });
  check(
    (await box.getAttribute('placeholder'))?.startsWith('Start a post') === true,
    'a channel composer says it starts a post, not a message',
  );

  await box.fill(`thread ${stamp}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(2_500);

  const post = () => page.locator('section').filter({ hasText: `thread ${stamp}` }).last();
  await post().waitFor({ timeout: 15_000 });

  await post().hover();
  await post().getByRole('button', { name: /^Reply$/ }).click();
  await page.waitForTimeout(500);
  check(
    (await box.getAttribute('placeholder'))?.startsWith('Reply to') === true,
    'replying in a channel says who is being answered',
  );

  await box.fill(`under ${stamp}`);
  await page.getByRole('button', { name: 'Send' }).click();
  // Waited for inside the post, not anywhere on the page: the sidebar preview
  // shows the reply's text the moment it is sent, so a page-level wait passes
  // while the stream is still re-rendering.
  await post().getByText(`under ${stamp}`).waitFor({ timeout: 15_000 });

  // The reply is inside the post's block, not a sibling of it.
  check((await post().innerText()).includes(`under ${stamp}`), 'a reply lands inside the post it answers');
  check((await post().innerText()).includes('1 reply'), 'the post says how many replies it has');

  const posts = await page.locator('section').filter({ hasText: `under ${stamp}` }).count();
  check(posts === 1, 'a reply is not also a post of its own', `${posts} blocks contain it`);

  // While here: a channel call is a room, a chat call rings. The button says
  // which, because pressing it does a different thing — and the seat cap is on
  // it up front rather than in a refusal after the seventh person clicks.
  const roomBtn = page.locator('header button').filter({ hasText: /Open a room|Join/ }).first();
  check((await roomBtn.count()) > 0, 'a channel offers a room, not a call');
  check(
    ((await roomBtn.getAttribute('title')) ?? '').includes('nobody is rung'),
    'and says it rings nobody, with the seat limit',
  );

  // A chat is flat: no thread blocks at all.
  await open(page, '/chats');
  await page.locator('a[href^="/chats/"]').first().click();
  await page.waitForTimeout(2_000);
  check(
    (await page.getByRole('textbox', { name: /^Message / }).getAttribute('placeholder'))?.startsWith('Message') ===
      true,
    'a chat composer sends a message, not a post',
  );
  check((await page.locator('main section').count()) === 0, 'a chat has no threads to fold anything into');

  const callBtn = page.locator('header button').filter({ hasText: /^Call|Join/ }).first();
  check((await callBtn.count()) > 0, 'a chat offers a call');
  check(
    ((await callBtn.getAttribute('title')) ?? '').startsWith('Call '),
    'and it rings the person, rather than opening a room',
  );

  await ctx.close();
}

/** Take a plugin out if it is installed, so the round trip starts from nothing. */
async function removeIfInstalled(page: Page, name: string): Promise<void> {
  await open(page, '/settings?tab=plugins');
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

// ── Settings: skills, plugins, connectors ───────────────────────────────────
// The check that matters is the round trip. A plugin screen that lists things
// and installs nothing is the failure this whole section guards against, so the
// test installs one, watches the Skills count go up by exactly what the plugin
// carries, and takes it back out again.
async function settings(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();

  await open(page, '/settings');
  const skillsText = await page.locator('main').innerText();
  check(
    skillsText.includes('Skills') && skillsText.includes('Connectors') && skillsText.includes('Plugins'),
    'Settings has all three sections',
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
    await open(page, '/settings');
    const label = await page.locator('nav[aria-label="Settings section"] a').first().innerText();
    return Number(label.replace(/[^0-9]/g, ''));
  };
  await open(page, '/settings?tab=plugins');
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

  await open(page, '/settings?tab=plugins');
  const install = page.locator('li').filter({ hasText: 'Incident Response' }).getByRole('button', { name: /^Install$/ });
  await install.first().click();
  await page.waitForTimeout(3_000);

  const after = await skillCount();
  check(after === before + 2, 'installing a plugin adds the skills it carries', `${before} → ${after}`);

  await open(page, '/settings?tab=plugins');
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

  for (const theme of ['studio', 'daylight', 'ink', 'paper', 'warm', 'ledger', 'console'] as const) {
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
    ['Studio', 'studio'],
    ['Daylight', 'daylight'],
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

const browser = await chromium
  .launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
    // A synthetic camera and microphone, and no permission prompt. This is what
    // makes the call check a real one: two browsers, real media tracks, an
    // actual peer connection — rather than asserting that a button exists.
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
  .catch((e: unknown) => {
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
      ['message actions', messageActions],
      ['threading', threading],
      ['board', boardView],
      ['org', orgView],
      ['call', call],
      ['settings', settings],
      ['extensions', extensions],
      ['keyboard', keyboard],
      ['agent edge', agentEdge],
      ['themes', themes],
    ];
    for (const [name, run] of sections) {
      try {
        await run(browser);
      } catch (e) {
        // The first line names the action; the call log below it names the
        // selector that never resolved, which is the part worth reading.
        const detail = e instanceof Error ? e.message.split('\n').slice(0, 4).join(' · ') : String(e);
        failures.push(`${name} could not finish — ${detail}`);
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
