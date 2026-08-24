// Vuno — /api/files/[id]
//
// Serving an attachment, with the same question the message list asks: may this
// viewer read the conversation it was posted in. A file under `public/` would
// skip this entirely, which is why none of them are there.
//
// Two headers do most of the security work here:
//
//   `Content-Disposition: attachment` on everything that is not rendered
//   inline, so a `.html` that slipped through downloads instead of executing.
//
//   `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`,
//   so a browser that decides it knows better than the type we sent still
//   cannot run what it finds.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { canRead, getConversation } from '@/lib/conversations';
import { etagFor, storageRoot } from '@/lib/attachments';

export const dynamic = 'force-dynamic';

/** Rendered in place rather than downloaded. Images and audio only. */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav']);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return new Response('Sign in first.', { status: 401 });

  const { id } = await ctx.params;
  const row = await db.attachment.findUnique({
    where: { id },
    select: { id: true, orgId: true, channelId: true, name: true, mimeType: true, bytes: true, path: true },
  });
  // The same 404 for missing and forbidden: telling the two apart is what a
  // probe is for.
  if (!row) return new Response('Not found.', { status: 404 });

  const conversation = await getConversation(row.orgId, row.channelId, 'system');
  if (!conversation || !canRead(conversation, viewer)) return new Response('Not found.', { status: 404 });

  const abs = join(storageRoot(), row.path);
  let size: number;
  try {
    size = (await stat(abs)).size;
  } catch {
    // The row survived and the file did not. Saying so beats a 500 nobody can
    // act on — it names a real state somebody has to clean up.
    return new Response('That file is recorded but missing from disk.', { status: 410 });
  }

  const etag = etagFor(row.id, row.bytes);
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const inline = INLINE.has(row.mimeType);
  const headers = new Headers({
    'Content-Type': row.mimeType,
    'Content-Length': String(size),
    ETag: etag,
    // Private: this is one viewer's conversation, and a shared cache holding it
    // would hand it to the next person through the same proxy.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
  });

  // Streamed rather than buffered: a 25 MB file read into memory per request
  // is 25 MB per concurrent reader, and the point of a limit is that somebody
  // will reach it.
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, { headers });
}
