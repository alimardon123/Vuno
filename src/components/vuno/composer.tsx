'use client';

// The composer.
//
// It used to offer Objection / Evidence / Proposal tabs. Picking one changed
// the placeholder and nothing else: every send posted a plain MessagePosted,
// because all three of those events carry a `decisionId` and a conversation has
// no decision to attach them to (src/lib/events/types.ts). A control that
// claims to change what you are recording and does not is exactly the scripted
// theatre CLAUDE.md rules out, so it is gone until the decision context that
// would make it real exists — see docs/REVIEW-2026-08-23.md.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export function Composer({ conversationId, conversationName }: { conversationId: string; conversationName: string }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: conversationId, body: text }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Could not send');
      setBody('');
      router.refresh();
    } catch (e) {
      toast({
        title: 'Not sent',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 px-4 pb-3 pt-1">
      <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] focus-within:border-line-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={`Message ${conversationName}…`}
          aria-label={`Message ${conversationName}`}
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-[1.5] text-[var(--fg)] placeholder:text-[var(--fg-4)] focus:outline-none"
        />

        <div className="flex items-center gap-2 px-2.5 pb-2">
          <span className="text-[10.5px] text-[var(--fg-4)]">⌘↵ to send</span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!body.trim() || busy}
            className={cn(
              'ml-auto rounded-md px-3 py-1 text-[11.5px] font-semibold transition-opacity',
              'bg-[var(--accent)] text-[var(--accent-fg)]',
              (!body.trim() || busy) && 'cursor-not-allowed opacity-40',
            )}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
