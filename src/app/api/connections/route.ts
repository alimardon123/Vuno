// Vuno — /api/connections
//
// The other half of the Library. A connection is what a member can reach;
// holding one is the permission to call it, so assignment lives here beside
// the skills for the same reason.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  checkConnection,
  ConnectionError,
  createConnection,
  deleteConnection,
  listConnections,
  setConnectionHolder,
} from '@/lib/connections';

export const dynamic = 'force-dynamic';

async function currentOrg() {
  return db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
}

function fail(e: unknown) {
  if (e instanceof ConnectionError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }
  throw e;
}

export async function GET() {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ connections: [] });
  return NextResponse.json({ connections: await listConnections(org.id) });
}

const createBody = z.object({
  key: z.string().min(2).max(60),
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(240),
  url: z.string().min(1).max(2_000),
  authEnvVar: z.string().max(64).nullish(),
});

export async function POST(req: Request) {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  try {
    const parsed = createBody.parse((await req.json()) as unknown);
    const { id } = await createConnection({ tenantId: org.tenantId, orgId: org.id, ...parsed });
    // Dial it straight away. A connection added and never checked is a row
    // claiming a capability nobody has confirmed the org has.
    const row = await checkConnection(org.id, id);
    return NextResponse.json({ ok: true, connectionId: id, connection: row });
  } catch (e) {
    return fail(e);
  }
}

const patchBody = z.union([
  z.object({ connectionId: z.string().min(1), memberId: z.string().min(1), held: z.boolean() }),
  z.object({ connectionId: z.string().min(1), check: z.literal(true) }),
]);

export async function PATCH(req: Request) {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  try {
    const parsed = patchBody.parse((await req.json()) as unknown);
    if ('check' in parsed) {
      const row = await checkConnection(org.id, parsed.connectionId);
      // A check that found the server down is a successful check with bad news,
      // not a failed request — the row now says what is wrong.
      return NextResponse.json({ ok: true, connection: row });
    }
    await setConnectionHolder({ orgId: org.id, ...parsed });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  const connectionId = new URL(req.url).searchParams.get('connectionId');
  if (!connectionId) return NextResponse.json({ ok: false, error: 'connectionId is required.' }, { status: 400 });
  try {
    await deleteConnection(org.id, connectionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
