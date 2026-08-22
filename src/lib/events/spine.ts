// Vuno — Event spine writer
// Per ADR-0004: append-only. The ONLY way to insert events.
// Assigns monotonic seq, persists, returns full EventRecord[].
// Never call db.event.update or db.event.delete from application code.

import { db } from '@/lib/db';
import type { EventRecord, NewEventInput, EventType } from './types';

export class EventSpine {
  constructor(
    private readonly tenantId: string,
    private readonly orgId: string,
  ) {}

  /**
   * Append one or more events atomically. All events share a transaction;
   * if any fails, none are persisted.
   */
  async append(inputs: NewEventInput[]): Promise<EventRecord[]> {
    if (inputs.length === 0) return [];

    // Atomically compute next seq + insert
    return db.$transaction(async (tx) => {
      // Find current max seq
      const last = await tx.event.findFirst({
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      let nextSeq = (last?.seq ?? 0) + 1;

      const created: EventRecord[] = [];
      for (const input of inputs) {
        const row = await tx.event.create({
          data: {
            seq: nextSeq++,
            type: input.type,
            payload: JSON.stringify(input.payload),
            tenantId: this.tenantId,
            orgId: this.orgId,
            actorType: input.actorType,
            actorAgentId: input.actorAgentId ?? null,
            actorUserId: input.actorUserId ?? null,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            visibility: input.visibility ?? 'org',
          },
        });
        created.push(row as unknown as EventRecord);
      }
      return created;
    });
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

    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload as string),
      actorAgentId: r.actorAgentId ?? undefined,
      actorUserId: r.actorUserId ?? undefined,
    })) as unknown as EventRecord[];
  }
}
