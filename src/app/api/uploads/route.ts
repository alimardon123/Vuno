// Vuno — /api/uploads
//
// Upload first, send second. That is what lets the composer show a preview and
// a size before anything is posted, and it is why an attachment is created
// against a conversation rather than against a message that does not exist yet.
//
// The access question is asked here and not deferred: uploading into a DM you
// cannot read would put a file in somebody else's conversation, and the fact
// that no message references it yet does not make that all right.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { canRead, getConversation } from '@/lib/conversations';
import { AttachmentError, discardUpload, MAX_BYTES, storeUpload } from '@/lib/attachments';
import { takeWrite } from '@/lib/limits';

export const dynamic = 'force-dynamic';

function fail(e: unknown) {
  if (e instanceof AttachmentError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

export async function POST(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // The same limit as a message: uploading is a write, and a loop that posts
  // files fills the disk rather than the spine, which is worse.
  const limit = takeWrite(viewer.id);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `That is a lot of uploads at once. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'That upload did not arrive as a file.' }, { status: 400 });
  }

  const file = form.get('file');
  const channelId = String(form.get('channelId') ?? '');
  const rawDuration = form.get('durationMs');

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file in that request.' }, { status: 400 });
  }
  if (!channelId) {
    return NextResponse.json({ ok: false, error: 'No conversation named.' }, { status: 400 });
  }
  // Checked before the bytes are read: refusing after buffering 200 MB has
  // already done the damage the limit exists to prevent.
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB and the limit is ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  const conversation = await getConversation(org.id, channelId, 'system');
  if (!conversation || !canRead(conversation, viewer)) {
    // Same answer for "no such conversation" and "not yours": the difference
    // between them is exactly what a probe is looking for.
    return NextResponse.json({ ok: false, error: 'That conversation is not open to you.' }, { status: 404 });
  }

  try {
    const stored = await storeUpload({
      tenantId: org.tenantId,
      orgId: org.id,
      channelId,
      uploaderId: viewer.id,
      name: file.name,
      declaredType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
      durationMs: rawDuration ? Number(rawDuration) || null : null,
    });
    return NextResponse.json({ ok: true, attachment: stored });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'No upload named.' }, { status: 400 });

  try {
    await discardUpload(org.id, viewer.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
