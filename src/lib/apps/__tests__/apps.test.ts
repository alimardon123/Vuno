// Apps, and the one thing that is easy to get wrong.
//
// The defaults are stored nowhere until somebody changes something, which keeps
// a fresh org from needing rows for every app it has not thought about. The
// trap is the first removal: read naively, an org with one row would look like
// an org where only that app is on. Every test below is about that boundary.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { APPS, AppError, appsFor, isAppOn, setApp } from '@/lib/apps';

const TENANT = 'tnt-app';
const ORG = 'org-app';
const KAI = 'mbr-app-kai';
const base = { tenantId: TENANT, orgId: ORG, memberId: KAI };

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'app-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'app-o' } });
  await db.member.create({
    data: { id: KAI, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai', handle: 'app-kai' },
  });
});

afterEach(async () => {
  await db.appInstall.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('the catalogue', () => {
  test('every app names the surface it controls', () => {
    // The rule that keeps this from becoming a brochure: an entry that does not
    // put something on screen has no business being here.
    for (const a of APPS) {
      expect(a.surface.length).toBeGreaterThan(4);
      expect(a.summary.length).toBeGreaterThan(20);
    }
  });

  test('keys are unique, since a row is keyed by one', () => {
    expect(new Set(APPS.map((a) => a.key)).size).toBe(APPS.length);
  });
});

describe('a fresh org', () => {
  test('has the default apps on without any rows', async () => {
    expect(await db.appInstall.count({ where: { orgId: ORG } })).toBe(0);
    expect(await isAppOn(ORG, 'boards')).toBe(true);
    expect(await isAppOn(ORG, 'calls')).toBe(true);
  });

  test('has core apps on, and they are not removable', async () => {
    expect(await isAppOn(ORG, 'ledger')).toBe(true);
    await expect(setApp({ ...base, key: 'ledger', on: false })).rejects.toThrow(/part of the product/);
  });

  test('does not have an app this build has never heard of', async () => {
    expect(await isAppOn(ORG, 'telepathy')).toBe(false);
    await expect(setApp({ ...base, key: 'telepathy', on: true })).rejects.toThrow(AppError);
  });
});

describe('removing the first one', () => {
  test('leaves every other default on', async () => {
    await setApp({ ...base, key: 'boards', on: false });

    expect(await isAppOn(ORG, 'boards')).toBe(false);
    // The trap: with one row written, a naive read would see "only boards is
    // decided" and turn the rest off — or, writing nothing, turn boards back on.
    expect(await isAppOn(ORG, 'calls')).toBe(true);
    expect(await isAppOn(ORG, 'org-chart')).toBe(true);
    expect(await isAppOn(ORG, 'meetings')).toBe(true);
  });

  test('and the row it wrote is the record from then on', async () => {
    await setApp({ ...base, key: 'boards', on: false });
    const rows = await db.appInstall.findMany({ where: { orgId: ORG }, select: { key: true } });
    expect(rows.map((r) => r.key).sort()).toEqual(['calls', 'meetings', 'org-chart']);
  });
});

describe('adding one back', () => {
  test('turns the surface on again', async () => {
    await setApp({ ...base, key: 'boards', on: false });
    await setApp({ ...base, key: 'boards', on: true });
    expect(await isAppOn(ORG, 'boards')).toBe(true);
  });

  test('twice is the same as once', async () => {
    await setApp({ ...base, key: 'boards', on: true });
    await setApp({ ...base, key: 'boards', on: true });
    expect(await db.appInstall.count({ where: { orgId: ORG, key: 'boards' } })).toBe(1);
  });
});

describe('the list', () => {
  test('reports what is on, and marks what cannot be turned off', async () => {
    await setApp({ ...base, key: 'calls', on: false });
    const rows = await appsFor(ORG);

    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get('calls')?.installed).toBe(false);
    expect(byKey.get('boards')?.installed).toBe(true);
    expect(byKey.get('ledger')?.installed).toBe(true);
    expect(byKey.get('ledger')?.core).toBe(true);
  });

  test('records when an app was added, so the row can say', async () => {
    await setApp({ ...base, key: 'boards', on: true });
    const row = (await appsFor(ORG)).find((a) => a.key === 'boards');
    expect(row?.installedAt).not.toBeNull();
  });
});
