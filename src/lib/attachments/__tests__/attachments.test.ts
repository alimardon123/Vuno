// Attachments, and the four things that go wrong with file uploads.
//
// A file is the one thing a user puts on the server that the server then hands
// back to other users, so every test here is about a boundary: what the bytes
// really are, what the name is allowed to be, whose file it is, and whether an
// upload nobody sent can be claimed by somebody else's message.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '@/lib/db';
import {
  AttachmentError,
  attachmentsForEvents,
  discardUpload,
  imageSize,
  linkToEvent,
  safeName,
  sniff,
  storageRoot,
  storeUpload,
} from '@/lib/attachments';

const TENANT = 'tnt-att';
const ORG = 'org-att';
const CH = 'ch-att';
const OTHER_CH = 'ch-att-other';
const KAI = 'mbr-att-kai';
const MIRA = 'mbr-att-mira';

const base = { tenantId: TENANT, orgId: ORG, channelId: CH, uploaderId: KAI };

/** A real 1×1 PNG, so the sniffer and the header reader see actual bytes. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** A 2×3 GIF header — enough for the size reader, and it is a real GIF87a. */
const GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x02, 0x00, 0x03, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
]);

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'att-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'att-o' } });
  for (const [id, name, handle] of [
    [KAI, 'Kai', 'att-kai'],
    [MIRA, 'Mira', 'att-mira'],
  ]) {
    await db.member.create({
      data: { id, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: name, handle },
    });
  }
  for (const [id, slug] of [
    [CH, 'att-room'],
    [OTHER_CH, 'att-other'],
  ]) {
    await db.channel.create({
      data: { id, tenantId: TENANT, orgId: ORG, kind: 'channel', name: slug, slug },
    });
  }
});

afterEach(async () => {
  await db.attachment.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
  await rm(join(storageRoot(), ORG), { recursive: true, force: true });
});

describe('what the bytes are', () => {
  test('reads the type from the file, not from what the client claimed', () => {
    expect(sniff(PNG)).toBe('image/png');
  });

  test('an executable renamed .png is still refused', async () => {
    // ELF header. A browser will happily send this as image/png.
    const elf = new Uint8Array(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00], 0);
    const upload = storeUpload({ ...base, name: 'holiday.png', declaredType: 'image/png', data: elf });
    await expect(upload).rejects.toThrow(/contents are not one/);
  });

  test('an SVG is refused however it is labelled', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const upload = storeUpload({ ...base, name: 'logo.svg', declaredType: 'image/svg+xml', data: svg });
    await expect(upload).rejects.toThrow(/cannot be posted/);
  });

  test('an empty file is refused rather than stored', async () => {
    const upload = storeUpload({ ...base, name: 'nothing.png', declaredType: 'image/png', data: new Uint8Array(0) });
    await expect(upload).rejects.toThrow(/empty/);
  });
});

describe('the name', () => {
  test('a path in the name cannot escape the storage root', () => {
    expect(safeName('../../.env')).toBe('.env');
    expect(safeName('C:\\Windows\\system32\\cmd.exe')).toBe('cmd.exe');
  });

  test('control characters are removed, so a header cannot be forged', () => {
    expect(safeName('report\r\nX-Evil: yes.pdf')).toBe('reportX-Evil: yes.pdf');
  });

  test('a name that is nothing but path still produces a name', () => {
    expect(safeName('///')).toBe('file');
  });
});

describe('image size', () => {
  test('reads a PNG header', () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
  });

  test('reads a GIF header', () => {
    expect(imageSize(GIF)).toEqual({ width: 2, height: 3 });
  });

  test('records the size on the row, so the list does not reflow', async () => {
    const stored = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    expect(stored.width).toBe(1);
    expect(stored.height).toBe(1);
    expect(stored.kind).toBe('image');
  });
});

describe('sending them', () => {
  test('links an upload to the message that carries it', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    const linked = await linkToEvent({
      orgId: ORG,
      channelId: CH,
      uploaderId: KAI,
      eventId: 'evt-att-1',
      attachmentIds: [a.id],
    });
    expect(linked).toBe(1);

    const found = await attachmentsForEvents(['evt-att-1']);
    expect(found.get('evt-att-1')?.[0]?.name).toBe('dot.png');
  });

  test('someone else cannot attach your upload to their message', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    const stolen = linkToEvent({
      orgId: ORG,
      channelId: CH,
      uploaderId: MIRA,
      eventId: 'evt-att-2',
      attachmentIds: [a.id],
    });
    await expect(stolen).rejects.toThrow(/not yours/);
  });

  test('an upload cannot be moved into another conversation', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    const moved = linkToEvent({
      orgId: ORG,
      channelId: OTHER_CH,
      uploaderId: KAI,
      eventId: 'evt-att-3',
      attachmentIds: [a.id],
    });
    await expect(moved).rejects.toThrow(/not yours/);
  });

  test('the same upload cannot ride on two messages', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    await linkToEvent({ orgId: ORG, channelId: CH, uploaderId: KAI, eventId: 'evt-att-4', attachmentIds: [a.id] });
    const again = linkToEvent({
      orgId: ORG,
      channelId: CH,
      uploaderId: KAI,
      eventId: 'evt-att-5',
      attachmentIds: [a.id],
    });
    await expect(again).rejects.toThrow(/already been sent/);
  });
});

describe('discarding', () => {
  test('takes back an upload that was never sent', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    await discardUpload(ORG, KAI, a.id);
    expect(await db.attachment.count({ where: { id: a.id } })).toBe(0);
  });

  test('refuses one that has already been sent', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    await linkToEvent({ orgId: ORG, channelId: CH, uploaderId: KAI, eventId: 'evt-att-6', attachmentIds: [a.id] });
    await expect(discardUpload(ORG, KAI, a.id)).rejects.toThrow(/already been sent/);
  });

  test('refuses somebody else\u2019s', async () => {
    const a = await storeUpload({ ...base, name: 'dot.png', declaredType: 'image/png', data: PNG });
    await expect(discardUpload(ORG, MIRA, a.id)).rejects.toThrow(/not yours/);
  });
});
