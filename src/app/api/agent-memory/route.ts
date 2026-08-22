// Vuno — /api/agent-memory (Tier 1: Agent Private Memory)
// Per the vision doc §6: "Agent private: Working notes, in-progress
// reasoning. Visible to that agent only."
//
// Each agent's private scratchpad. Not visible to other agents or humans.
// This is where agents store working hypotheses, TODO lists, context from
// past interactions — before producing org-visible AgentThought events.
//
// GET /api/agent-memory?agentId=X — returns private memories for agent X
// POST /api/agent-memory — set/update a private memory

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const agentId = params.get('agentId');
  const category = params.get('category');

  if (!agentId) {
    return NextResponse.json({ ok: false, error: 'agentId required' }, { status: 400 });
  }

  const where: Record<string, unknown> = { agentId };
  if (category) where.category = category;

  const memories = await db.agentMemory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    memories: memories.map((m) => ({
      ...m,
      value: (() => { try { return JSON.parse(m.value); } catch { return m.value; } })(),
    })),
    count: memories.length,
  });
}

interface PostBody {
  agentId: string;
  key: string;
  value: string;
  category?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body?.agentId || !body?.key || body?.value === undefined) {
      return NextResponse.json({ ok: false, error: 'agentId, key, and value required' }, { status: 400 });
    }

    const org = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, id: true },
    });
    if (!org) return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });

    const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);

    const memory = await db.agentMemory.upsert({
      where: { agentId_key: { agentId: body.agentId, key: body.key } },
      update: { value, category: body.category ?? 'working', updatedAt: new Date() },
      create: {
        tenantId: org.tenantId, orgId: org.id, agentId: body.agentId,
        key: body.key, value, category: body.category ?? 'working',
      },
    });

    return NextResponse.json({ ok: true, memory: { ...memory, value: (() => { try { return JSON.parse(value); } catch { return value; } })() } });
  } catch (err) {
    console.error('POST /api/agent-memory failed:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
