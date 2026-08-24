// Vuno — apps, and the surfaces they turn on.
//
// An app is a whole feature somebody adds to the org: a board, a call button, a
// meeting scheduler. That is what Extensions is for, and it is a different
// question from what any one member is made of — skills, plugins and connectors
// answer that, and they are in Settings.
//
// The rule that keeps this honest: **every app in the catalogue controls a
// surface that visibly appears and disappears.** A catalogue of things that
// install nothing is a brochure, and this codebase removed one of those once
// already (docs/REVIEW-2026-08-23.md).
//
// Two of them are `core: true` — always on, listed so the catalogue tells the
// truth about what is in the product rather than showing only the optional
// half. They have no Remove button, and the row says why.

import { db } from '@/lib/db';

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface AppDefinition {
  key: string;
  name: string;
  summary: string;
  /** Where it shows up once it is on, in the words of the navigation. */
  surface: string;
  /** Part of the product, not removable. Listed so the catalogue is complete. */
  core?: boolean;
  /** On for a new org. Everything optional currently is. */
  defaultOn?: boolean;
}

/**
 * The apps that ship with this build.
 *
 * Adding one means building the surface first and listing it second. The order
 * here is the order the catalogue renders in.
 */
export const APPS: AppDefinition[] = [
  {
    key: 'boards',
    name: 'Boards',
    summary:
      'A board over the objectives the org already has. Every card is real work — moving one records a stage change on the spine, so the board is not a second to-do system that drifts from the first.',
    surface: 'A Board view in Work',
    defaultOn: true,
  },
  {
    key: 'org-chart',
    name: 'Org chart',
    summary:
      'The shape of the org as a graph: departments, teams, and who is in them — including how much of each team is people and how much is agents.',
    surface: 'An Org view in Members',
    defaultOn: true,
  },
  {
    key: 'calls',
    name: 'Calls',
    summary:
      'Voice and video in any conversation, peer to peer. No media passes through the server, which is also why it is a small-room feature rather than a webinar one.',
    surface: 'A call button in every conversation',
    defaultOn: true,
  },
  {
    key: 'meetings',
    name: 'Meetings',
    summary:
      'A meeting is a conversation with a time on it. Scheduled in the room it belongs to, so the agenda, the messages and the recording of what was decided are the same thread.',
    surface: 'Meetings in a conversation header',
    defaultOn: true,
  },
  {
    key: 'ledger',
    name: 'Ledger',
    summary:
      'Every claim the org holds, with its status and the evidence that moved it. Release gates read from it, which is why it cannot be turned off.',
    surface: 'The Ledger destination',
    core: true,
  },
  {
    key: 'review',
    name: 'Review',
    summary:
      'Claim survival, objection precision, escalation rate and spend, computed from the spine rather than reported by anyone.',
    surface: 'A Review view in Members',
    core: true,
  },
];

const BY_KEY = new Map(APPS.map((a) => [a.key, a]));

export interface AppRow extends AppDefinition {
  installed: boolean;
  installedAt: string | null;
}

/**
 * Which apps are on for this org.
 *
 * A core app is always on. An optional one is on when there is a row for it, or
 * when nothing has ever been decided and it defaults on — an org that predates
 * this table should not lose its board because the table is empty.
 */
export async function appsFor(orgId: string): Promise<AppRow[]> {
  const rows = await db.appInstall.findMany({ where: { orgId }, select: { key: true, installedAt: true } });
  const installed = new Map(rows.map((r) => [r.key, r.installedAt]));
  // Once anything has been recorded, the record is the answer. Before that,
  // defaults apply — otherwise the first Remove would appear to turn on
  // everything else.
  const decided = rows.length > 0;

  return APPS.map((a) => {
    const at = installed.get(a.key);
    return {
      ...a,
      installed: a.core || (at !== undefined ? true : !decided && Boolean(a.defaultOn)),
      installedAt: at ? at.toISOString() : null,
    };
  });
}

/** Whether one surface should render. The one call the pages make. */
export async function isAppOn(orgId: string, key: string): Promise<boolean> {
  const app = BY_KEY.get(key);
  if (!app) return false;
  if (app.core) return true;

  const [row, any] = await Promise.all([
    db.appInstall.findFirst({ where: { orgId, key }, select: { id: true } }),
    db.appInstall.findFirst({ where: { orgId }, select: { id: true } }),
  ]);
  if (row) return true;
  return any === null && Boolean(app.defaultOn);
}

export async function setApp(input: {
  tenantId: string;
  orgId: string;
  key: string;
  on: boolean;
  memberId: string;
}): Promise<void> {
  const app = BY_KEY.get(input.key);
  if (!app) throw new AppError(`There is no app called "${input.key}" in this build.`, 404);
  if (app.core) {
    throw new AppError(`${app.name} is part of the product and cannot be removed.`, 409);
  }

  if (input.on) {
    await db.appInstall.upsert({
      where: { orgId_key: { orgId: input.orgId, key: input.key } },
      create: { tenantId: input.tenantId, orgId: input.orgId, key: input.key, installedBy: input.memberId },
      update: {},
    });
    return;
  }

  // Removing the first app has to write rows for everything else that was on by
  // default, or the next read would see an empty table and turn them all back on.
  const existing = await db.appInstall.count({ where: { orgId: input.orgId } });
  if (existing === 0) {
    await db.appInstall.createMany({
      data: APPS.filter((a) => !a.core && a.defaultOn && a.key !== input.key).map((a) => ({
        tenantId: input.tenantId,
        orgId: input.orgId,
        key: a.key,
        installedBy: input.memberId,
      })),
    });
    return;
  }

  await db.appInstall.deleteMany({ where: { orgId: input.orgId, key: input.key } });
}
