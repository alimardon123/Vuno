// ADR-0009. The product's premise is that humans and agents are the same kind of
// member. Before the Member migration, Claim had a provenanceAgentId and no
// column for a human at all — so a claim filed by a person recorded that "a
// human" did it and then lost who. HR could not score a person because the
// substrate did not know their name.
//
// These tests are the guard on that. Each one fails against the old schema.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vuno-parity-'));
const dbFile = join(dir, 'test.db');
process.env.DATABASE_URL = `file:${dbFile}`;

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } }, log: ['error'] });

const TENANT = 'tnt-parity';
const ORG = 'org-parity';

beforeAll(async () => {
  const proc = Bun.spawn(
    ['bunx', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    { env: { ...process.env, DATABASE_URL: `file:${dbFile}` }, stdout: 'pipe', stderr: 'pipe' },
  );
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());

  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'parity-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'parity-o' } });

  await db.member.create({
    data: {
      id: 'mbr-human', tenantId: TENANT, orgId: ORG, kind: 'human',
      displayName: 'Mira Okonkwo', handle: 'mira',
      human: { create: { email: 'mira@example.test' } },
    },
  });
  await db.member.create({
    data: {
      id: 'mbr-agent', tenantId: TENANT, orgId: ORG, kind: 'agent',
      displayName: 'Aris', handle: 'aris',
      agent: { create: { role: 'architect' } },
    },
  });
  await db.member.create({
    data: {
      id: 'mbr-bob', tenantId: TENANT, orgId: ORG, kind: 'agent',
      displayName: 'Bob', handle: 'bob',
      agent: { create: { role: 'assistant', ownerMemberId: 'mbr-human' } },
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('parity is a schema property', () => {
  test('a claim filed by a human keeps its author, exactly like one filed by an agent', async () => {
    for (const memberId of ['mbr-human', 'mbr-agent']) {
      const event = await db.event.create({
        data: {
          type: 'ProposalOpened', payload: '{}', tenantId: TENANT, orgId: ORG,
          actorType: 'member', actorMemberId: memberId,
          scopeType: 'project', scopeId: 'proj-1',
        },
      });
      await db.claim.create({
        data: {
          tenantId: TENANT, orgId: ORG,
          statement: `claim from ${memberId}`, status: 'asserted',
          scopeType: 'project', scopeId: 'proj-1',
          provenanceEventId: event.id, provenanceActorType: 'member',
          provenanceMemberId: memberId, updatedAt: new Date(),
        },
      });
    }

    const claims = await db.claim.findMany({
      where: { orgId: ORG },
      include: { provenanceMember: { select: { displayName: true, kind: true } } },
      orderBy: { statement: 'asc' },
    });

    expect(claims).toHaveLength(2);
    // The human's claim is not anonymous. This is the assertion the old schema
    // could not satisfy at all.
    const byHuman = claims.find((c) => c.provenanceMemberId === 'mbr-human');
    expect(byHuman?.provenanceMember?.displayName).toBe('Mira Okonkwo');
    expect(byHuman?.provenanceMember?.kind).toBe('human');

    const byAgent = claims.find((c) => c.provenanceMemberId === 'mbr-agent');
    expect(byAgent?.provenanceMember?.displayName).toBe('Aris');
  });

  test('"everything this member did" is one indexed query, whatever kind they are', async () => {
    for (const memberId of ['mbr-human', 'mbr-agent']) {
      const events = await db.event.findMany({ where: { actorMemberId: memberId } });
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.actorMemberId === memberId)).toBe(true);
    }
  });

  test('a team roster holds humans and agents through the same foreign key', async () => {
    await db.department.create({ data: { id: 'dept-1', tenantId: TENANT, orgId: ORG, name: 'Eng', slug: 'eng' } });
    await db.team.create({ data: { id: 'team-1', tenantId: TENANT, orgId: ORG, departmentId: 'dept-1', name: 'Eng', slug: 'eng' } });

    for (const [memberId, role] of [['mbr-human', 'TEAM_LEAD'], ['mbr-agent', 'MEMBER']] as const) {
      await db.membership.create({
        data: { tenantId: TENANT, orgId: ORG, teamId: 'team-1', memberId, role },
      });
    }

    const roster = await db.membership.findMany({
      where: { teamId: 'team-1' },
      include: { member: { select: { displayName: true, kind: true } } },
    });

    expect(roster).toHaveLength(2);
    expect(new Set(roster.map((m) => m.member.kind))).toEqual(new Set(['human', 'agent']));
    // The lead is a human and the member is an agent — the rows are identical in shape.
    expect(roster.find((m) => m.role === 'TEAM_LEAD')?.member.kind).toBe('human');
  });
});

describe('delegated action', () => {
  test('an assistant acting under delegation records both itself and the authority', async () => {
    const event = await db.event.create({
      data: {
        type: 'MessagePosted', payload: JSON.stringify({ body: 'Filed on your behalf.' }),
        tenantId: TENANT, orgId: ORG,
        actorType: 'member',
        actorMemberId: 'mbr-bob',          // who executed
        onBehalfOfMemberId: 'mbr-human',   // whose authority
        scopeType: 'channel', scopeId: 'ch-1',
      },
      include: {
        actor: { select: { displayName: true } },
        onBehalfOf: { select: { displayName: true } },
      },
    });

    // Bob renders as Bob. The owner is the authority, never the identity.
    expect(event.actor?.displayName).toBe('Bob');
    expect(event.onBehalfOf?.displayName).toBe('Mira Okonkwo');
  });

  test('an ordinary message carries no delegation', async () => {
    const event = await db.event.create({
      data: {
        type: 'MessagePosted', payload: JSON.stringify({ body: 'Just me.' }),
        tenantId: TENANT, orgId: ORG,
        actorType: 'member', actorMemberId: 'mbr-human',
        scopeType: 'channel', scopeId: 'ch-1',
      },
    });
    expect(event.onBehalfOfMemberId).toBeNull();
  });

  test('an assistant knows who it works for; an independent agent does not', async () => {
    const bob = await db.agentProfile.findUnique({ where: { memberId: 'mbr-bob' } });
    const aris = await db.agentProfile.findUnique({ where: { memberId: 'mbr-agent' } });
    expect(bob?.ownerMemberId).toBe('mbr-human');
    expect(aris?.ownerMemberId).toBeNull();
  });
});
