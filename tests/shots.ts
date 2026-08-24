// Vuno — one picture per feature, taken from the running app.
//
// The documentation claims the product has these features. This is what makes
// that claim checkable: every image in `docs/FEATURES.md` is produced here,
// against the seeded database, by driving the real UI rather than by mocking a
// screenshot. A feature that stops working stops having a picture.
//
//   bun run dev     # in one terminal
//   bun run shots   # in another
//
// Needs a Chromium. PLAYWRIGHT_CHROMIUM overrides Playwright's default.

import { mkdir, readdir, stat } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { db } from '@/lib/db';

const BASE = process.env.SHOTS_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SHOTS_EMAIL ?? 'kai@acme.storage';
const PASSWORD = process.env.SHOTS_PASSWORD ?? 'smoke-test-password';
const OUT = 'docs/images';
/** Wide enough for three columns, short enough that the image is readable. */
const DESKTOP = { width: 1360, height: 850 };
const PHONE = { width: 390, height: 844 };

const taken: string[] = [];
const failed: string[] = [];

async function open(page: Page, path: string) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.locator('nav[aria-label="Sections"]').waitFor({ timeout: 20_000 });
  // Fonts, then a beat for the stream to position itself.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

/**
 * Where to open a conversation so the picture shows the product, not the tests.
 *
 * `bun run smoke` posts into the seeded channels — that is what makes it a real
 * browser check rather than a fixture — and it leaves those messages behind,
 * because the spine is append-only and nothing deletes from it. So the live end
 * of a channel on a machine that has run the suite is forty lines of
 * `smoke 1787590920715`.
 *
 * The route already takes `?before=<seq>` to walk back through history, so this
 * finds the newest message that is not test residue and opens one past it. It
 * is computed rather than hardcoded so the script still works after the next
 * run leaves different residue.
 */
