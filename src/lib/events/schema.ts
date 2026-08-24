// Vuno — validation boundary for agent-produced events
//
// The event spine is append-only (ADR-0004): a row written here can never be
// corrected. So everything crossing the boundary from a model into the spine is
// validated first, and anything that fails is rejected rather than appended.
//
// Before this existed, `RealLLMAdapter` pushed `JSON.parse(...)` output straight
// into `NewEventInput[]`:
//
//   events.push({ type: evt.type, scopeType: evt.scopeType ?? 'channel', ... })
//
// A model that returned "ProposalOpend", or a claim status of "probably true",
// wrote that permanently into the log. `tsc` flagged it as five type errors that
// `ignoreBuildErrors` was hiding.
//
// Coverage is staged deliberately:
//   - The envelope (type, scopeType, visibility, claim status) is validated
//     strictly against the unions in ./types — an unknown value is rejected.
//   - Payloads are validated per-type for the events that move the ledger or a
//     gate, since those are the ones that cause durable damage.
//   - Every other payload must be a non-empty object. Tightening those is
//     tracked; it does not block, because an unknown-shaped MessagePosted is
//     recoverable in a way that a bogus ClaimStatusChanged is not.

import { z } from 'zod';
import type { ProposedToolCall } from '@/lib/agents/types';
import type { NewEventInput } from './types';

// ─── Envelope ────────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
  'MessagePosted', 'ThreadReplyPosted', 'MentionMade', 'ObjectiveFiled',
  'RequirementStated', 'ProposalOpened', 'EvidenceAttached', 'ObjectionRaised',
  'AlternativeProposed', 'ExperimentRequested', 'ExperimentCompleted',
  'BenchmarkReported', 'RiskFlagged', 'DecisionRecorded', 'ClaimStatusChanged',
  'GateEvaluated', 'GateBlocked', 'GatePassed', 'RoleAssigned',
  'EscalationOpened', 'EscalationResolved', 'MemberJoined', 'MemberRoleChanged', 'MemberRetired',
  'WikiSectionAuthored', 'AgentThought', 'SharedItem', 'ReactionAdded',
  'PreemptIssued', 'AttentionWakeup', 'MemoryUpdated', 'PaProactiveNote',
  'AgentHandoff', 'ToolCalled', 'ReactionRemoved', 'MessageEdited',
  'MessageRedacted', 'MessagePinned', 'MessageUnpinned', 'ObjectiveStageChanged',
  'CallStarted', 'CallEnded',
] as const;

export const SCOPE_TYPES = [
  'channel', 'decision', 'project', 'objective', 'team', 'org', 'tenant',
] as const;

export const CLAIM_STATUSES = [
  'asserted', 'believed', 'tested', 'falsified', 'uncertain',
] as const;

export const VISIBILITIES = ['tenant', 'org', 'team', 'private'] as const;

const eventTypeSchema = z.enum(EVENT_TYPES);
const scopeTypeSchema = z.enum(SCOPE_TYPES);
const claimStatusSchema = z.enum(CLAIM_STATUSES);
const visibilitySchema = z.enum(VISIBILITIES);

const nonEmptyObject = z
  .record(z.string(), z.unknown())
  .refine((o) => Object.keys(o).length > 0, { message: 'payload must not be empty' });

// ─── Payloads that cause durable damage if wrong ─────────────────────────────

