// Vuno — the adapter registry (ADR-0006).
//
// ADR-0006 defines an adapter interface and a registry; until now there was an
// interface and nothing behind it. What stood in its place was
// `adapters/simulated.ts`: canned replies per trigger type, chosen by matching
// substrings in a message. It looked like an organisation of colleagues and it
// was a keyword table, so it is gone (docs/REVIEW-2026-08-23.md).
//
// This resolves what will actually run an agent, from the agent's own
// `harnessName` and what the install has configured. When nothing is
// configured it says so in the words someone can act on, rather than
// substituting something that talks.

import type { AgentAdapter, AgentManifest } from '@/lib/agents/types';
import { AnthropicAdapter, anthropicConfig } from '@/lib/agents/adapters/anthropic';
import { OllamaAdapter, ollamaConfig } from '@/lib/agents/adapters/ollama';

export type Harness = 'anthropic' | 'ollama';

export const HARNESSES: Harness[] = ['anthropic', 'ollama'];

export type Resolution =
  | { ok: true; adapter: AgentAdapter }
  | { ok: false; reason: string };

function isHarness(value: string): value is Harness {
  return (HARNESSES as string[]).includes(value);
}

/** Which harnesses this install could actually run right now. */
export function configuredHarnesses(): Harness[] {
  return HARNESSES.filter((h) => (h === 'anthropic' ? anthropicConfig() : ollamaConfig()) !== null);
}

/**
 * Resolve the adapter for an agent, or say why there isn't one.
 *
 * Every failure names the environment variable that fixes it. A run that fails
 * with "no adapter" and nothing else is a run nobody can act on, and the
 * message lands in Activity under "Work that failed".
 */
export function resolveAdapter(manifest: AgentManifest): Resolution {
  const harness = manifest.harnessName?.trim();

  if (!harness) {
    return {
      ok: false,
      reason: `${manifest.role} has no harness set. Give it one of: ${HARNESSES.join(', ')}.`,
    };
  }

  if (!isHarness(harness)) {
    return {
      ok: false,
      reason:
        `Unknown harness "${harness}". This install can run: ${HARNESSES.join(', ')}. ` +
        `The "simulated" harness was removed — it replied with hand-written text.`,
    };
  }

  if (harness === 'anthropic') {
    const config = anthropicConfig();
    if (!config) {
      return {
        ok: false,
        reason:
          'No ANTHROPIC_API_KEY is set, so the anthropic harness cannot run. ' +
          'Put one in .env, or move this agent to the ollama harness and run a local model.',
      };
    }
    return { ok: true, adapter: new AnthropicAdapter(manifest, config) };
  }

  const config = ollamaConfig();
  if (!config) {
    return {
      ok: false,
      reason:
        'No OLLAMA_BASE_URL is set, so the ollama harness cannot run. ' +
        'Start Ollama and set OLLAMA_BASE_URL in .env (http://127.0.0.1:11434 by default).',
    };
  }
  return { ok: true, adapter: new OllamaAdapter(manifest, config) };
}

/**
 * What to tell someone when the org cannot act at all. Distinct from a single
 * agent's failure: this is the whole install having no model behind it.
 */
export function noHarnessConfiguredMessage(): string | null {
  if (configuredHarnesses().length > 0) return null;
  return (
    'No model is configured, so agents cannot run. Set ANTHROPIC_API_KEY for hosted models, ' +
    'or OLLAMA_BASE_URL to use a local one. Everything deterministic — routing, gates, the ' +
    'ledger — works without either.'
  );
}
