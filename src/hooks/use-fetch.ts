// AI Org OS — minimal fetch hook for GET endpoints with abort + refetch.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useFetch<T>(
  url: string | null,
  opts?: { intervalMs?: number; skip?: boolean },
): FetchState<T> & { refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "in-flight" is a separate piece of state set only inside async callbacks
  // (after the effect body — avoids the synchronous setState-in-effect lint rule).
  const [inFlight, setInFlight] = useState(false);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url || opts?.skip) {
      return;
    }
    let active = true;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // kick off the fetch — setInFlight happens inside the .then chain to avoid
    // synchronous setState in the effect body. We use a leading microtask
    // so the UI flips to loading before the network round-trip.
    queueMicrotask(() => {
      if (active) setInFlight(true);
    });

    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (!active) return;
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const json = (await r.json()) as T;
        if (!active) return;
        setData(json);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active || ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setInFlight(false);
      });

    const intervalMs = opts?.intervalMs;
    const id = intervalMs
      ? window.setInterval(() => setNonce((n) => n + 1), intervalMs)
      : null;

    return () => {
      active = false;
      ctrl.abort();
      if (id) window.clearInterval(id);
    };
  }, [url, nonce, opts?.skip, opts?.intervalMs]);

  // derive loading: in-flight OR no data yet AND no error AND not skipped
  const loading =
    inFlight || (!opts?.skip && data === null && error === null);

  return { data, error, loading, refetch };
}