const strictPayloads: Partial<Record<(typeof EVENT_TYPES)[number], z.ZodTypeAny>> = {
  // Still `min(1)`. These strict payloads guard `parseAgentOutput`, which is
  // the boundary agent output crosses — and an agent posting an empty message
  // is a bug, not a screenshot with no caption. The attachments-only case is a
  // person in the composer, and `/api/messages` validates that path itself:
  // body or files, never neither.
  MessagePosted: z.object({ body: z.string().min(1) }).loose(),

  // Everything that acts on another message. Strict, because these are the
  // events that change what a conversation says it said — an edit with no
  // target silently edits nothing, and nobody finds out.
  ReactionAdded: z.object({ emoji: z.string().min(1).max(16), targetEventId: z.string().min(1) }).loose(),
  ReactionRemoved: z.object({ emoji: z.string().min(1).max(16), targetEventId: z.string().min(1) }).loose(),
  MessageEdited: z.object({ targetEventId: z.string().min(1), body: z.string().min(1).max(4000) }).loose(),
  MessageRedacted: z.object({ targetEventId: z.string().min(1) }).loose(),
  MessagePinned: z.object({ targetEventId: z.string().min(1) }).loose(),
  MessageUnpinned: z.object({ targetEventId: z.string().min(1) }).loose(),

  // Strict: a stage change with no `to` moves an objective nowhere and says it
  // moved, which is worse than an error.
  ObjectiveStageChanged: z
    .object({
      objectiveId: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      reason: z.string().min(1),
      byHand: z.boolean(),
    })
    .loose()
    .refine((p) => p.from !== p.to, { message: 'a stage change has to change the stage' }),

  ClaimStatusChanged: z
    .object({
      claimId: z.string().min(1),
      from: claimStatusSchema,
      to: claimStatusSchema,
      reason: z.string().min(1),
    })
    .loose()
    // A transition that does not move anywhere is a no-op the ledger should not record.
    .refine((p) => p.from !== p.to, { message: 'from and to must differ' }),

  BenchmarkReported: z
    .object({
      metric: z.string().min(1),
      value: z.number().finite(),
      unit: z.string().min(1),
    })
    .loose(),

  ProposalOpened: z.object({ title: z.string().min(1) }).loose(),

  ObjectionRaised: z.object({ body: z.string().min(1) }).loose(),

  RiskFlagged: z
    .object({ severity: z.enum(['low', 'medium', 'high', 'critical']) })
    .loose(),
};

// ─── What an adapter is allowed to return ────────────────────────────────────

const proposedEventSchema = z.object({
  type: eventTypeSchema,
  scopeType: scopeTypeSchema.optional(),
  scopeId: z.string().min(1).optional(),
  visibility: visibilitySchema.optional(),
  payload: nonEmptyObject,
});

const proposedClaimSchema = z.object({
  statement: z.string().min(1),
  status: claimStatusSchema,
  scopeType: scopeTypeSchema.optional(),
  scopeId: z.string().min(1).optional(),
});

