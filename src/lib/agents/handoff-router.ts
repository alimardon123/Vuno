// Vuno — Agent Handoff Router
// The ACP (agent-to-agent comms) layer. When Bob (the PA) learns that Kai's
// message touches a specific domain (e.g. "Security", "Performance"), Bob
// delegates to the expert agent for that domain — passing curated context
// (learned facts + the user's message) so the expert can give a DEEPER review
// than the attention router's brief observation.
//
// Per the design principle "Powerful": agents don't just react independently
// (attention router) — they COLLABORATE. Bob curates which expert to engage
// and passes context, creating a visible chain: user → PA → expert.
// Per the "Simple" principle: one mapping function, one context builder.
// Per the "Efficient" principle: reuses the existing event spine + adapter
// infrastructure — no new transport, no new service.

import type { DetectedFact } from './memory-detector';

// Focus area (as learned by the memory detector) → agent role to delegate to.
// Each focus area maps to exactly ONE expert role (Simple principle — no
// multi-agent ambiguity in v1).
export const FOCUS_AREA_TO_ROLE: Record<string, string> = {
  Security: 'security',
  Cryptography: 'security',
  Performance: 'perf',
  Observability: 'perf',
  'Distributed Systems': 'architect',
  Databases: 'architect',
  Storage: 'architect',
  Networking: 'architect',
  Compilers: 'architect',
  'Machine Learning': 'research',
  'Deep Learning': 'research',
  AI: 'research',
  'Data Science': 'research',
  'Data Engineering': 'research',
  Frontend: 'architect',
  Backend: 'architect',
  DevOps: 'architect',
  'Site Reliability': 'perf',
  Infrastructure: 'architect',
};

export interface HandoffTarget {
  focusArea: string;
  targetRole: string;
}

// From the learned facts, find the best focus area to delegate on.
// Returns the FIRST focus area that maps to a known role (per the Simple
// principle — one handoff per message, not a fan-out).
// Skips if the only learned facts are interests/sentiment (no domain to delegate on).
export function findHandoffTarget(facts: DetectedFact[]): HandoffTarget | null {
  for (const fact of facts) {
    if (fact.factType !== 'focus_area') continue;
    const role = FOCUS_AREA_TO_ROLE[fact.value];
    if (role) {
      return { focusArea: fact.value, targetRole: role };
    }
  }
  return null;
}

// Build the handoff context summary — what Bob passes to the expert.
// Includes: the user's message snippet, learned focus areas, current sentiment.
// This is what makes the expert's response RICHER than the attention router's
// generic observation — the expert can reference "Bob flagged this" + the context.
export interface HandoffContext {
  request: string;          // the delegation request — "please review the security concern"
  contextSummary: string;    // curated context for the expert
}

export function buildHandoffContext(
  focusArea: string,
  targetRole: string,
  facts: DetectedFact[],
  userMessage: string,
  ownerName: string,
): HandoffContext {
  // Build the request based on the focus area + target role
  const requestTemplates: Record<string, string> = {
    security: `please review the ${focusArea.toLowerCase()} concern — Kai flagged it and I'd value your read`,
    perf: `please take a perf angle on the ${focusArea.toLowerCase()} discussion — Kai mentioned it and I'd value your read`,
    architect: `please sketch the architectural implications of the ${focusArea.toLowerCase()} discussion — Kai mentioned it`,
    research: `please surface any prior art or research relevant to the ${focusArea.toLowerCase()} discussion — Kai mentioned it`,
    verifier: `please flag any test coverage gaps related to the ${focusArea.toLowerCase()} discussion — Kai mentioned it`,
    devils_advocate: `please raise a counterpoint on the ${focusArea.toLowerCase()} discussion — Kai mentioned it`,
    hr: `please log this ${focusArea.toLowerCase()} discussion for the next retro — Kai mentioned it`,
  };
  const request = requestTemplates[targetRole] ?? `please review the ${focusArea.toLowerCase()} discussion`;

  // Build the context summary — what Bob knows that's relevant
  const focusAreas = facts
    .filter((f) => f.factType === 'focus_area')
    .map((f) => f.value);
  const sentiment = facts.find((f) => f.factType === 'sentiment');
  const interests = facts
    .filter((f) => f.factType === 'interest')
    .map((f) => f.value);

  const parts: string[] = [];
  parts.push(`${ownerName}'s message: "${userMessage.slice(0, 120)}${userMessage.length > 120 ? '…' : ''}"`);
  if (focusAreas.length > 0) {
    parts.push(`focus areas discussed: ${focusAreas.join(', ')}`);
  }
  if (sentiment) {
    parts.push(`current sentiment: ${sentiment.value}`);
  }
  if (interests.length > 0) {
    parts.push(`known interests: ${interests.join(', ')}`);
  }
  const contextSummary = parts.join(' | ');

  return { request, contextSummary };
}
