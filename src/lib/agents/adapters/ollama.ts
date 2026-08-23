// Vuno — the Ollama harness.
//
// The path that needs no key and no account: point OLLAMA_BASE_URL at a local
// model and the organisation works. It matters more than being the cheap
// option — an install with no hosted key is otherwise an org whose agents
// cannot act at all, and the whole product is agents and people as colleagues.

import { parseAgentOutput } from '@/lib/events/schema';
import { systemPrompt, userPrompt } from '@/lib/agents/prompt';
import type { AgentAdapter, AgentContext, AgentManifest, AgentResponse } from '@/lib/agents/types';
import type { AgentRun, Usage } from '@/lib/agents/adapters/run';
import { extractJson } from '@/lib/agents/adapters/run';

export interface OllamaConfig {
  baseUrl: string;
  /** Injected by tests. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Null when this install cannot run the harness, so the registry can say why. */
export function ollamaConfig(): OllamaConfig | null {
  const raw = process.env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  return { baseUrl: raw.replace(/\/+$/, '') };
}

interface ChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  model?: string;
  error?: string;
}

export class OllamaAdapter implements AgentAdapter {
  constructor(
    readonly manifest: AgentManifest,
    private readonly config: OllamaConfig,
  ) {}

  async health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }> {
    const doFetch = this.config.fetch ?? fetch;
    const startedAt = Date.now();
    try {
      const res = await doFetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok
        ? { ok: true, latencyMs: Date.now() - startedAt, note: `ollama · ${this.manifest.modelName}` }
        : { ok: false, note: `Ollama answered ${res.status} at ${this.config.baseUrl}` };
    } catch (e) {
      return {
        ok: false,
        note: `Cannot reach Ollama at ${this.config.baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  async invoke(ctx: AgentContext): Promise<AgentResponse> {
    return (await this.run(ctx)).response;
  }

  async run(ctx: AgentContext): Promise<AgentRun> {
    const doFetch = this.config.fetch ?? fetch;
    const startedAt = Date.now();

    const res = await doFetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.manifest.modelName,
        stream: false,
        // Ollama's JSON mode: the boundary still validates, but this stops most
        // replies arriving as prose about JSON.
        format: 'json',
        messages: [
          { role: 'system', content: systemPrompt(this.manifest) },
          { role: 'user', content: userPrompt(ctx) },
        ],
      }),
    });

    const body = (await res.json().catch(() => null)) as ChatResponse | null;

    if (!res.ok) {
      throw new Error(
        `Ollama returned ${res.status}${body?.error ? `: ${body.error}` : ''}. ` +
          `Check the model "${this.manifest.modelName}" is pulled: ollama pull ${this.manifest.modelName}`,
      );
    }

    const text = (body?.message?.content ?? '').trim();

    // A local model costs nothing per token, and recording a fabricated price
    // would corrupt the only number the org has for what its work costs.
    const usage: Usage = {
      tokensIn: body?.prompt_eval_count ?? 0,
      tokensOut: body?.eval_count ?? 0,
      costCents: 0,
      durationMs: Date.now() - startedAt,
      modelName: body?.model ?? this.manifest.modelName,
      harnessName: 'ollama',
    };

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