// A tool call is model output like everything else, so it goes through the same
// boundary. `connection` and `tool` are names to be looked up, not paths to be
// followed: nothing here decides what gets dialled, it only says what was asked
// for. The turn checks the agent actually holds that connection.
const proposedToolCallSchema = z.object({
  connection: z.string().min(1).max(64),
  tool: z.string().min(1).max(128),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const agentOutputSchema = z.object({
  events: z.array(proposedEventSchema).default([]),
  claims: z.array(proposedClaimSchema).default([]),
  toolCalls: z.array(proposedToolCallSchema).default([]),
});

export type ProposedClaim = z.infer<typeof proposedClaimSchema>;

/**
 * A claim after parsing: scope is always resolved, from the model or from the
 * invocation context. Callers can hand this straight to the ledger.
 */
export type ResolvedClaim = ProposedClaim & {
  scopeType: (typeof SCOPE_TYPES)[number];
  scopeId: string;
};

// ─── Result ──────────────────────────────────────────────────────────────────

export interface Rejection {
  /** Where in the model's output this item sat, for the log line. */
  at: string;
  /** What the model actually produced, truncated. */
  received: string;
  /** Why it was refused, in the words a reader can act on. */
  reason: string;
}

export interface ParsedAgentOutput {
  events: NewEventInput[];
  claims: ResolvedClaim[];
  /** Calls the agent asked for. The turn decides whether it may make them. */
  toolCalls: ProposedToolCall[];
  rejections: Rejection[];
}

export interface AgentOutputContext {
  actorMemberId: string;
  /** Used when the model omits a scope — it should not be inventing one. */
  defaultScopeType: (typeof SCOPE_TYPES)[number];
  defaultScopeId: string;
  defaultClaimScopeType?: (typeof SCOPE_TYPES)[number];
  defaultClaimScopeId?: string;
}

function truncate(value: unknown, max = 160): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  s = s ?? String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Validate one model response. Never throws, and never returns an item the
 * spine would have to live with. A batch with three good events and one bad one
 * yields three events and one rejection — a single malformed item does not
 * discard the agent's whole turn.
 */
export function parseAgentOutput(
  raw: unknown,
  ctx: AgentOutputContext,
): ParsedAgentOutput {
  const outer = agentOutputSchema.safeParse(raw);

  // The whole response is unusable — most often the model returned prose, or an
  // object with neither key. Salvage nothing; report why.
  if (!outer.success && !isPartiallySalvageable(raw)) {
    return {
      events: [],
      claims: [],
      toolCalls: [],
      rejections: [
        {
          at: 'response',
          received: truncate(raw),
          reason: outer.error.issues[0]?.message ?? 'response did not match the expected shape',
        },
      ],
    };
  }

  const source = (raw ?? {}) as { events?: unknown[]; claims?: unknown[]; toolCalls?: unknown[] };
  const events: NewEventInput[] = [];
  const claims: ResolvedClaim[] = [];
  const toolCalls: ProposedToolCall[] = [];
  const rejections: Rejection[] = [];

  for (const [i, candidate] of (source.events ?? []).entries()) {
    const parsed = proposedEventSchema.safeParse(candidate);
    if (!parsed.success) {
      rejections.push({
        at: `events[${i}]`,
        received: truncate(candidate),
        reason: describe(parsed.error),
      });
      continue;
    }

    const payloadSchema = strictPayloads[parsed.data.type];
    if (payloadSchema) {
      const payload = payloadSchema.safeParse(parsed.data.payload);
      if (!payload.success) {
        rejections.push({
          at: `events[${i}].payload (${parsed.data.type})`,
          received: truncate(parsed.data.payload),
          reason: describe(payload.error),
        });
        continue;
      }
    }

    events.push({
      type: parsed.data.type,
      actorType: 'member',
      actorMemberId: ctx.actorMemberId,
      scopeType: parsed.data.scopeType ?? ctx.defaultScopeType,
      scopeId: parsed.data.scopeId ?? ctx.defaultScopeId,
      ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
      payload: parsed.data.payload,
    } as NewEventInput);
  }

  for (const [i, candidate] of (source.claims ?? []).entries()) {
    const parsed = proposedClaimSchema.safeParse(candidate);
    if (!parsed.success) {
      rejections.push({
        at: `claims[${i}]`,
        received: truncate(candidate),
        reason: describe(parsed.error),
      });
      continue;
    }
    claims.push({
      ...parsed.data,
      scopeType: parsed.data.scopeType ?? ctx.defaultClaimScopeType ?? 'project',
      scopeId: parsed.data.scopeId ?? ctx.defaultClaimScopeId ?? ctx.defaultScopeId,
    });
  }

  for (const [i, candidate] of (source.toolCalls ?? []).entries()) {
    const parsed = proposedToolCallSchema.safeParse(candidate);
    if (!parsed.success) {
      rejections.push({
        at: `toolCalls[${i}]`,
        received: truncate(candidate),
        reason: describe(parsed.error),
      });
      continue;
    }
    toolCalls.push(parsed.data);
  }

  return { events, claims, toolCalls, rejections };
}

/** An object carrying at least one of the arrays is worth walking item by item. */
function isPartiallySalvageable(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  return Array.isArray(o.events) || Array.isArray(o.claims) || Array.isArray(o.toolCalls);
}

function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
