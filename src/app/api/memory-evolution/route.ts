// Vuno — /api/memory-evolution POST endpoint
// The personal assistant's silent learning layer. When the owner (Kai) posts a
// message in any channel, the PA (Bob) extracts learned facts (interests,
// focus areas, sentiment, preferences) and:
//   1. Upserts the fact into PersonalMemory (Tier 2)
//   2. Fires a MemoryUpdated event (visible as a "🧠 learned" badge in chat)
//
// Per the design principle "Powerful": the PA visibly learns from the owner's
// behavior, accumulating a model of preferences over time. No other multi-agent
// product has PAs that visibly learn.
// Per the "Beautiful" principle: the MemoryUpdated event is the visible artifact
// — a small inline badge, not a separate message. Subtle but present.
//
// Flow:
//   1. Receive { messageEventId, body, channelId, ownerUserId }
//   2. Fetch the PA (the org's personal_assistant agent)
//   3. Run detectMemoryFacts(body)
//   4. For each fact:
//      a. Read existing PersonalMemory value for that key
//      b. Skip if value already known (no new learning)
//      c. Upsert PersonalMemory with new aggregate value
//      d. Append + broadcast MemoryUpdated event
//
// The route is async-fire-and-forget from the caller's perspective.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { broadcastEventAppended, broadcastTyping } from '@/lib/realtime/broadcast';
import { detectMemoryFacts, appendToListValue, valueInList, type DetectedFact } from '@/lib/agents/memory-detector';
import { generateProactiveNote } from '@/lib/agents/proactive-note-generator';
import type { NewEventInput, EventRecord } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const RUST_URL = 'http://localhost:3030';

