// Vuno — running the tool calls an agent asked for.
//
// Two rules, and the first is the reason this file exists rather than the loop
// living inline in `turn.ts`:
//
//   1. An agent may call a connection it holds, and nothing else. Holding is
//      the permission — there is no second list to keep in step with the first.
//      A call to something it does not hold is refused with a message the agent
//      can act on, not silently dropped: an agent that asked for a tool and got
//      nothing back asks again.
//   2. Every call lands on the spine. It is the one kind of action an agent
//      takes that changes something the ledger cannot see, so "what did it
//      actually do out there" has to be answerable afterwards.

import { openSession, ConnectionError, type Session } from '@/lib/connections/client';
import { connectionsHeldBy } from '@/lib/connections';
import type { AvailableTool, ProposedToolCall, ToolOutcome } from '@/lib/agents/types';
import type { NewEventInput } from '@/lib/events/types';

/** How many calls one turn may make, across all its passes. */
export const MAX_CALLS_PER_TURN = 6;

/** How much of a result goes on the spine. The whole thing goes to the model. */
const LOGGED_RESULT_CHARS = 2_000;

export interface Held {
  id: string;
  key: string;
  name: string;
  url: string;
  authEnvVar: string | null;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

/** What this member may call, flattened for the prompt. */
export function availableTools(held: Held[]): AvailableTool[] {
  return held.flatMap((c) =>
    c.tools.map((t) => ({
      connection: c.key,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  );
}

export async function heldConnections(memberId: string): Promise<Held[]> {
  return connectionsHeldBy(memberId);
}

export interface RunToolsResult {
  outcomes: ToolOutcome[];
  /** One `ToolCalled` per call, for the caller to append as the agent. */
  events: NewEventInput[];
}

/**
 * Run what the agent asked for.
 *
 * Sessions are opened once per connection and reused across the calls that use
 * it — a turn that reads two metrics from one server should not shake hands
 * twice, and some servers refuse the second handshake outright.
 */
export async function runToolCalls(
  calls: ProposedToolCall[],
  held: Held[],
  scope: { scopeType: NewEventInput['scopeType']; scopeId: string },
): Promise<RunToolsResult> {
  const byKey = new Map(held.map((c) => [c.key, c]));
  const sessions = new Map<string, Session>();
  const outcomes: ToolOutcome[] = [];
  const events: NewEventInput[] = [];

  try {
    for (const call of calls.slice(0, MAX_CALLS_PER_TURN)) {
      const conn = byKey.get(call.connection);

      if (!conn) {
        // Named so the agent can correct itself: the reason it cannot make this
        // call is that it does not hold that connection, and the answer is to
        // use one it does hold or to ask a person for it.
        const reachable = held.map((c) => c.key);
        outcomes.push({
          ...call,
          failed: true,
          text:
            `You do not hold a connection called "${call.connection}", so this call was not made. ` +
            (reachable.length > 0
              ? `You hold: ${reachable.join(', ')}.`
              : 'You hold no connections at all — answer from what is in the conversation.'),
        });
        continue;
      }

      const startedAt = Date.now();
      let failed = true;
      let text: string;

      try {
        let session = sessions.get(conn.key);
        if (!session) {
          session = await openSession(conn);
          sessions.set(conn.key, session);
        }
        const result = await session.call(call.tool, call.arguments);
        failed = result.failed;
        text = result.text;
      } catch (e) {
        // A connection that cannot be dialled fails this call and every later
        // one to the same server, which is why the message says which server.
        text = e instanceof ConnectionError ? e.message : e instanceof Error ? e.message : String(e);
      }

      const durationMs = Date.now() - startedAt;
      outcomes.push({ ...call, failed, text });
      events.push({
        type: 'ToolCalled',
        actorType: 'member',
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        payload: {
          connectionKey: conn.key,
          connectionName: conn.name,
          tool: call.tool,
          arguments: call.arguments,
          result: text.slice(0, LOGGED_RESULT_CHARS),
          failed,
          durationMs,
        },
      } as NewEventInput);
    }

    if (calls.length > MAX_CALLS_PER_TURN) {
      outcomes.push({
        connection: '',
        tool: '',
        arguments: {},
        failed: true,
        text:
          `You asked for ${calls.length} calls and ${MAX_CALLS_PER_TURN} is the limit for one turn. ` +
          'The rest were not made. Answer with what you have, or ask for fewer.',
      });
    }
  } finally {
    for (const s of sessions.values()) await s.close();
  }

  return { outcomes, events };
}