async function beforeResidue(channelId: string): Promise<string> {
  const real = await db.event.findFirst({
    where: {
      scopeId: channelId,
      scopeType: 'channel',
      type: { in: ['MessagePosted', 'ThreadReplyPosted'] },
      NOT: [
        { payload: { contains: '"body":"smoke ' } },
        { payload: { contains: '"body":"file ' } },
        { payload: { contains: '"body":"thread ' } },
        { payload: { contains: '"body":"under ' } },
        { payload: { contains: '"body":"acted ' } },
        { payload: { contains: '"body":"answer ' } },
        { payload: { contains: 'Smoke review ' } },
      ],
    },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return real ? `?before=${real.seq + 1}` : '';
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  taken.push(name);
}

/** Each feature is isolated: one that breaks must not cost the other twenty. */
async function feature(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    failed.push(`${name} — ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
}

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

await mkdir(OUT, { recursive: true });

const ctx = await browser.newContext({ viewport: DESKTOP });
const page = await ctx.newPage();

// ── Sign in ─────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await shot(page, 'sign-in');
await page.getByLabel(/email/i).fill(EMAIL);
await page.getByLabel(/password/i).first().fill(PASSWORD);
await page.getByRole('button', { name: /sign in|continue|set/i }).first().click();
await page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 25_000 });
const storageState = await ctx.storageState();

// ── The seven destinations ──────────────────────────────────────────────────
await feature('activity', async () => {
  await open(page, '/activity');
  await shot(page, 'activity');
});

/** A DM with real conversation in it, rather than four seeded lines. */
const CHAT = 'ch-dm-kai-bob';

await feature('chats', async () => {
  await open(page, `/chats/${CHAT}${await beforeResidue(CHAT)}`);
  await page.waitForTimeout(1200);
  await shot(page, 'chats-flat');
});

/** The busiest seeded channel, which is where a threaded read actually shows. */
const BUSY = 'ch-storage';

await feature('channels', async () => {
  await open(page, `/channels/${BUSY}${await beforeResidue(BUSY)}`);
  await page.waitForTimeout(1200);
  await shot(page, 'channels-threaded');
});

await feature('work-list', async () => {
  await open(page, '/work');
  await shot(page, 'work-list');
});

await feature('work-board', async () => {
  await open(page, '/work?view=board');
  await shot(page, 'work-board');
});

await feature('members-roster', async () => {
  await open(page, '/members');
  await shot(page, 'members-roster');
});

await feature('members-org', async () => {
  await open(page, '/members?view=org');
  await shot(page, 'members-org');
});

await feature('members-review', async () => {
  await open(page, '/members?view=review');
  await shot(page, 'members-review');
});

await feature('extensions', async () => {
  await open(page, '/extensions');
  await shot(page, 'extensions');
});

await feature('ledger', async () => {
  await open(page, '/ledger');
  await shot(page, 'ledger');
});

// ── Settings: skills, plugins, connectors ───────────────────────────────────
for (const tab of ['skills', 'plugins', 'connectors'] as const) {
  await feature(`settings-${tab}`, async () => {
    await open(page, `/settings?tab=${tab}`);
    await shot(page, `settings-${tab}`);
  });
}

// ── Search ──────────────────────────────────────────────────────────────────
await feature('search', async () => {
  await open(page, '/search?q=latency');
  await shot(page, 'search');
});

// ── The composer, opened up ─────────────────────────────────────────────────
await feature('composer', async () => {
  await open(page, `/chats/${CHAT}${await beforeResidue(CHAT)}`);
  await page.waitForTimeout(1000);
  const box = page.getByRole('textbox').last();
  await box.click();
  // A mention, so the autocomplete is in the picture — it is the part that
  // shows people and agents are the same kind of thing.
  await box.fill('Here is what the composer does @');
  await page.waitForTimeout(600);
  await shot(page, 'composer-mention');
  await box.fill('');
  await page.waitForTimeout(200);
});

await feature('emoji', async () => {
  const button = page.getByRole('button', { name: 'Emoji' }).first();
  if ((await button.count()) === 0) throw new Error('no emoji button');
  await button.click();
  await page.waitForTimeout(500);
  await shot(page, 'composer-emoji');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// ── What you can do to a message that is already said ───────────────────────
await feature('message-actions', async () => {
  await open(page, `/chats/${CHAT}${await beforeResidue(CHAT)}`);
  await page.waitForTimeout(1000);
  const messages = page.locator('article');
  const n = await messages.count();
  if (n === 0) throw new Error('no message rows');
  const target = messages.nth(n - 1);
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await page.waitForTimeout(600);
  await shot(page, 'message-actions');
});

// ── A call, with two real browsers in it ────────────────────────────────────
// A screenshot of one person waiting in an empty room documents the button,
// not the feature. This signs a second member in, joins from both, and waits
// for the mesh to negotiate — the fake camera Chromium is launched with is what
// puts a real media track in the tile.
await feature('call', async () => {
  const second = { email: 'mira@acme.storage', password: PASSWORD };
  const ok = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sign_in', ...second }),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (!ok) throw new Error('only one account has a password — no two-party call to photograph');

  const media = { permissions: ['microphone', 'camera'], viewport: DESKTOP };
  const roomAt = `/channels/${BUSY}${await beforeResidue(BUSY)}`;
  const enter = (p: Page) => p.getByRole('button', { name: /Join · \d+|^Call$|Open a room/ }).first();

  const b = await browser.newContext(media);
  const pageB = await b.newPage();
  await pageB.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(1200);
  await pageB.getByLabel('Email').fill(second.email);
  await pageB.getByLabel('Password').fill(second.password);
  await pageB.getByRole('button', { name: /Sign in/ }).click();
  await pageB.waitForTimeout(2500);

  const a = await browser.newContext({ ...media, storageState });
  const pageA = await a.newPage();
  await open(pageA, roomAt);
  await enter(pageA).click();
  await pageA.waitForTimeout(2500);

  await open(pageB, roomAt);
  await enter(pageB).click();
  await pageB.waitForTimeout(7000);
  await pageA.waitForTimeout(1500);

  await shot(pageA, 'call');

  for (const p of [pageA, pageB]) {
    const leave = p.getByRole('button', { name: /^Leave$|Call off/ }).first();
    if ((await leave.count()) > 0) await leave.click().catch(() => {});
  }
  await pageA.waitForTimeout(800);
  await a.close();
  await b.close();
});

await feature('meetings', async () => {
  await open(page, `/channels/${BUSY}`);
  await page.waitForTimeout(1000);
  const button = page.getByRole('button', { name: /^Schedule a meeting/ }).first();
  if ((await button.count()) === 0) throw new Error('no meeting button');
  await button.click();
  await page.waitForTimeout(700);
  await shot(page, 'meetings');
  await page.keyboard.press('Escape');
});

// ── The seven looks ─────────────────────────────────────────────────────────
await feature('themes', async () => {
  const at = `/channels/${BUSY}${await beforeResidue(BUSY)}`;
  for (const theme of ['studio', 'daylight', 'ink', 'paper', 'warm', 'ledger', 'console'] as const) {
    await open(page, at);
    await page.evaluate((t) => {
      localStorage.setItem('vuno-theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.waitForTimeout(900);
    await shot(page, `theme-${theme}`);
  }
  await page.evaluate(() => localStorage.setItem('vuno-theme', 'studio'));
});

await ctx.close();

// ── A phone ─────────────────────────────────────────────────────────────────
await feature('phone', async () => {
  const mobile = await browser.newContext({ viewport: PHONE, storageState });
  const mp = await mobile.newPage();
  await open(mp, '/chats');
  await shot(mp, 'phone-list');
  await open(mp, `/chats/${CHAT}${await beforeResidue(CHAT)}`);
  await mp.waitForTimeout(900);
  await shot(mp, 'phone-conversation');
  await mobile.close();
});

await browser.close();

// ── Report ──────────────────────────────────────────────────────────────────
// A screenshot of a blank page is worse than no screenshot: it makes the
// documentation look complete while showing nothing.
const files = (await readdir(OUT)).filter((f) => f.endsWith('.png'));
const thin: string[] = [];
for (const f of files) {
  const { size } = await stat(`${OUT}/${f}`);
  if (size < 12_000) thin.push(`${f} (${(size / 1024).toFixed(0)} KB)`);
}

await db.$disconnect();

console.log(`\n${taken.length} images in ${OUT}/`);
for (const f of failed) console.log(`  MISSING  ${f}`);
if (thin.length > 0) console.log(`  SUSPECT  possibly blank: ${thin.join(', ')}`);
process.exit(failed.length === 0 && thin.length === 0 ? 0 : 1);
