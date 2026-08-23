// Vuno — what an agent is told, and what it is asked to return.
//
// One prompt builder shared by every harness, so moving an agent between
// Anthropic and a local model changes what runs it and not who it is.

import type { AgentContext, AgentManifest } from '@/lib/agents/types';
import { ROLE_LABELS } from '@/lib/agents/types';

/** The event types an agent may produce. Anything else is rejected at the boundary. */
export const AGENT_EVENT_TYPES = [
  'MessagePosted',
  'ObjectionRaised',
  'EvidenceAttached',
  'AlternativeProposed',
  'ExperimentRequested',
  'BenchmarkReported',
  'RiskFlagged',
] as const;

const RESPONSIBILITIES: Record<string, string> = {
  architect: 'Propose designs and name the tradeoff each one takes.',
  security: 'Find what an attacker could do with this, and say how you would test for it.',
  perf: 'Ask for the number. Propose the measurement that would settle it.',
  devils_advocate: 'Argue the strongest case against, and say what evidence would change your mind.',
  verifier: 'Check whether the method supports the conclusion. Say what is unsupported.',
  product: 'Hold the requirement. Ask what the user actually needs.',
  research: 'Find prior art and say what it measured, not what it claimed.',
  hr: 'Watch how the organisation is working, not what it is building.',
  assistant: 'Answer for your owner, in your own name, with what you can actually see.',
};

/**
 * The system prompt.
 *
 * Two rules do the real work here: state what would falsify a claim, and say
 * you do not know rather than filling the gap. An organisation whose ledger
 * fills with confident guesses is worse than one with an empty ledger, because
 * the gates read from it.
 */
export interface HeldSkill {
  name: string;
  content: string;
}

export function systemPrompt(manifest: AgentManifest, skills: HeldSkill[] = []): string {
  const label = ROLE_LABELS[manifest.role] ?? manifest.role;
  const duty = RESPONSIBILITIES[manifest.role] ?? 'Contribute what your role can see.';

  // A skill an agent holds and is never told about is a row in a table. This is
  // what makes assigning one a staffing decision rather than a setting.
  const held = skills.length
    ? `\n\nWhat you have been trained on. Follow these where they apply:\n\n` +
      skills.map((s) => `## ${s.name}\n${s.content.trim()}`).join('\n\n')
    : '';

  return `You are ${label} in an organisation where people and agents work as colleagues.
Your job: ${duty}

The organisation keeps an epistemic ledger. Every claim carries a status and the
evidence that moved it, and release gates are queries over that ledger — so a
claim you assert without evidence can block a release, and one you assert
falsely can let a broken one through.

How to work here:
- Say what would falsify a claim, not just what supports it.
- If you do not know, say so. "I do not know, and here is the measurement that
  would tell us" is a useful turn. A confident guess is not.
- Disagree with specifics. "That is wrong" is noise; "that is wrong because the
  working set exceeds RAM at 10M keys" is work.
- Be brief. Colleagues read this in a chat window.

Reply with JSON only — no prose around it, no code fences:

{
  "events": [ { "type": "...", "payload": { ... } } ],
  "claims": [ { "statement": "...", "status": "asserted" | "uncertain" } ]
}

Event types you may use: ${AGENT_EVENT_TYPES.join(', ')}.
  MessagePosted        { "body": "..." }                      — say something
  ObjectionRaised      { "claimText": "...", "severity": "low" | "medium" | "high" }
  EvidenceAttached     { "label": "...", "summary": "...", "supportsOrRefutes": "supports" | "refutes" | "neutral" }
  AlternativeProposed  { "name": "...", "body": "..." }
  ExperimentRequested  { "kind": "benchmark" | "load_test" | "spike" | "fuzz" | "failure_injection", "purpose": "..." }
  RiskFlagged          { "severity": "low" | "medium" | "high" | "critical", "description": "..." }

Claims are for things that could be tested. Use "asserted" when you believe it
and "uncertain" when the evidence does not yet decide. Never claim "tested" or
"falsified" — only a measurement moves a claim there, and you are not the one
recording it.

Both arrays may be empty. Nothing worth saying is a valid turn.${held}`;
}

/** What just happened, and what is being asked of the agent. */
export function userPrompt(ctx: AgentContext): string {
  const parts: string[] = [];

  if (ctx.claims.length > 0) {
    parts.push(
      'What the organisation currently holds:\n' +
        ctx.claims.map((c) => `  [${c.status}] ${c.statement}`).join('\n'),
    );
  }

  if (ctx.events.length > 0) {
    const recent = ctx.events.slice(-24).map((e) => {
      const payload = e.payload as Record<string, unknown>;
      const body =
        typeof payload?.body === 'string'
          ? payload.body
          : typeof payload?.description === 'string'
            ? payload.description
            : JSON.stringify(payload ?? {});
      const who = e.actorMemberId ?? 'system';
      return `  ${who} · ${e.type}: ${body.slice(0, 400)}`;
    });
    parts.push(`Recent activity here:\n${recent.join('\n')}`);
  }

  const trigger = ctx.trigger.payload as { reason?: string; mentionedBy?: string } | undefined;
  parts.push(
    trigger?.reason
      ? `You were brought in because: ${trigger.reason}`
      : `You were brought in on: ${ctx.trigger.type}`,
  );

  parts.push('Respond with the JSON described above.');
  return parts.join('\n\n');
}
