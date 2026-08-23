// Vuno — Event spine writer
// Per ADR-0004: append-only. The ONLY way to insert events.
// Per ADR-0008: the database owns `seq`. Application code never computes it.
//
// The previous implementation read MAX(seq) and then inserted, inside an
// interactive transaction per call. That had two failure modes under the
// concurrency the orchestrator introduces: two callers could read the same
// maximum and collide on the unique index, and 50 concurrent interactive
// transactions deadlocked against SQLite's single writer and timed out at 5s.
// Both are gone now that `seq` is an AUTOINCREMENT primary key — there is
// nothing to read, and a batch is one short transaction rather than a
// long-held interactive one.

import { db } from '@/lib/db';
import type { EventRecord, NewEventInput, EventType } from './types';

export class EventSpine {
  constructor(
    private readonly tenantId: string,
    private readonly orgId: string,
  ) {}

  /**
   * Append one or more events atomically. All events in a batch share a
   * transaction; if any fails, none are persisted. Never updates or deletes.
   */
  async append(inputs: NewEventInput[]): Promise<EventRecord[]> {
    if (inputs.length === 0) return [];

    const data = inputs.map((input) => ({
      type: input.type,
      payload: JSON.stringify(input.payload),
      tenantId: this.tenantId,
      orgId: this.orgId,
      actorType: input.actorType,
      actorMemberId: input.actorMemberId ?? null,
      onBehalfOfMemberId: input.onBehalfOfMemberId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      visibility: input.visibility ?? 'org',
    }));

    // Single event: one statement, no transaction to hold.
    if (data.length === 1) {
      const row = await db.event.create({ data: data[0] });
      return [toRecord(row)];
    }

    // Batch: the array form of $transaction is one short-lived transaction,
    // not an interactive one held open across round trips.
    const rows = await db.$transaction(data.map((d) => db.event.create({ data: d })));
    return rows.map(toRecord);
  }

  /**
   * Replay events for a scope, optionally from a seq offset (for time-travel).
   */
  async replay(opts: {
    scopeType?: string;
    scopeId?: string;
    fromSeq?: number;
    types?: EventType[];
    limit?: number;
  }): Promise<EventRecord[]> {
    const where: Record<string, unknown> = {
      tenantId: this.tenantId,
      orgId: this.orgId,
    };
    if (opts.scopeType) where.scopeType = opts.scopeType;
    if (opts.scopeId) where.scopeId = opts.scopeId;
    if (opts.fromSeq !== undefined) where.seq = { gte: opts.fromSeq };
    if (opts.types && opts.types.length > 0) where.type = { in: opts.types };

    const rows = await db.event.findMany({
      where,
      orderBy: { seq: 'asc' },
      take: opts.limit ?? 1000,
    });

    return rows.map(toRecord);
  }
}

function toRecord(row: {
  payload: string | unknown;
  actorMemberId: string | null;
  onBehalfOfMemberId: string | null;
  [k: string]: unknown;
}): EventRecord {
  return {
    ...row,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    actorMemberId: row.actorMemberId ?? undefined,
    onBehalfOfMemberId: row.onBehalfOfMemberId ?? undefined,
  } as unknown as EventRecord;
}
