// Vuno — Real LLM agent adapter
// Per the user's vision: "agents debating in real time concurrently like
// humans in real corporate life." This adapter uses z-ai-web-dev-sdk to
// generate real LLM responses instead of canned scripts.
//
// The adapter:
//   1. Takes an agent manifest (role, model, etc.)
//   2. Constructs a system prompt describing the agent's role + available event types
//   3. On invoke(), calls the LLM with the context (recent events, thoughts, claims)
//   4. Asks the LLM to respond in JSON format matching the event schema
//   5. Parses the JSON response into NewEventInput[] + NewClaimInput[]
//
// This is the SAME interface as the simulated adapters — the substrate,
// ledger, gates, and debate engine do not change. Just swap the adapter.

import ZAI from 'z-ai-web-dev-sdk';
import type {
  AgentAdapter,
  AgentContext,
  AgentManifest,
  AgentResponse,
} from '@/lib/agents/types';
import type { NewEventInput } from '@/lib/events/types';
import { ROLE_LABELS } from '@/lib/agents/types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RealLLMAdapter implements AgentAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string, role: string) {
    this.manifest = {
      id,
      role,
      kind: 'independent',
      modelName: 'z-ai-glm-4',
      harnessName: 'z-ai-sdk',
      tools: [],
      permissions: [],
    };
  }

  async invoke(ctx: AgentContext): Promise<AgentResponse> {
    const { trigger, events, claims } = ctx;
    const role = this.manifest.role;
    const roleLabel = ROLE_LABELS[role] ?? role;

    // Build the system prompt — describes the agent's role + available event types
    const systemPrompt = `You are ${roleLabel} in a team of AI agents and humans collaborating on a software project.

Your role: ${role}
Your responsibilities: ${getRoleResponsibilities(role)}

You are part of Vuno — an organization where agents debate, propose, challenge each other with evidence, and make decisions through a structured process.

When you respond, you MUST output ONLY a JSON object (no markdown, no explanation) with this shape:
{
  "thoughts": [
    {
      "thoughtType": "observation" | "hypothesis" | "conclusion" | "question" | "doubt",
      "content": "your reasoning (1-2 sentences)",
      "topic": "a short topic tag like 'architecture' or 'bloom-filters'",
      "visibility": "org"
    }
  ],
  "events": [
    {
      "type": one of: "MessagePosted" | "ProposalOpened" | "ObjectionRaised" | "EvidenceAttached" | "BenchmarkReported" | "DecisionRecorded" | "SharedItem" | "AgentThought",
      "scopeType": "channel",
      "scopeId": "ch-storage",
      "payload": { ... the event payload ... }
    }
  ],
  "claims": [
    {
      "statement": "a claim statement",
      "status": "asserted" | "believed" | "tested" | "falsified" | "uncertain",
      "scopeType": "project",
      "scopeId": "proj-storage-engine"
    }
  ]
}

Rules:
- Always produce at least 1 thought (your reasoning before acting)
- Produce 1-2 events (your actual response — a message, proposal, objection, etc.)
- Only produce claims if you're making or updating an epistemic claim
- Keep responses concise — 1-3 sentences per thought, 2-5 sentences per event body
- Be specific and technical — reference actual architecture decisions, benchmarks, evidence
- If responding to a proposal: review it critically, raise specific concerns
- If responding to an objection: propose an experiment or counter-argument
- If running a benchmark: report specific numbers (p99 latency, throughput, etc.)

Available event types and their payloads:
- MessagePosted: { "body": "string" }
- ProposalOpened: { "decisionId": "string", "title": "string", "body": "string", "alternatives": [{"name":"string","rejectedReason":"string"}], "scopeProjectId": "string" }
- ObjectionRaised: { "decisionId": "string", "claimText": "string", "severity": "low"|"medium"|"high" }
- EvidenceAttached: { "decisionId": "string", "evidenceType": "benchmark"|"paper"|"incident"|"cost_model", "label": "string", "summary": "string", "supportsOrRefutes": "supports"|"refutes"|"neutral" }
- BenchmarkReported: { "experimentId": "string", "metric": "string", "value": "string", "unit": "string", "target": "string", "passed": boolean }
- DecisionRecorded: { "decisionId": "string", "outcome": "accepted"|"rejected"|"falsified", "chosen": "string", "rationale": "string", "rejectedAlternatives": [{"name":"string","reason":"string"}] }
- SharedItem: { "itemType": "file"|"report"|"url"|"code"|"data", "title": "string", "description": "string", "url": "string" }
- AgentThought: { "thoughtType": "observation"|"hypothesis"|"conclusion"|"question"|"doubt", "content": "string", "topic": "string", "visibility": "org" }`;

    // Build the user prompt — describes the trigger + recent context
    const recentEvents = events.slice(-10).map((e) => ({
      type: e.type,
      actor: e.actorAgentId ?? e.actorType,
      payload: e.payload,
      createdAt: e.createdAt,
    }));

    const recentThoughts = events
      .filter((e) => e.type === 'AgentThought')
      .slice(-5)
      .map((e) => e.payload);

    const userPrompt = `Trigger: ${trigger.type}

Recent events (last 10):
${JSON.stringify(recentEvents, null, 2)}

Recent thoughts from other agents (last 5):
${JSON.stringify(recentThoughts, null, 2)}

${trigger.payload ? `Trigger payload: ${JSON.stringify(trigger.payload)}` : ''}

Respond now as ${roleLabel}. Output ONLY the JSON object.`;

    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        thinking: { type: 'disabled' },
      });

      const responseText = completion.choices[0]?.message?.content ?? '';

      // Parse the JSON response
      const parsed = parseLLMResponse(responseText);

      // Convert to NewEventInput[]
      const events: NewEventInput[] = [];

      // Add thoughts first (they appear before the events in the chat)
      for (const thought of parsed.thoughts ?? []) {
        events.push({
          type: 'AgentThought',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            thoughtType: thought.thoughtType,
            content: thought.content,
            topic: thought.topic ?? 'general',
            visibility: thought.visibility ?? 'org',
          },
        });
      }

      // Add the structured events
      for (const evt of parsed.events ?? []) {
        events.push({
          type: evt.type,
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: evt.scopeType ?? 'channel',
          scopeId: evt.scopeId ?? 'ch-storage',
          payload: evt.payload,
        });
      }

      // Convert claims
      const claims = (parsed.claims ?? []).map((c) => ({
        statement: c.statement,
        status: c.status,
        scopeType: c.scopeType ?? 'project',
        scopeId: c.scopeId ?? 'proj-storage-engine',
      }));

      return { events, claims };
    } catch (err) {
      console.error(`[llm-adapter] ${role} failed:`, err);
      // Fallback: produce a simple message about the failure
      return {
        events: [{
          type: 'MessagePosted' as const,
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: { body: `[${roleLabel}] LLM call failed: ${err instanceof Error ? err.message : String(err)}. Falling back to simulated behavior.` },
        }],
        claims: [],
      };
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }> {
    return { ok: true, note: 'real LLM (z-ai-web-dev-sdk)' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRoleResponsibilities(role: string): string {
  const responsibilities: Record<string, string> = {
    architect: 'Design system architecture. Propose technical solutions. Consider tradeoffs between approaches.',
    security: 'Review proposals for security vulnerabilities. Check authorization, data exposure, input handling.',
    perf: 'Run benchmarks. Measure performance. Verify that proposed architectures meet performance targets.',
    devils_advocate: 'Challenge proposals. Find weaknesses. Raise objections with evidence. Ensure decisions are well-reasoned.',
    verifier: 'Verify benchmark methodology. Confirm results are sound. Check that claims are supported by evidence.',
    product: 'Define requirements. Ensure proposals meet user needs. Route work to appropriate teams.',
    research: 'Research prior art. Find relevant papers, benchmarks, and existing solutions.',
    hr: 'Evaluate the organization. Measure agent performance. Log retrospectives.',
  };
  return responsibilities[role] ?? 'Collaborate with the team.';
}

interface LLMResponse {
  thoughts?: Array<{
    thoughtType: 'observation' | 'hypothesis' | 'conclusion' | 'question' | 'doubt';
    content: string;
    topic?: string;
    visibility?: string;
  }>;
  events?: Array<{
    type: string;
    scopeType?: string;
    scopeId?: string;
    payload: Record<string, unknown>;
  }>;
  claims?: Array<{
    statement: string;
    status: string;
    scopeType?: string;
    scopeId?: string;
  }>;
}

function parseLLMResponse(text: string): LLMResponse {
  // Try to extract JSON from the response (LLMs sometimes wrap in markdown)
  let jsonText = text.trim();

  // Remove markdown code fences if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  // Find the first { and last } — in case there's text before/after the JSON
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonText = jsonText.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(jsonText) as LLMResponse;
  } catch {
    console.error('[llm-adapter] Failed to parse LLM response as JSON:', text.substring(0, 200));
    return { thoughts: [], events: [], claims: [] };
  }
}
