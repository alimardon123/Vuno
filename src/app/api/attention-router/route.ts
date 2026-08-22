// Vuno — /api/attention-router POST endpoint
// The "magic moment" feature: when a user posts a message in a channel, this
// route analyzes the message body, decides which agents should "wake up" based
// on their domain of expertise, fires AttentionWakeup events (visible in chat
// as a "noticed this" badge), then invokes each woken agent's adapter to post
// a brief, conversational observation.
//
// Per the design principle "Powerful": agents don't just wait for debates.
// They monitor chatter and engage when relevant.
// Per the design principle "Simple": pattern matching is substring-based.
// Real ML-based relevance scoring can drop in later — same interface.
//
// Flow:
//   1. Receive { messageEventId, body, channelId }
//   2. matchAttention(body) → list of (role, keywords, confidence)
//   3. For each match (max 2):
//      a. Append AttentionWakeup event + broadcast
//      b. Send typing indicator for that agent
//      c. Invoke the agent's adapter with AttentionTriggered trigger
//      d. Stream the adapter's events (a single MessagePosted observation)
//
// The route is async-fire-and-forget from the caller's perspective — the
// caller (POST /api/events) just kicks it off and returns immediately.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { broadcastEventAppended, broadcastTyping } from '@/lib/realtime/broadcast';
import { matchAttention } from '@/lib/agents/attention-router';
import { ROLE_TO_ADAPTER } from '@/lib/agents/adapters/simulated';
import type { NewEventInput, EventRecord } from '@/lib/events/types';
import type { AgentContext, AgentAdapter } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';

const RUST_URL = 'http://localhost:3030';

interface AttentionRouterRequest {
  messageEventId: string;
  body: string;
  channelId: string;
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

// Append events to the spine (Rust first, Prisma fallback) + broadcast each one.
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

// Variable cognitive load per role — agents think for different durations.
// Per Round 22 worklog: architect slow, security thorough, DA fast, etc.
const COGNITIVE_LOAD: Record<string, { min: number; max: number }> = {
  architect: { min: 600, max: 1100 },
  security: { min: 700, max: 1200 },
  devils_advocate: { min: 250, max: 550 },
  perf: { min: 450, max: 800 },
  verifier: { min: 350, max: 700 },
  hr: { min: 200, max: 450 },
};

function getThinkTime(role: string): number {
  const load = COGNITIVE_LOAD[role] ?? { min: 350, max: 700 };
  return load.min + Math.random() * (load.max - load.min);
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as AttentionRouterRequest | null;
    if (!body || !body.body || !body.channelId || !body.messageEventId) {
      return NextResponse.json(
        { ok: false, error: 'Missing body, channelId, or messageEventId' },
        { status: 400 },
      );
    }

    // Don't wake anyone on very short messages — likely just an emoji or "ok"
    if (body.body.trim().length < 8) {
      return NextResponse.json({ ok: true, woken: [], reason: 'message too short' });
    }

    const matches = matchAttention(body.body);
    if (matches.length === 0) {
      return NextResponse.json({ ok: true, woken: [], reason: 'no patterns matched' });
    }

    const org = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, id: true },
    });
    if (!org) {
      return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });
    }

    // Fetch the active agents by role
    const agents = await db.agent.findMany({
      where: { orgId: org.id, status: 'active' },
    });

    const useRust = await isRustAvailable();
    const woken: Array<{ agentId: string; agentName: string; role: string; topic: string; confidence: number }> = [];

    // Process matches SEQUENTIALLY (one agent at a time, each gets the spotlight).
    // This avoids a chaotic all-at-once reply and makes the "waking up" feel
    // organic — like colleagues noticing a Slack message one-by-one.
    // The matches are already sorted by confidence desc — highest-relevance agent wakes first.
    for (const match of matches) {
      const agent = agents.find((a) => a.role === match.pattern.role);
      if (!agent) continue; // role not installed — skip silently

      // 1. Fire AttentionWakeup event — visible in chat as "noticed this"
      const wakeupEvent: NewEventInput = {
        type: 'AttentionWakeup',
        actorType: 'agent',
        actorAgentId: agent.id,
        scopeType: 'channel',
        scopeId: body.channelId,
        payload: {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          triggerEventId: body.messageEventId,
          topic: match.pattern.topic,
          matchedKeywords: match.matchedKeywords,
          confidence: Math.round(match.confidence * 100) / 100,
        },
      };
      await streamEvents([wakeupEvent], org, useRust);

      // 2. Typing indicator — agent is "thinking"
      const thinkTime = getThinkTime(agent.role);
      void broadcastTyping({ channelId: body.channelId, userId: agent.id, isTyping: true });
      await sleep(thinkTime);
      void broadcastTyping({ channelId: body.channelId, userId: agent.id, isTyping: false });

      // 3. Invoke the adapter with AttentionTriggered
      const AdapterClass = ROLE_TO_ADAPTER[agent.role];
      if (!AdapterClass) continue;
      const adapter: AgentAdapter = new AdapterClass(agent.id);
      const ctx: AgentContext = {
        events: [],
        claims: [],
        trigger: {
          type: 'AttentionTriggered',
          payload: {
            body: body.body,
            topic: match.pattern.topic,
            matchedKeywords: match.matchedKeywords,
            channelId: body.channelId,
            confidence: match.confidence,
          },
        },
      };
      const response = await adapter.invoke(ctx);
      // Stream the adapter's events (a single MessagePosted observation)
      await streamEvents(response.events, org, useRust);

      woken.push({
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        topic: match.pattern.topic,
        confidence: match.confidence,
      });

      // Brief pause between agents waking — feels organic, not bursty
      await sleep(150 + Math.random() * 250);
    }

    return NextResponse.json({
      ok: true,
      woken,
      message: `${woken.length} agent(s) woke up in response to the message.`,
    });
  } catch (err) {
    console.error('Attention router failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
