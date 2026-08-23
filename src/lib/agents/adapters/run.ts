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
export const MODEL_PRICES: Record<string, [number, number]> = {
  'claude-opus-4': [15, 75],
  'claude-sonnet-4': [3, 15],
  'claude-haiku-4': [0.8, 4],
  'claude-3-5-haiku': [0.8, 4],
};

export function priceFor(
  model: string,
  tokensIn: number,
  tokensOut: number,
  prices: Record<string, [number, number]>,
): number {
  // Match on prefix: "claude-sonnet-4-20250514" is priced as "claude-sonnet-4".
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
