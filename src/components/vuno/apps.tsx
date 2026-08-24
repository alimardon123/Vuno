'use client';

// The app catalogue.
//
// One list, not two. The Plugins screen splits installed from available because
// installing a plugin twice hires an agent twice — order matters there. An app
// is a toggle, so a second list would only make you look in two places to find
// out whether the board is on.
//
// Every row names the surface it controls, in the words of the navigation:
// "A Board view in Work", not "enables boards". That sentence is what makes the
// difference between a catalogue and a settings page nobody trusts.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { RelativeTime, SectionLabel } from '@/components/vuno/primitives';
import { cn } from '@/lib/utils';
import type { AppRow } from '@/lib/apps';

export function Apps({ apps }: { apps: AppRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const optional = apps.filter((a) => !a.core);
  const core = apps.filter((a) => a.core);

  async function toggle(app: AppRow) {
    setBusy(app.key);
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: app.key, on: !app.installed }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');
      router.refresh();
      toast({
        title: app.installed ? `Removed ${app.name}` : `Added ${app.name}`,
        description: app.installed ? `${app.surface} is gone.` : `${app.surface} is there now.`,
      });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SectionLabel count={optional.length}>Apps</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {optional.map((a) => (
          <li
            key={a.key}
            className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--hover)]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{a.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-4)]">{a.key}</span>
                {a.installed ? (
                  <span className="shrink-0 rounded-[4px] border border-agent-edge px-1 py-px text-[10px] font-medium text-[var(--agent-edge)]">
                    Added
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--fg-3)]">{a.summary}</p>
              <p className="mt-1 text-[11px] text-[var(--fg-4)]">
                {a.surface}
                {a.installedAt ? (
                  <>
                    {' · added '}
                    <RelativeTime value={a.installedAt} />
                  </>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggle(a)}
              disabled={busy === a.key}
              aria-label={`${a.installed ? 'Remove' : 'Add'} ${a.name}`}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
                busy === a.key && 'cursor-not-allowed opacity-50',
                a.installed
                  ? 'border border-[var(--line)] text-[var(--fg-2)] hover:bg-[var(--hover)]'
                  : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90',
              )}
            >
              {busy === a.key ? '…' : a.installed ? 'Remove' : 'Add'}
            </button>
          </li>
        ))}
      </ul>

      {/* Listed, not hidden. A catalogue that showed only the removable half
          would misdescribe the product — and the row says why each one stays. */}
      <SectionLabel count={core.length}>Part of the product</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] opacity-75">
        {core.map((a) => (
          <li key={a.key} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{a.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-4)]">{a.key}</span>
              </div>
              <p className="mt-0.5 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--fg-3)]">{a.summary}</p>
              <p className="mt-1 text-[11px] text-[var(--fg-4)]">{a.surface}</p>
            </div>
            <span className="shrink-0 py-1 text-[11px] text-[var(--fg-4)]">Always on</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 max-w-[70ch] text-[11px] leading-[1.5] text-[var(--fg-4)]">
        These are the apps this build ships with — a list in the source, not a registry. What a member is made
        of is a different question: skills, plugins and connectors are in Settings.
      </p>
    </>
  );
}
