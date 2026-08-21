import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { projectChatMessages } from '@/lib/events/project';

export const dynamic = 'force-dynamic';

// GET /api/events?scopeType=channel&scopeId=<id>&fromSeq=<n>&types=<t1,t2>
// Returns events in seq order for a scope. If no scope given, returns all.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const scopeType = params.get('scopeType') ?? undefined;
  const scopeId = params.get('scopeId') ?? undefined;
  const fromSeqRaw = params.get('fromSeq');
  const fromSeq = fromSeqRaw ? Number(fromSeqRaw) : undefined;
  const typesRaw = params.get('types');
  const types = typesRaw ? (typesRaw.split(',') as never[]) : undefined;
  const project = params.get('project') === 'true';

  // find first tenant/org (v1 = single-tenant)
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) {
    return NextResponse.json({ events: [], chatMessages: [] });
  }

  const spine = new EventSpine(org.tenantId, org.id);
  const events = await spine.replay({ scopeType, scopeId, fromSeq, types, limit: 500 });

  if (project) {
    return NextResponse.json({ events, chatMessages: projectChatMessages(events) });
  }
  return NextResponse.json({ events });
}
