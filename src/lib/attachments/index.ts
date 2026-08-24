// Vuno — files posted in a conversation.
//
// Three decisions worth stating, because each one is a place this is usually
// got wrong:
//
//   1. **Nothing goes under `public/`.** A file in a static directory is
//      readable by anyone holding the URL, which would make an attachment the
//      one part of a private DM with no access control. These live outside the
//      web root and are served by a route that asks the same question the
//      message list asks.
//   2. **The stored name is never the uploaded name.** A file called
//      `../../.env` is a request to write outside the storage root, and one
//      called `report.pdf.exe` is a request to be misread. What is stored is an
//      id; the original name is a column, used for the download and the label.
//   3. **The mime type is decided here, not taken from the client.** A browser
//      will happily say a `.svg` is `image/png`, and an SVG rendered inline is
//      script execution on this origin.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { db } from '@/lib/db';

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}

/** Where files live. Outside `public/`, and overridable for a different disk. */
export function storageRoot(): string {
  return process.env.VUNO_STORAGE_DIR
    ? resolve(process.env.VUNO_STORAGE_DIR)
    : join(process.cwd(), 'storage');
}

/** The biggest single file. Generous for a screenshot, mean for a video. */
export const MAX_BYTES = 25 * 1024 * 1024;

/** How many may ride on one message. */
export const MAX_PER_MESSAGE = 10;

/**
 * What may be uploaded, and what each becomes on screen.
 *
 * An allowlist rather than a blocklist: a blocklist is a list of the attacks
 * somebody thought of. SVG is deliberately absent — it is a document that can
 * carry script, and rendering one inline runs that script on this origin.
 */
const ALLOWED: Record<string, { kind: 'image' | 'audio' | 'file'; ext: string }> = {
  'image/png': { kind: 'image', ext: 'png' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/gif': { kind: 'image', ext: 'gif' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'audio/webm': { kind: 'audio', ext: 'webm' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'application/pdf': { kind: 'file', ext: 'pdf' },
  'text/plain': { kind: 'file', ext: 'txt' },
  'text/markdown': { kind: 'file', ext: 'md' },
  'text/csv': { kind: 'file', ext: 'csv' },
  'application/json': { kind: 'file', ext: 'json' },
  'application/zip': { kind: 'file', ext: 'zip' },
};

/**
 * Types with no magic number, where the client's word is all there is.
 *
 * Everything else in the allowlist has a recognisable header, so a file
 * claiming to be one and not matching is refused rather than trusted. Without
 * this the sniffer is decoration: an ELF binary named `holiday.png` sniffs as
 * nothing, falls back to the declared `image/png`, and is stored.
 */
const UNSNIFFABLE = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

/**
 * What the bytes actually are, from the bytes.
 *
 * Only the formats that matter for the decision: an image is rendered inline,
 * so being wrong about one is the difference between a picture and a script.
 */
export function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  const ascii = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  // Matroska/WebM share a header; a webm from MediaRecorder is audio here.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) return 'application/zip';
  return null;
}

