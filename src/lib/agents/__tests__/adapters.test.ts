// What a model says never reaches the spine unchecked.
//
// The adapter this replaced pushed `JSON.parse(...)` straight through, which is
// the reason src/lib/events/schema.ts exists. These tests drive both harnesses
// with a stubbed transport: no key, no network, and the contract still holds —
// so an install that adds a real key gets behaviour that has been tested.

import { describe, expect, test } from 'bun:test';
import { AnthropicAdapter } from '@/lib/agents/adapters/anthropic';
import { OllamaAdapter } from '@/lib/agents/adapters/ollama';
import { extractJson, priceFor } from '@/lib/agents/adapters/run';
import type { AgentContext, AgentManifest } from '@/lib/agents/types';

const manifest: AgentManifest = {
  id: 'mbr-sid',
  role: 'security',
  kind: 'independent',
  modelName: 'claude-sonnet-4',
  harnessName: 'anthropic',
  tools: [],
  permissions: [],
};

const ctx: AgentContext = {
  scope: { scopeType: 'channel', scopeId: 'ch-storage', projectId: 'proj-1' },
  events: [],
  claims: [{ id: 'c1', statement: 'p99 < 50ms', status: 'believed', scopeType: 'project', scopeId: 'proj-1' }],
  trigger: { type: 'mentioned', payload: { reason: 'Kai mentioned you' } },
};

/** A stub standing in for the model, so the contract is tested and not the vendor. */
function anthropicSaying(text: string, usage = { input_tokens: 1000, output_tokens: 500 }) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text }], usage, model: 'claude-sonnet-4-20250514' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { calls, adapter: new AnthropicAdapter(manifest, { apiKey: 'sk-test', baseUrl: 'https://api.test', fetch: stub }) };
}

describe('a model reply becomes events only if it survives the boundary', () => {
  test('well-formed output is appended as the agent, in the scope it was invoked in', async () => {
    const { adapter } = anthropicSaying(
      JSON.stringify({
        events: [{ type: 'MessagePosted', payload: { body: 'The read path exposes SSTable offsets.' } }],
        claims: [{ statement: 'Offset exposure allows enumeration', status: 'asserted' }],
      }),
    );
    const run = await adapter.run(ctx);

    expect(run.response.events).toHaveLength(1);
    expect(run.response.events[0].actorMemberId).toBe('mbr-sid');
    expect(run.response.events[0].scopeId).toBe('ch-storage');
    // A claim belongs to the project, not the channel it was said in.
    expect(run.response.claims[0].scopeType).toBe('project');
    expect(run.response.claims[0].scopeId).toBe('proj-1');
    expect(run.rejections).toEqual([]);
  });

  test('prose instead of JSON yields nothing, and says what arrived', async () => {
    const { adapter } = anthropicSaying('Sure! I think the read path looks fine to me.');
    const run = await adapter.run(ctx);

    expect(run.response.events).toEqual([]);
    expect(run.rejections).toHaveLength(1);
    expect(run.rejections[0].received).toContain('read path');
  });

  test('a fenced block is unwrapped rather than thrown away', async () => {
    const { adapter } = anthropicSaying(
      '```json\n{"events":[{"type":"MessagePosted","payload":{"body":"ok"}}],"claims":[]}\n```',
    );
    expect((await adapter.run(ctx)).response.events).toHaveLength(1);
  });

  test('one bad event does not discard the good ones in the same turn', async () => {
    const { adapter } = anthropicSaying(
      JSON.stringify({
        events: [
          { type: 'MessagePosted', payload: { body: 'first' } },
          { type: 'NotAnEventType', payload: { body: 'second' } },
          { type: 'MessagePosted', payload: { body: 'third' } },
        ],
        claims: [],
      }),
    );
    const run = await adapter.run(ctx);

    expect(run.response.events).toHaveLength(2);
    expect(run.rejections).toHaveLength(1);
    expect(run.rejections[0].at).toBe('events[1]');
  });

  test('an empty turn is valid — nothing worth saying is an answer', async () => {
    const { adapter } = anthropicSaying(JSON.stringify({ events: [], claims: [] }));
    const run = await adapter.run(ctx);

    expect(run.response.events).toEqual([]);
    expect(run.rejections).toEqual([]);
  });
});