interface MemoryEvolutionRequest {
  messageEventId: string;
  body: string;
  channelId: string;
  ownerUserId: string;  // the human who posted (Kai)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function isRustAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${RUST_URL}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function streamEvents(
  events: NewEventInput[],
  org: { tenantId: string; id: string },
  useRust: boolean,
): Promise<EventRecord[]> {
  if (events.length === 0) return [];

  let created: EventRecord[];
  if (useRust) {
    const res = await fetch(`${RUST_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) throw new Error(`Rust append failed: ${res.status}`);
    const data = await res.json() as { events: EventRecord[] };
    created = data.events.map((e) => ({
      ...e,
      payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
      createdAt: typeof e.createdAt === 'number' ? new Date(e.createdAt).toISOString() : e.createdAt,
    }));
  } else {
    const spine = new EventSpine(org.tenantId, org.id);
    const raw = await spine.append(events);
    created = raw.map((e) => ({
      ...e,
      payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
    })) as EventRecord[];
  }

  for (const evt of created) {
    void broadcastEventAppended({
      channelId: evt.scopeType === 'channel' ? evt.scopeId : undefined,
      scopeType: evt.scopeType,
      scopeId: evt.scopeId,
      event: evt,
    });
  }
  return created;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as MemoryEvolutionRequest | null;
    if (!body || !body.body || !body.channelId || !body.messageEventId || !body.ownerUserId) {
      return NextResponse.json(
        { ok: false, error: 'Missing body, channelId, messageEventId, or ownerUserId' },
        { status: 400 },
      );
    }

    // Don't learn from very short messages
    if (body.body.trim().length < 8) {
      return NextResponse.json({ ok: true, learned: [], reason: 'message too short' });
    }

    const facts = detectMemoryFacts(body.body);
    if (facts.length === 0) {
      return NextResponse.json({ ok: true, learned: [], reason: 'no facts detected' });
    }

    const org = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, id: true },
    });
    if (!org) {
      return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });
    }

    // Find the personal assistant agent owned by this human
    const pa = await db.agent.findFirst({
      where: {
        orgId: org.id,
        kind: 'personal_assistant',
        ownerHumanId: body.ownerUserId,
        status: 'active',
      },
    });
    if (!pa) {
      // No PA installed for this user — silently skip (not an error)
      return NextResponse.json({ ok: true, learned: [], reason: 'no personal assistant for this user' });
    }

    // Resolve the owner's display name
    const owner = await db.user.findUnique({ where: { id: body.ownerUserId }, select: { name: true, email: true } });
    const ownerName = owner?.name ?? owner?.email ?? 'you';

    const useRust = await isRustAvailable();
    const learned: Array<{ key: string; value: string; factType: string; isNew: boolean }> = [];
    // Track each learned fact with its DetectedFact + isUpdate flag + the event ID
    // assigned by the spine. Used to generate the PaProactiveNote that references
    // these MemoryUpdated events (closing the learn→reference loop).
    const learnedForNote: Array<{ fact: DetectedFact; isUpdate: boolean; memoryEventId: string }> = [];

    // Brief delay — the PA is "thinking" about the message (like a colleague
    // glancing at Slack and quietly noting something). Per the "Beautiful"
    // principle: feels organic, not instant.
    await sleep(400 + Math.random() * 300);

    // Process each detected fact
    const events: NewEventInput[] = [];
    for (const fact of facts) {
      // Read existing PersonalMemory for this key
      const existing = await db.personalMemory.findUnique({
        where: {
          agentId_key: { agentId: pa.id, key: fact.key },
        },
      });

      // For list-type keys (interests, focus_areas, stated_preferences), skip if already known
      if (fact.factType === 'interest' || fact.factType === 'focus_area' || fact.factType === 'preference') {
        if (existing && valueInList(existing.value, fact.value)) {
          // Already known — no new learning, don't fire an event
          continue;
        }
      }

      // For sentiment (replace type), always update (the current state changed)
      // Compute new value + oldValue
      let newValue: string;
      let oldValue: string | null = null;
      let isUpdate = false;
      if (fact.factType === 'sentiment') {
        // Parse existing as a plain string (sentiment is a single value, not a list)
        if (existing) {
          try {
            const parsed = JSON.parse(existing.value);
            oldValue = typeof parsed === 'string' ? parsed : existing.value;
            isUpdate = true;
          } catch {
            oldValue = existing.value;
            isUpdate = true;
          }
        }
        newValue = JSON.stringify(fact.value);
      } else {
        // List type — append
        oldValue = existing?.value ?? null;
        isUpdate = existing !== null;
        newValue = appendToListValue(existing?.value ?? null, fact.value);
      }

      // Upsert PersonalMemory
      await db.personalMemory.upsert({
        where: { agentId_key: { agentId: pa.id, key: fact.key } },
        update: {
          value: newValue,
          category: fact.factType === 'sentiment' ? 'context' : (fact.factType === 'preference' ? 'preference' : 'fact'),
          ownerHumanId: body.ownerUserId,
          updatedAt: new Date(),
        },
        create: {
          tenantId: org.tenantId,
          orgId: org.id,
          agentId: pa.id,
          ownerHumanId: body.ownerUserId,
          key: fact.key,
          value: newValue,
          category: fact.factType === 'sentiment' ? 'context' : (fact.factType === 'preference' ? 'preference' : 'fact'),
        },
      });

      // Queue a MemoryUpdated event
      events.push({
        type: 'MemoryUpdated',
        actorType: 'agent',
        actorAgentId: pa.id,
        scopeType: 'channel',
        scopeId: body.channelId,
        payload: {
          agentId: pa.id,
          agentName: pa.name,
          ownerHumanId: body.ownerUserId,
          ownerName,
          factType: fact.factType,
          key: fact.key,
          value: fact.value,
          oldValue,
          evidenceEventId: body.messageEventId,
          confidence: fact.confidence,
        },
      });

      learned.push({
        key: fact.key,
        value: fact.value,
        factType: fact.factType,
        isNew: !isUpdate,
      });

      // Track for the proactive note (we'll fill in memoryEventId after streaming)
      learnedForNote.push({ fact, isUpdate, memoryEventId: '' });
    }

    if (events.length === 0) {
      return NextResponse.json({ ok: true, learned: [], reason: 'all facts already known' });
    }

    // Stream all MemoryUpdated events (they'll appear in chat as "🧠 learned" badges)
    const createdEvents = await streamEvents(events, org, useRust);

    // Map the created event IDs back to the learnedForNote entries (same order)
    for (let i = 0; i < createdEvents.length && i < learnedForNote.length; i++) {
      learnedForNote[i]!.memoryEventId = createdEvents[i]!.id;
    }

    // ─── Close the learn→reference loop ────────────────────────────────────
    // Per the design principle "Powerful": the PA doesn't just learn — it ACTS
    // on what it learned. After the MemoryUpdated badges appear, Bob posts a
    // proactive note that weaves the learned facts into a natural message,
    // referencing each fact with a 🧠 memory pill.
    //
    // Only fire the proactive note if there's at least 1 NEW fact OR a sentiment
    // update (the emotional shift is worth noting). Don't fire on pure list
    // appends to existing lists — too noisy.
    const shouldFireProactiveNote = learnedForNote.some(
      (l) => !l.isUpdate || l.fact.factType === 'sentiment',
    );

    if (shouldFireProactiveNote) {
      // Brief pause — let the MemoryUpdated badges land first, then Bob "speaks".
      // Per the "Beautiful" principle: learn → think → speak, not all at once.
      void broadcastTyping({ channelId: body.channelId, userId: pa.id, isTyping: true });
      await sleep(700 + Math.random() * 400);
      void broadcastTyping({ channelId: body.channelId, userId: pa.id, isTyping: false });

      const note = generateProactiveNote(learnedForNote, ownerName);
      if (note.body) {
        await streamEvents([{
          type: 'PaProactiveNote',
          actorType: 'agent',
          actorAgentId: pa.id,
          scopeType: 'channel',
          scopeId: body.channelId,
          payload: {
            agentId: pa.id,
            agentName: pa.name,
            ownerHumanId: body.ownerUserId,
            ownerName,
            body: note.body,
            memoryReferences: note.memoryReferences,
          },
        }], org, useRust);
      }
    }

    return NextResponse.json({
      ok: true,
      learned,
      message: `${pa.name} learned ${learned.length} new fact(s) about ${ownerName}.`,
    });
  } catch (err) {
    console.error('Memory evolution failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
