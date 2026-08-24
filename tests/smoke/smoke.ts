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
  await earlier.click();
  await page.waitForTimeout(1200);
  check(/\?before=\d+/.test(page.url()), 'a point in history is a URL someone can send');
  check((await page.locator('main p').last().innerText()) !== newest, 'the window actually moves back');

  const jump = page.getByRole('link', { name: 'Jump to the latest' });
  check((await jump.count()) > 0, 'there is a way back to the live end');
  await jump.click();
  await page.waitForTimeout(1200);
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

  // The Library and Review live inside Members rather than as rail tabs, and
  // both put their state in the URL.
  await open(page, '/members?view=library');
  const library = await page.locator('main').innerText();
  check(library.includes('SKILL.md') || library.toLowerCase().includes('skills'), 'the Library is reachable by URL');

  const read = page.getByRole('button', { name: 'Read' }).first();
  if ((await read.count()) > 0) {
    await read.click();
    await page.waitForTimeout(400);
    const shown = await page.locator('pre').first().innerText();
    // What the Library shows has to be what the agent is told — there is no
    // second, prettier version.
    check(shown.trim().length > 40, 'a skill shows the instructions it carries', `${shown.length} chars`);
  }

  await open(page, '/members?view=review');
  check(
    (await page.locator('main').innerText()).toLowerCase().includes('escalation'),
    'Review is reachable by URL',
  );
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
async function themes(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  await open(page, '/activity');

  for (const [label, id] of [['Ink', 'ink'], ['Paper', 'paper'], ['Warm', 'warm']] as const) {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitem', { name: new RegExp(label) }).click();
    await page.waitForTimeout(200);
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(applied === id, `the ${label} theme applies`, `root said "${applied}"`);

    // A theme that paints nothing is not a theme.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg !== 'rgba(0, 0, 0, 0)' && bg !== '', `${label} paints a background`, bg);
  }

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
  await crawl(browser);
  await posting(browser);
  await busyConversation(browser);
  await liveUpdates(browser);
  await phone(browser);
  await roster(browser);
  await keyboard(browser);
  await themes(browser);
  }
} finally {
  await browser.close();
}

for (const c of checks) console.log(`  ok    ${c}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n${checks.length} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