export interface StoredAttachment {
  id: string;
  kind: 'image' | 'audio' | 'file';
  name: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/**
 * The pixel size of a PNG, JPEG, GIF or WebP, read from its header.
 *
 * Worth the eighty lines: without it the message list reflows as every image
 * loads, which is the single most obvious way a chat app feels cheap. `sharp`
 * is in the tree and would do this too, but it is a native module on the
 * request path for four header reads.
 */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const be32 = (i: number) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le32 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);

  // PNG: IHDR is always the first chunk.
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) {
    return { width: be32(16), height: be32(20) };
  }
  // GIF: logical screen descriptor, little-endian.
  if (b[0] === 0x47 && b[1] === 0x49 && b.length > 10) {
    return { width: le16(6), height: le16(8) };
  }
  // WebP, the lossy VP8 and lossless VP8L cases.
  if (b.length > 30 && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    const fourcc = String.fromCharCode(...b.slice(12, 16));
    if (fourcc === 'VP8X') return { width: (le32(24) & 0xffffff) + 1, height: (le32(27) & 0xffffff) + 1 };
    if (fourcc === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (fourcc === 'VP8L') {
      const bits = le32(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG: walk the segments to the start-of-frame, which carries the size.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      // SOF0..SOF15, excluding the four that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

/** A name safe to show, with the path components and control characters gone. */
export function safeName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? 'file';
  // Control characters written as escapes, not as themselves: a literal
  // newline inside a Content-Disposition header is a way to add headers of
  // your own, and a literal control byte in source is a thing editors eat.
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean.length > 0 ? clean.slice(0, 180) : 'file';
}

export async function storeUpload(input: {
  tenantId: string;
  orgId: string;
  channelId: string;
  uploaderId: string;
  name: string;
  declaredType: string;
  data: Uint8Array;
  /** Set by the recorder for a voice note; the browser knows, the file may not. */
  durationMs?: number | null;
}): Promise<StoredAttachment> {
  if (input.data.byteLength === 0) {
    throw new AttachmentError('That file is empty.');
  }
  if (input.data.byteLength > MAX_BYTES) {
    const mb = (input.data.byteLength / 1024 / 1024).toFixed(1);
    throw new AttachmentError(`That file is ${mb} MB and the limit is ${MAX_BYTES / 1024 / 1024} MB.`, 413);
  }

  // The bytes decide. The client only gets a vote where the bytes are silent,
  // and only for the types that have nothing to say — a text file has no magic
  // number, a PNG does, and a file claiming to be a PNG that is not one is a
  // file lying about itself.
  const sniffed = sniff(input.data);
  const declared = input.declaredType.split(';')[0].trim().toLowerCase();

  // Two different refusals, because they need two different fixes. A type this
  // org does not take is answered first, so an SVG is told it is an SVG rather
  // than told it is lying.
  const claimed = sniffed ?? declared;
  const allowed = ALLOWED[claimed];
  if (!allowed) {
    throw new AttachmentError(
      `${safeName(input.name)} is a ${claimed || 'unknown'} file, which cannot be posted here. Images, audio, PDFs, text and zips can.`,
    );
  }
  if (!sniffed && !UNSNIFFABLE.has(declared)) {
    throw new AttachmentError(
      `${safeName(input.name)} says it is a ${declared} file and its contents are not one.`,
    );
  }
  const mimeType = claimed;

  const id = randomUUID();
  // Sharded by org and date so one directory never holds a hundred thousand
  // files — every filesystem has an opinion about that and none of them is good.
  const now = new Date();
  const rel = join(
    input.orgId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${id}.${allowed.ext}`,
  );
  const abs = join(storageRoot(), rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, input.data);

  const size = allowed.kind === 'image' ? imageSize(input.data) : null;

  const row = await db.attachment.create({
    data: {
      id,
      tenantId: input.tenantId,
      orgId: input.orgId,
      channelId: input.channelId,
      uploaderId: input.uploaderId,
      kind: allowed.kind,
      name: safeName(input.name),
      mimeType,
      bytes: input.data.byteLength,
      path: rel,
      width: size?.width ?? null,
      height: size?.height ?? null,
      durationMs: allowed.kind === 'audio' ? (input.durationMs ?? null) : null,
    },
  });

  return {
    id: row.id,
    kind: allowed.kind,
    name: row.name,
    mimeType: row.mimeType,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
  };
}

/**
 * Attach uploads to the event that carries them.
 *
 * Scoped to the uploader and the conversation: an id is a guess away from
 * another conversation's file, and without this the guess would work.
 */
export async function linkToEvent(input: {
  orgId: string;
  channelId: string;
  uploaderId: string;
  eventId: string;
  attachmentIds: string[];
}): Promise<number> {
  if (input.attachmentIds.length === 0) return 0;
  if (input.attachmentIds.length > MAX_PER_MESSAGE) {
    throw new AttachmentError(`One message can carry ${MAX_PER_MESSAGE} files.`);
  }
  const { count } = await db.attachment.updateMany({
    where: {
      id: { in: input.attachmentIds },
      orgId: input.orgId,
      channelId: input.channelId,
      uploaderId: input.uploaderId,
      eventId: null,
    },
    data: { eventId: input.eventId },
  });
  if (count !== input.attachmentIds.length) {
    throw new AttachmentError('One of those files is not yours to send, or has already been sent.', 409);
  }
  return count;
}

/** What one event carries, for the message list. */
export async function attachmentsForEvents(eventIds: string[]): Promise<Map<string, StoredAttachment[]>> {
  const byEvent = new Map<string, StoredAttachment[]>();
  if (eventIds.length === 0) return byEvent;

  const rows = await db.attachment.findMany({
    where: { eventId: { in: eventIds } },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) {
    if (!r.eventId) continue;
    const list = byEvent.get(r.eventId) ?? [];
    list.push({
      id: r.id,
      kind: r.kind as StoredAttachment['kind'],
      name: r.name,
      mimeType: r.mimeType,
      bytes: r.bytes,
      width: r.width,
      height: r.height,
      durationMs: r.durationMs,
    });
    byEvent.set(r.eventId, list);
  }
  return byEvent;
}

/** Discard an upload that was never sent. Only the uploader's own drafts. */
export async function discardUpload(orgId: string, uploaderId: string, id: string): Promise<void> {
  const row = await db.attachment.findFirst({
    where: { id, orgId, uploaderId, eventId: null },
    select: { id: true, path: true },
  });
  if (!row) throw new AttachmentError('That upload is not yours, or has already been sent.', 404);

  await db.attachment.delete({ where: { id: row.id } });
  // The row is the record; a file left on disk with no row is invisible either
  // way, so the delete failing is not worth failing the request over.
  await unlink(join(storageRoot(), row.path)).catch(() => {});
}

/** A weak validator for the browser cache. Content-addressed, so it never lies. */
export function etagFor(id: string, bytes: number): string {
  return `"${createHash('sha1').update(`${id}:${bytes}`).digest('hex').slice(0, 16)}"`;
}
