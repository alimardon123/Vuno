// Vuno — what every harness reports back, and the arithmetic they share.

import type { AgentResponse } from '@/lib/agents/types';
import type { Rejection } from '@/lib/events/schema';

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  durationMs: number;
  modelName: string;
  harnessName: string;
}

export interface AgentRun {
  response: AgentResponse;
  /** Anything the model produced that the boundary refused, and why. */
  rejections: Rejection[];
  usage: Usage;
  /** Kept for the failure path: a run that yields nothing has to be explainable. */
  rawText: string;
}

/** Dollars per million tokens, in, out. Unknown models cost nothing recorded. */
/**
 * Dollars per million tokens, `[input, output]`.
 *
 * These are the ids the API actually answers to. The table this replaced named
 * `claude-opus-4`, `claude-sonnet-4` and `claude-haiku-4`, none of which exist
 * — so an agent installed on the default model would have been refused by the
 * API, and any run that did land was priced against a model that was never
 * called. Review reports spend from this table; a wrong number here is a wrong
 * number on a page whose whole point is that its numbers are real.
 *
 * An unknown model prices at zero and `run.ts` says so rather than guessing,
 * because a plausible invented price is worse than an obvious blank.
 */
export const MODEL_PRICES: Record<string, [number, number]> = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

export function priceFor(
  model: string,
  tokensIn: number,
  tokensOut: number,
  prices: Record<string, [number, number]>,
): number {
  // Longest matching prefix. Current model ids carry no date suffix, so this is
  // mostly defensive — but the sort matters either way: `claude-opus-4-8` and a
  // shorter `claude-opus-4` would both match, and the specific one has to win.
  const key = Object.keys(prices)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return 0;

  const [perMillionIn, perMillionOut] = prices[key];
  const dollars = (tokensIn / 1_000_000) * perMillionIn + (tokensOut / 1_000_000) * perMillionOut;
  return Math.round(dollars * 100);
}

/**
 * Pull the JSON object out of a model's reply.
 *
 * Models wrap JSON in code fences and preface it with "Sure, here's...", and a
 * turn thrown away for that is a turn wasted. Anything that is not recoverable
 * JSON comes back as the original string, which the boundary then rejects with
 * the model's actual words in the message.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const body = candidate.trim();
    try {
      return JSON.parse(body);
    } catch {
      // Fall through to the brace scan.
    }

    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }
  return trimmed;
}
