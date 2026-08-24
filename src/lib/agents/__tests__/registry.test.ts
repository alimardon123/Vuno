// ADR-0006 defines an adapter registry. Until now there was an interface and
// nothing behind it, and what stood in its place returned hand-written text.
//
// The rule these tests hold: when an agent cannot run, the reason says what to
// do about it. A failure that reads "no adapter" is a failure nobody can act
// on, and it lands in Activity under "Work that failed" for someone to read.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentManifest } from '@/lib/agents/types';

const manifest = (over: Partial<AgentManifest> = {}): AgentManifest => ({
  id: 'mbr-x',
  role: 'security',
  kind: 'independent',
  modelName: 'claude-opus-5',
  harnessName: 'anthropic',
  tools: [],
  permissions: [],
  ...over,
});

const saved = { key: process.env.ANTHROPIC_API_KEY, ollama: process.env.OLLAMA_BASE_URL };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OLLAMA_BASE_URL;
});

afterEach(() => {
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.ollama === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = saved.ollama;
});

describe('an agent that cannot run says what would let it', () => {
  test('a missing key names the variable and the alternative', async () => {
    const { resolveAdapter } = await import('@/lib/agents/registry');
    const result = resolveAdapter(manifest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('ANTHROPIC_API_KEY');
    expect(result.reason).toContain('ollama');
  });

  test('a missing Ollama URL names the variable and the default', async () => {
    const { resolveAdapter } = await import('@/lib/agents/registry');
    const result = resolveAdapter(manifest({ harnessName: 'ollama' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('OLLAMA_BASE_URL');
    expect(result.reason).toContain('11434');
  });

  test('the removed "simulated" harness is refused by name', async () => {
    const { resolveAdapter } = await import('@/lib/agents/registry');
    const result = resolveAdapter(manifest({ harnessName: 'simulated' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('simulated');
    expect(result.reason).toContain('hand-written');
  });

  test('an agent with no harness at all is refused, not defaulted', async () => {
    const { resolveAdapter } = await import('@/lib/agents/registry');
    const result = resolveAdapter(manifest({ harnessName: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no harness');
  });
});

describe('a configured harness resolves', () => {
  test('a key produces an Anthropic adapter carrying the agent it is for', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { resolveAdapter } = await import('@/lib/agents/registry');
    const result = resolveAdapter(manifest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adapter.manifest.id).toBe('mbr-x');
    expect((await result.adapter.health()).ok).toBe(true);
  });

  test('an Ollama URL produces an Ollama adapter, no key needed', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    const { resolveAdapter } = await import('@/lib/agents/registry');
    const result = resolveAdapter(manifest({ harnessName: 'ollama', modelName: 'llama3.2' }));

    expect(result.ok).toBe(true);
  });
});

describe('the install knows whether it can run agents at all', () => {
  test('with nothing configured it says so, and says what still works', async () => {
    const { configuredHarnesses, noHarnessConfiguredMessage } = await import('@/lib/agents/registry');

    expect(configuredHarnesses()).toEqual([]);
    const message = noHarnessConfiguredMessage();
    expect(message).toContain('ANTHROPIC_API_KEY');
    expect(message).toContain('OLLAMA_BASE_URL');
    // The distinction that matters: the org is not broken, it just cannot
    // think. Routing, gates and the ledger are deterministic and still run.
    expect(message).toContain('ledger');
  });

  test('with one configured there is nothing to warn about', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    const { configuredHarnesses, noHarnessConfiguredMessage } = await import('@/lib/agents/registry');

    expect(configuredHarnesses()).toEqual(['ollama']);
    expect(noHarnessConfiguredMessage()).toBeNull();
  });
});
