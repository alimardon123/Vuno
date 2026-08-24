import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assertClaim, IllegalTransition, transitionClaim } from '@/lib/ledger/claims';

export const dynamic = 'force-dynamic';

// GET /api/claims?scopeType=project&scopeId=<id>&status=<status>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const scopeType = params.get('scopeType') ?? undefined;
  const scopeId = params.get('scopeId') ?? undefined;
  const status = params.get('status') ?? undefined;

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ claims: [] });

  const where: Record<string, unknown> = { orgId: org.id };
  if (scopeType) where.scopeType = scopeType;
  if (scopeId) where.scopeId = scopeId;
  if (status) where.status = status;

  const claims = await db.claim.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    claims: claims.map((c) => ({
      ...c,
      evidenceIds: JSON.parse(c.evidenceIds),
      contradictsIds: JSON.parse(c.contradictsIds),
    })),
  });
}

// ─── POST /api/claims ────────────────────────────────────────────────────────
// Assert a claim, or move one. These are the only two things that happen to a
// claim: it is stated once, and thereafter it transitions (ADR-0005). There is
// no endpoint that writes a status directly, which is why the ledger's history
// cannot disagree with its rows.

const assertBody = z.object({
  action: z.literal('assert'),
  statement: z.string().min(1).max(500),
  scopeType: z.string().min(1).default('project'),
  scopeId: z.string().min(1),
  memberId: z.string().optional(),
});

const transitionBody = z.object({
  action: z.literal('transition'),
  claimId: z.string().min(1),
  to: z.enum(['asserted', 'believed', 'tested', 'falsified', 'uncertain']),
  reason: z.string().min(1).max(1000),
  evidenceEventIds: z.array(z.string()).optional(),
  memberId: z.string().optional(),
});

const postBody = z.discriminatedUnion('action', [assertBody, transitionBody]);

export async function POST(req: Request) {
  let parsed: z.infer<typeof postBody>;
  try {
    parsed = postBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Invalid body' },
      { status: 400 },
    );
  }

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) {
    return NextResponse.json(
      { ok: false, error: 'No organization found. Run `bun run setup` first.' },
      { status: 409 },
    );
  }

  if (parsed.action === 'assert') {
    const result = await assertClaim({
      tenantId: org.tenantId,
      orgId: org.id,
      statement: parsed.statement,
      scopeType: parsed.scopeType,
      scopeId: parsed.scopeId,
      memberId: parsed.memberId ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  try {
    const result = await transitionClaim({
      claimId: parsed.claimId,
      to: parsed.to,
      reason: parsed.reason,
      evidenceEventIds: parsed.evidenceEventIds,
      memberId: parsed.memberId ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof IllegalTransition) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