describe('the agent is told who it is and what is already believed', () => {
  test('the prompt carries the role and the standing claims', async () => {
    const { calls, adapter } = anthropicSaying(JSON.stringify({ events: [], claims: [] }));
    await adapter.run(ctx);

    const system = String(calls[0].body.system);
    const user = String((calls[0].body.messages as Array<{ content: string }>)[0].content);

    expect(system).toContain('Security Architect');
    expect(system).toContain('falsif');            // say what would falsify it
    expect(system).toContain('do not know');       // and admit when you don't
    expect(user).toContain('p99 < 50ms');
    expect(user).toContain('Kai mentioned you');
  });

  test('the model is never asked for a status only a measurement can grant', async () => {
    const { calls, adapter } = anthropicSaying(JSON.stringify({ events: [], claims: [] }));
    await adapter.run(ctx);
    // Collapsed, because the prompt wraps and the rule is what matters.
    const system = String(calls[0].body.system).replace(/\s+/g, ' ');
    expect(system).toContain('Never claim "tested" or "falsified"');
    expect(system).toContain('only a measurement moves a claim there');
  });
});

describe('every run reports what it cost', () => {
  test('tokens and price come back from the call, priced by model family', async () => {
    const { adapter } = anthropicSaying(JSON.stringify({ events: [], claims: [] }));
    const run = await adapter.run(ctx);

    expect(run.usage.tokensIn).toBe(1000);
    expect(run.usage.tokensOut).toBe(500);
    expect(run.usage.harnessName).toBe('anthropic');
    // 1000 in at $3/M + 500 out at $15/M = $0.0105 → 1 cent.
    expect(run.usage.costCents).toBe(1);
  });

  test('a dated model id is priced as its family', () => {
    const prices = { 'claude-sonnet-4': [3, 15] as [number, number] };
    expect(priceFor('claude-sonnet-4-20250514', 1_000_000, 0, prices)).toBe(300);
  });

  test('an unknown model records nothing rather than a guess', () => {
    expect(priceFor('some-local-model', 1_000_000, 1_000_000, { 'claude-sonnet-4': [3, 15] })).toBe(0);
  });

  test('an API error surfaces the API\'s own words', async () => {
    const stub = (async () =>
      new Response(JSON.stringify({ error: { message: 'credit balance is too low' } }), { status: 400 })) as unknown as typeof fetch;
    const adapter = new AnthropicAdapter(manifest, { apiKey: 'sk-test', baseUrl: 'https://api.test', fetch: stub });

    await expect(adapter.run(ctx)).rejects.toThrow(/credit balance is too low/);
  });
});

describe('the local harness works the same way, and costs nothing', () => {
  function ollamaSaying(content: string) {
    const stub = (async () =>
      new Response(
        JSON.stringify({ message: { content }, prompt_eval_count: 900, eval_count: 120, model: 'llama3.2' }),
        { status: 200 },
      )) as unknown as typeof fetch;
    return new OllamaAdapter(
      { ...manifest, harnessName: 'ollama', modelName: 'llama3.2' },
      { baseUrl: 'http://127.0.0.1:11434', fetch: stub },
    );
  }

  test('output goes through the same boundary', async () => {
    const run = await ollamaSaying(
      JSON.stringify({ events: [{ type: 'MessagePosted', payload: { body: 'local reply' } }], claims: [] }),
    ).run(ctx);

    expect(run.response.events).toHaveLength(1);
    expect(run.usage.harnessName).toBe('ollama');
    expect(run.usage.tokensIn).toBe(900);
  });

  test('a local model records zero cost rather than a fabricated price', async () => {
    const run = await ollamaSaying(JSON.stringify({ events: [], claims: [] })).run(ctx);
    expect(run.usage.costCents).toBe(0);
  });

  test('a missing model names the command that would install it', async () => {
    const stub = (async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 })) as unknown as typeof fetch;
    const adapter = new OllamaAdapter(
      { ...manifest, harnessName: 'ollama', modelName: 'llama3.2' },
      { baseUrl: 'http://127.0.0.1:11434', fetch: stub },
    );
    await expect(adapter.run(ctx)).rejects.toThrow(/ollama pull llama3\.2/);
  });
});

describe('recovering JSON from what models actually send', () => {
  test('bare JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  test('a fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  test('JSON after a preamble', () => {
    expect(extractJson('Sure, here you go:\n{"a":1}')).toEqual({ a: 1 });
  });
  test('prose comes back untouched, for the rejection to quote', () => {
    expect(extractJson('I think it is fine.')).toBe('I think it is fine.');
  });
});
