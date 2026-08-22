// Vuno — Lightweight LLM helper for brief agent observations
// Used by the attention router + handoff paths when 'useRealLLM' is enabled.
// Unlike the full RealLLMAdapter (which returns complex JSON for debates),
// this helper returns just a body string — a brief, genuine LLM-generated
// observation that feels like a real colleague glancing at Slack.
//
// Per the design principle "Simple": one function, one prompt, one string back.
// Per the "Powerful": makes agents genuinely intelligent, not scripted.
// Per the "Efficient": reuses z-ai-web-dev-sdk (already installed). No new deps.

import ZAI from 'z-ai-web-dev-sdk';
import { ROLE_LABELS } from '@/lib/agents/types';

const roleResponsibilities: Record<string, string> = {
  architect: 'Design system architecture. Propose technical solutions. Consider tradeoffs between approaches.',
  security: 'Review proposals for security vulnerabilities. Check authorization, data exposure, input handling.',
  perf: 'Run benchmarks. Measure performance. Verify that proposed architectures meet performance targets.',
  devils_advocate: 'Challenge proposals. Find weaknesses. Raise objections. Ensure decisions are well-reasoned.',
  verifier: 'Verify methodology. Confirm results are sound. Check that claims are supported by evidence.',
  product: 'Define requirements. Ensure proposals meet user needs. Route work to appropriate teams.',
  research: 'Research prior art. Find relevant papers, benchmarks, and existing solutions.',
  hr: 'Evaluate the organization. Measure agent performance. Log retrospectives.',
};

// Generate a brief observation for the attention router.
// The agent glances at the user's message and posts a 1-2 sentence observation
// relevant to their domain of expertise.
export async function generateLLMAttentionObservation(
  role: string,
  userMessage: string,
  topic: string,
  matchedKeywords: string[],
): Promise<string> {
  const roleLabel = ROLE_LABELS[role] ?? role;
  const responsibilities = roleResponsibilities[role] ?? 'Collaborate with the team.';

  const systemPrompt = `You are ${roleLabel} in a Slack-like team chat for a software company called Vuno.
Your role: ${role}
Your responsibilities: ${responsibilities}

A team member just posted a message that matches your domain of expertise (topic: ${topic}, keywords: ${matchedKeywords.join(', ')}).
You're glancing at Slack and want to post a BRIEF, helpful observation — like a real colleague chiming in.

Rules:
- Output ONLY the message body (no JSON, no markdown, no quotes)
- 1-2 sentences maximum — this is a quick glance, not a full review
- Be specific and technical — reference the actual concern
- Be conversational, not robotic — like a real colleague on Slack
- Don't introduce yourself — just respond to the content
- If the message expresses worry/concern, acknowledge it briefly before your observation`;

  const userPrompt = `The team member's message:
"${userMessage}"

Post your brief observation as ${roleLabel}:`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    });
    const body = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!body) {
      return generateSimulatedFallback(role, topic);
    }
    // Strip any leading/trailing quotes the LLM might add
    return body.replace(/^["']|["']$/g, '').trim();
  } catch (err) {
    console.error(`[llm-attention] ${role} failed:`, err);
    return generateSimulatedFallback(role, topic);
  }
}

// Generate a deeper review for the ACP handoff path.
// The expert agent received a delegation from Bob (the PA) with curated context.
// They respond with a richer, context-aware review — 2-4 sentences.
export async function generateLLMHandoffResponse(
  role: string,
  request: string,
  contextSummary: string,
  fromAgentName: string,
  focusArea: string,
  ownerName: string,
): Promise<string> {
  const roleLabel = ROLE_LABELS[role] ?? role;
  const responsibilities = roleResponsibilities[role] ?? 'Collaborate with the team.';

  const systemPrompt = `You are ${roleLabel} in a Slack-like team chat for a software company called Vuno.
Your role: ${role}
Your responsibilities: ${responsibilities}

${fromAgentName} (a personal assistant) has delegated this to you with curated context.
You should respond with a DEEPER review than a quick glance — 2-4 sentences, referencing ${fromAgentName}'s context.

Rules:
- Output ONLY the message body (no JSON, no markdown, no quotes)
- 2-4 sentences — this is a considered review, not a quick glance
- Start by acknowledging ${fromAgentName} delegated this to you (e.g. "${fromAgentName} flagged this for me." or "${fromAgentName} asked me to take a look.")
- Be specific and technical — reference the actual concern + the focus area (${focusArea})
- If the context mentions worry/concern, acknowledge it
- Offer a concrete next step or specific recommendation
- Be conversational, not robotic`;

  const userPrompt = `Delegation from ${fromAgentName}:
Request: ${request}

Curated context:
${contextSummary}

Post your deeper review as ${roleLabel}:`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    });
    const body = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!body) {
      return generateSimulatedFallback(role, focusArea);
    }
    return body.replace(/^["']|["']$/g, '').trim();
  } catch (err) {
    console.error(`[llm-handoff] ${role} failed:`, err);
    return generateSimulatedFallback(role, focusArea);
  }
}

// Fallback if the LLM call fails — brief canned observation per role
function generateSimulatedFallback(role: string, topic: string): string {
  const fallbacks: Record<string, string> = {
    security: `Security glance — worth threat-modeling this before it ships. Who's the attacker, what's the asset?`,
    perf: `Perf glance — worth measuring before assuming. p99 is what bites you, not the average.`,
    architect: `Architectural take — worth sketching the data flow first before committing.`,
    devils_advocate: `Counterpoint — what's the failure mode if we commit to this direction?`,
    verifier: `QA glance — worth a test plan before this lands. What's the failure mode?`,
    hr: `Noting this for the next retro — worth tracking if it becomes a pattern.`,
    product: `Product angle — worth checking whether this aligns with the current objective.`,
    research: `Research angle — worth checking prior art before we reinvent.`,
  };
  return fallbacks[role] ?? `Quick take on ${topic} — worth looking into.`;
}
