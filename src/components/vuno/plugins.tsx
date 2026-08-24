'use client';

// Plugins: skills, connectors and agents that arrive together.
//
// Two lists, deliberately not one. "Installed" is what this org has; "Available"
// is what it could have. Merging them into one list with a button that changes
// label is the pattern that makes people install something twice — and here
// installing twice hires an agent twice.
//
// The catalogue is a directory of files that ships with the build, and the
// screen says so. A browse screen implying a live index nobody is running is
// the same failure as an agent with canned replies.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RelativeTime, SectionLabel } from '@/components/vuno/primitives';
import { Button, Dialog, Field, FormError, inputClass } from '@/components/vuno/dialog';
import { useToast } from '@/hooks/use-toast';
import type { PluginRow } from '@/lib/plugins';

export interface CataloguePlugin {
  key: string;
  name: string;
  summary: string;
  version: string;
  author: string | null;
  skills: number;
  connectors: number;
  agents: number;
}

/** "2 skills · 1 connector · 1 agent", with the zeroes left out. */
function contents(c: { skills: number; connectors: number; agents: number }): string {
  const parts = [
    c.skills > 0 ? `${c.skills} skill${c.skills === 1 ? '' : 's'}` : null,
    c.connectors > 0 ? `${c.connectors} connector${c.connectors === 1 ? '' : 's'}` : null,
    c.agents > 0 ? `${c.agents} agent${c.agents === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'nothing';
}

export function Plugins({
  installed,
  available,
  broken,
}: {
  installed: PluginRow[];
  available: CataloguePlugin[];
  /** Catalogue files that did not parse. Shown rather than swallowed. */
  broken: string[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PluginRow | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const here = new Set(installed.map((p) => p.key));
  const installable = available.filter((p) => !here.has(p.key));

  async function post(body: unknown, busyKey: string) {
    setBusy(busyKey);
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        skills?: number;
        connectors?: number;
        agents?: number;
        unreachable?: string[];
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');

      router.refresh();
      // Say what arrived, and say straight away which part of it does not work
      // — finding out later that the connector was never reachable is worse.
      const summary = contents({
        skills: data.skills ?? 0,
        connectors: data.connectors ?? 0,
        agents: data.agents ?? 0,
      });
      toast({
        title: `Installed — ${summary}`,
        description:
          data.unreachable && data.unreachable.length > 0
            ? `${data.unreachable.join(', ')} could not be reached. Everything else is ready.`
            : undefined,
      });
      return true;
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: PluginRow) {
    setBusy(p.id);
    try {
      const res = await fetch('/api/plugins', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: p.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; agents?: string[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');
      setRemoving(null);
      router.refresh();
      toast({
        title: `Removed ${p.name}`,
        description:
          data.agents && data.agents.length > 0
            ? `${data.agents.map((h) => `@${h}`).join(', ')} stayed on the roster. Retire them there if you meant to.`
            : undefined,
      });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <p className="max-w-[62ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
          A plugin is the unit that makes the other two useful: a skill, the connector it reads from, and
          the agent hired to use both — installed together and already wired to each other.
        </p>
        <div className="ml-auto flex shrink-0 gap-1">
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add from a manifest
          </Button>
        </div>
      </div>

      {broken.length > 0 ? (
        <p className="mb-2 rounded-lg border border-falsified bg-[var(--falsified-bg)] px-3 py-2 text-[11.5px] text-[var(--falsified)]">
          {broken.length === 1 ? 'A catalogue file could not be read' : `${broken.length} catalogue files could not be read`}
          : {broken.join('; ')}
        </p>
      ) : null}

      <SectionLabel count={installed.length}>Installed</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {installed.map((p) => (
          <li
            key={p.id}
            className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--hover)]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{p.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-4)]">{p.key}</span>
                <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">v{p.version}</span>
                {p.source === 'added' ? (
                  <span className="shrink-0 rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1 py-px text-[10px] text-[var(--fg-3)]">
                    added here
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--fg-3)]">{p.summary}</p>
              <p className="mt-1 text-[11px] text-[var(--fg-4)]">
                {contents(p.installed)} in this org
                {/* Only worth saying when the two disagree — an agent hired by
                    this plugin and since retired is the usual reason. */}
                {p.installed.agents !== p.declares.agents
                  ? ` · declares ${p.declares.agents} agent${p.declares.agents === 1 ? '' : 's'}`
                  : ''}
                {p.author ? ` · ${p.author}` : ''} · installed <RelativeTime value={p.installedAt} />
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button onClick={() => setRemoving(p)} disabled={busy === p.id} aria-label={`Remove ${p.name}`}>
                Remove
              </Button>
            </div>
          </li>
        ))}
        {installed.length === 0 ? (
          <li className="px-4 py-8 text-center">
            <p className="text-[12.5px] font-medium text-[var(--fg-2)]">Nothing installed yet</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
              The catalogue below ships with this install. Everything it adds is visible under Skills and
              Connectors afterwards, and can be edited there like anything else.
            </p>
          </li>
        ) : null}
      </ul>

      <SectionLabel count={installable.length}>Available</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {installable.map((p) => (
          <li
            key={p.key}
            className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--hover)]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{p.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-4)]">{p.key}</span>
                <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">v{p.version}</span>
              </div>
              <p className="mt-0.5 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--fg-3)]">{p.summary}</p>
              <p className="mt-1 text-[11px] text-[var(--fg-4)]">
                {contents(p)}
                {p.author ? ` · ${p.author}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="primary"
                disabled={busy === p.key}
                onClick={() => void post({ catalogueKey: p.key }, p.key)}
              >
                {busy === p.key ? 'Installing…' : 'Install'}
              </Button>
            </div>
          </li>
        ))}
        {installable.length === 0 ? (
          <li className="px-4 py-6 text-center text-[11.5px] text-[var(--fg-4)]">
            {available.length === 0
              ? 'No catalogue ships with this install.'
              : 'Everything in the catalogue is already installed.'}
          </li>
        ) : null}
      </ul>

      <p className="mt-2 max-w-[70ch] text-[11px] leading-[1.5] text-[var(--fg-4)]">
        The catalogue is the <code className="font-mono">catalogue/</code> directory of this install — files, not a
        registry. Anything else goes in through &ldquo;Add from a manifest&rdquo;, in the same format.
      </p>

      {adding ? (
        <AddManifest
          onClose={() => setAdding(false)}
          onSubmit={async (manifest) => {
            const ok = await post({ manifest }, 'manifest');
            if (ok) setAdding(false);
          }}
        />
      ) : null}

      {removing ? (
        <Dialog
          title={`Remove ${removing.name}?`}
          hint={
            `This takes back the ${contents(removing.installed)} it installed, and whoever holds them stops holding them. ` +
            (removing.installed.agents > 0
              ? 'Agents it hired stay on the roster — retire them there if you want them gone.'
              : '')
          }
          onClose={() => setRemoving(null)}
        >
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" disabled={busy === removing.id} onClick={() => void remove(removing)}>
              {busy === removing.id ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function AddManifest({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (manifest: unknown) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      // The browser's own message names the position, which is the only part
      // that helps when you are staring at 200 lines of JSON.
      setError(`That is not valid JSON — ${err instanceof Error ? err.message : 'it could not be parsed'}`);
      return;
    }

    setBusy(true);
    try {
      await onSubmit(parsed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Add from a manifest"
      hint="A plugin manifest in JSON: skills, connectors and agents. The same format the catalogue files use — open one to see it."
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Manifest" hint="Paste the JSON.">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={'{\n  "key": "my-pack",\n  "name": "My Pack",\n  …\n}'}
            className={`${inputClass} resize-y font-mono text-[11.5px] leading-[1.55]`}
          />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || text.trim().length === 0}>
            {busy ? 'Installing…' : 'Install'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
