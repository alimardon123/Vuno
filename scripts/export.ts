#!/usr/bin/env bun
// Take the org out.
//
//   bun run export                    a JSON snapshot, to stdout
//   bun run export > org.json         …or to a file
//   bun run export --backup           copy the database file instead
//
// The whole org is one SQLite file and nothing said so, which is the kind of
// thing people discover the week after they needed to know it. Two ways out,
// because they answer different questions: the copy is what you restore from,
// and the JSON is what you read, diff, or move somewhere that is not SQLite.
//
// The event spine is the org — every message, claim transition and role change
// is in it, in order — so the JSON leads with it.

import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { db } from '../src/lib/db';

const root = join(import.meta.dir, '..');

function databaseFile(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith('file:')) return null;
  const path = url.slice('file:'.length);
  return isAbsolute(path) ? path : resolve(root, 'prisma', path);
}

if (process.argv.includes('--backup')) {
  const file = databaseFile();
  if (!file || !existsSync(file)) {
    console.error(`✗ No database file at ${file ?? '(DATABASE_URL is not a file: url)'}`);
    process.exit(1);
  }

  // WAL means recent writes may still be in the -wal sidecar. A checkpoint
  // folds them in, so the copy is the whole database rather than most of it.
  await db.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dirname(file), `backup-${stamp}.db`);
  await copyFile(file, target);
  console.error(`✓ ${target}`);
  process.exit(0);
}

const org = await db.organization.findFirst({
  orderBy: { createdAt: 'asc' },
  include: { tenant: true },
});
if (!org) {
  console.error('✗ No organisation to export. Run `bun run setup` first.');
  process.exit(1);
}

const where = { orgId: org.id };

const [events, members, humans, agents, departments, teams, memberships, channels, channelMembers,
  claims, objectives, projects, decisions, experiments, gates, workItems, workSessions, skills, memberSkills] =
  await Promise.all([
    db.event.findMany({ where, orderBy: { seq: 'asc' } }),
    db.member.findMany({ where, orderBy: { createdAt: 'asc' } }),
    db.humanProfile.findMany({ where: { member: where } }),
    db.agentProfile.findMany({ where: { member: where } }),
    db.department.findMany({ where }),
    db.team.findMany({ where }),
    db.membership.findMany({ where }),
    db.channel.findMany({ where }),
    db.channelMember.findMany({ where }),
    db.claim.findMany({ where, orderBy: { createdAt: 'asc' } }),
    db.objective.findMany({ where }),
    db.project.findMany({ where }),
    db.decision.findMany({ where }),
    db.experiment.findMany({ where }),
    db.gate.findMany({ where }),
    db.workItem.findMany({ where }),
    db.workSession.findMany({ where }),
    db.skill.findMany({ where }),
    db.memberSkill.findMany({ where }),
  ]);

// Password hashes and live sessions are not part of the org's history, and an
// export that carries them is a credential file people email to each other.
const safeHumans = humans.map(({ passwordHash: _passwordHash, ...rest }) => rest);

console.log(
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      format: 'vuno-org-export/1',
      note: 'Password hashes and sessions are deliberately not included.',
      tenant: org.tenant,
      organization: { ...org, tenant: undefined },
      // The spine first: it is the org, and everything else is a projection.
      events,
      members,
      humanProfiles: safeHumans,
      agentProfiles: agents,
      departments,
      teams,
      memberships,
      channels,
      channelMembers,
      claims,
      objectives,
      projects,
      decisions,
      experiments,
      gates,
      workItems,
      workSessions,
      skills,
      memberSkills,
    },
    null,
    2,
  ),
);

console.error(
  `✓ ${events.length} events, ${members.length} members, ${claims.length} claims, ${channels.length} conversations`,
);
process.exit(0);
