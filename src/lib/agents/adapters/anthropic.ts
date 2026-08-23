// Vuno — the Anthropic harness.
//
// A real adapter: it calls a model, and what comes back goes through the same
// validation boundary as any other agent output (`parseAgentOutput`). The
// adapter never hands the spine something a model said verbatim — the previous
// LLM adapter pushed `JSON.parse(...)` straight through, which is what
// src/lib/events/schema.ts was written to stop.

import { parseAgentOutput } from '@/lib/events/schema';
import { systemPrompt, userPrompt } from '@/lib/agents/prompt';
import type { AgentAdapter, AgentContext, AgentManifest, AgentResponse } from '@/lib/agents/types';
import type { AgentRun, Usage } from '@/lib/agents/adapters/run';
import { extractJson, MODEL_PRICES, priceFor } from '@/lib/agents/adapters/run';

export interface AnthropicConfig {
  apiKey: string;
  baseUrl: string;
  /** Injected by tests. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Null when this install cannot run the harness, so the registry can say why. */
export function anthropicConfig(): AnthropicConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/+$/, ''),
  };
}

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  error?: { message?: string };
}

export class AnthropicAdapter implements AgentAdapter {
  constructor(
    readonly manifest: AgentManifest,
    private readonly config: AnthropicConfig,
  ) {}

  async health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }> {
    // A key that is present but wrong should surface as a failed run with the
    // API's own message, not as a health check that invents a verdict.
    return { ok: true, note: `anthropic · ${this.manifest.modelName}` };
  }

  async invoke(ctx: AgentContext): Promise<AgentResponse> {
    return (await this.run(ctx)).response;
  }

  /** Like invoke, but also reports what the call cost — what the runner records. */
  async run(ctx: AgentContext): Promise<AgentRun> {
    const doFetch = this.config.fetch ?? fetch;
    const startedAt = Date.now();

    const res = await doFetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.manifest.modelName,
        max_tokens: 1024,
        system: systemPrompt(this.manifest),
        messages: [{ role: 'user', content: userPrompt(ctx) }],
      }),
    });

    const body = (await res.json().catch(() => null)) as MessagesResponse | null;

    if (!res.ok) {
      // The API's own message, not a generic one: "credit balance too low" and
      // "model not found" need different things done about them.
      throw new Error(
        `Anthropic returned ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}`,
      );
    }

    const text = (body?.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
      .trim();

    const usage: Usage = {
      tokensIn: body?.usage?.input_tokens ?? 0,
      tokensOut: body?.usage?.output_tokens ?? 0,
      costCents: 0,
      durationMs: Date.now() - startedAt,
      modelName: body?.model ?? this.manifest.modelName,
      harnessName: 'anthropic',
    };
    usage.costCents = priceFor(usage.modelName, usage.tokensIn, usage.tokensOut, MODEL_PRICES);

    const parsed = parseAgentOutput(extractJson(text), {
      actorMemberId: this.manifest.id,
      defaultScopeType: ctx.scope.scopeType,
      defaultScopeId: ctx.scope.scopeId,
      ...(ctx.scope.projectId
        ? { defaultClaimScopeType: 'project' as const, defaultClaimScopeId: ctx.scope.projectId }
        : {}),
    });

    return {
      response: { events: parsed.events, claims: parsed.claims },
      rejections: parsed.rejections,
      usage,
      rawText: text,
    };
  }
}
