// Vuno — /api/personal-memory (Tier 2: Personal Assistant Memory)
// Per the vision doc §6: "Personal assistant: Owner's files, history,
// preferences. Visible to owner only."
//
// Bob (Kai's personal assistant) accumulates Kai's preferences over time.
// Key-value store per agent+owner. Queryable by the agent for context.
//
// GET /api/personal-memory?agentId=X — returns all memories for agent X
// POST /api/personal-memory — set/update a memory (key-value)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — query personal memories for an agent
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const agentId = params.get('agentId');
  const category = params.get('category'); // optional filter

  if (!agentId) {
    return NextResponse.json({ ok: false, error: 'agentId required' }, { status: 400 });
  }

  const where: Record<string, unknown> = { agentId };
  if (category) where.category = category;

  const memories = await db.personalMemory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    memories: memories.map((m) => ({
      ...m,
      value: (() => {
        try { return JSON.parse(m.value); } catch { return m.value; }
      })(),
    })),
    count: memories.length,
  });
}

// POST — set or update a personal memory
interface PostBody {
  agentId: string;
  ownerHumanId: string;
  key: string;
  value: string;
  category?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body?.agentId || !body?.key || body?.value === undefined) {
      return NextResponse.json(
        { ok: false, error: 'agentId, key, and value required' },
        { status: 400 },
      );
    }

    const org = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, id: true },
    });
    if (!org) {
      return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });
    }

    const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);

    // Upsert: if the key exists for this agent, update it; otherwise create
    const memory = await db.personalMemory.upsert({
      where: {
        agentId_key: { agentId: body.agentId, key: body.key },
      },
      update: {
        value,
        category: body.category ?? 'preference',
        ownerHumanId: body.ownerHumanId,
        updatedAt: new Date(),
      },
      create: {
        tenantId: org.tenantId,
        orgId: org.id,
        agentId: body.agentId,
        ownerHumanId: body.ownerHumanId,
        key: body.key,
        value,
        category: body.category ?? 'preference',
      },
    });

    return NextResponse.json({ ok: true, memory: { ...memory, value: (() => { try { return JSON.parse(value); } catch { return value; } })() } });
  } catch (err) {
    console.error('POST /api/personal-memory failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
