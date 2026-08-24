'use client';

// Skills and connectors: what a member is made of.
//
// Two of the three sections under Extensions, and the same component because
// they are the same shape — a row, who holds it, and what holding it changes.
// The third, Plugins, installs both at once (`plugins.tsx`).
//
// Holding a skill is not a setting. `src/lib/agents/turn.ts` reads it on every
// turn and puts it in the agent's instructions, so giving Peri the benchmark
// methodology changes what Peri does the next time it is asked something.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, SectionLabel } from '@/components/vuno/primitives';
import { Button, Dialog, Field, FormError, inputClass } from '@/components/vuno/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { SkillRow } from '@/lib/skills';
import type { ConnectionRow } from '@/lib/connections';
import { RelativeTime } from '@/components/vuno/primitives';

export interface LibraryMember {
  id: string;
  displayName: string;
  kind: 'human' | 'agent';
}

export function Library({
  skills,
  connections,
  members,
  tab,
}: {
  skills: SkillRow[];
  connections: ConnectionRow[];
  members: LibraryMember[];
  /** Which half of "what a member is made of" this view is showing. */
  tab: 'skills' | 'connectors';
}) {
  const [open, setOpen] = useState<
    | { kind: 'new' }
    | { kind: 'holders'; skill: SkillRow }
    | { kind: 'connect' }
    | { kind: 'connHolders'; connection: ConnectionRow }
    | null
  >(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function call(init: RequestInit & { url?: string }, done: string) {
    const { url = '/api/skills', ...rest } = init;
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...rest });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? 'That did not work');
    router.refresh();
    toast({ title: done });
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <p className="max-w-[62ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
          {tab === 'skills'
            ? 'What a member knows. A skill is instructions in the SKILL.md convention, and holding one is not a setting — the text below is put in front of the member on their next turn.'
            : 'What a member can reach. A connector is an MCP server this org has added, and holding one is the permission to call it — there is no second permission list.'}
        </p>
        <div className="ml-auto flex shrink-0 gap-1">
          {tab === 'skills' ? (
            <Button variant="primary" onClick={() => setOpen({ kind: 'new' })}>Write a skill</Button>
          ) : (
            <Button variant="primary" onClick={() => setOpen({ kind: 'connect' })}>Add a connector</Button>
          )}
        </div>
      </div>

      {tab === 'skills' ? (
        <>
      <SectionLabel count={skills.length}>Skills</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {skills.map((s) => (
          <li key={s.id} className="border-b border-[var(--line)] last:border-b-0">
            <div className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--hover)]">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{s.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-4)]">{s.key}</span>
                  <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">v{s.version}</span>
                </div>
                <p className="mt-0.5 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--fg-3)]">{s.summary}</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {s.holders.length === 0 ? (
                    <span className="text-[11px] text-[var(--fg-4)]">Nobody holds this yet</span>
                  ) : (
                    s.holders.map((h) => (
                      <span
                        key={h.id}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--sunken)] py-px pl-px pr-2"
                      >
                        <Avatar name={h.displayName} kind={h.kind as 'human' | 'agent'} size="xs" />
                        <span className="text-[10.5px] text-[var(--fg-2)]">{h.displayName}</span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-1">
                <Button onClick={() => setExpanded(expanded === s.id ? null : s.id)} aria-expanded={expanded === s.id}>
                  {expanded === s.id ? 'Hide' : 'Read'}
                </Button>
                <Button onClick={() => setOpen({ kind: 'holders', skill: s })} aria-label={`Who holds ${s.name}`}>
                  Who holds
                </Button>
              </div>
            </div>

            {expanded === s.id ? (
              // The actual instructions. What is shown here is what the agent
              // is told, verbatim — there is no second, prettier version.
              <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap border-t border-[var(--line)] bg-[var(--sunken)] px-4 py-3 font-mono text-[11.5px] leading-[1.6] text-[var(--fg-2)]">
                {s.content}
              </pre>
            ) : null}
          </li>
        ))}
        {skills.length === 0 ? (
          <li className="px-4 py-8 text-center">
            <p className="text-[12.5px] font-medium text-[var(--fg-2)]">The library is empty</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
              A skill is the instructions you would give a new colleague on their first day — how this org
              wants a benchmark run, what counts as evidence here.
            </p>
          </li>
        ) : null}
      </ul>
        </>
      ) : (
      <Connections
        connections={connections}
        onHolders={(c) => setOpen({ kind: 'connHolders', connection: c })}
        onCheck={(c) =>
          call(
            { url: '/api/connections', method: 'PATCH', body: JSON.stringify({ connectionId: c.id, check: true }) },
            `Checked ${c.name}`,
          )
        }
      />
      )}

      {open?.kind === 'new' ? <NewSkill onClose={() => setOpen(null)} onSubmit={call} /> : null}
      {open?.kind === 'connect' ? <NewConnection onClose={() => setOpen(null)} onSubmit={call} /> : null}
      {open?.kind === 'connHolders' ? (
        <ConnectionHolders
          connection={open.connection}
          members={members}
          onClose={() => setOpen(null)}
          onSubmit={call}
        />
      ) : null}
      {open?.kind === 'holders' ? (
        <Holders skill={open.skill} members={members} onClose={() => setOpen(null)} onSubmit={call} />
      ) : null}
    </>
  );
}

type Call = (init: RequestInit & { url?: string }, done: string) => Promise<void>;

function NewSkill({ onClose, onSubmit }: { onClose: () => void; onSubmit: Call }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = key || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <Dialog
      title="Write a skill"
      hint="What you would tell a new colleague on their first day. Every agent that holds it is told this, every turn."
      onClose={onClose}
      footer={
        <>
          <Button data-dismiss onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim() || !summary.trim() || !content.trim()}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onSubmit(
                {
                  method: 'POST',
                  body: JSON.stringify({ key: suggested, name: name.trim(), summary: summary.trim(), content }),
                },
                `${name.trim()} is in the library`,
              )
                .then(onClose)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Saving…' : 'Add to the library'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Benchmark methodology" />
      </Field>
      <Field label="Key" hint="How an agent package refers to this skill.">
        <input className={cn(inputClass, 'font-mono')} value={suggested} onChange={(e) => setKey(e.target.value)} placeholder="benchmark-methodology" />
      </Field>
      <Field label="Summary" hint="One line, for the library row.">
        <input className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="How to run a measurement this org will accept as evidence." />
      </Field>
      <Field label="Instructions" hint="Markdown. This goes into the agent's prompt verbatim.">
        <textarea
          className={cn(inputClass, 'min-h-[10rem] resize-y font-mono text-[11.5px] leading-[1.55]')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'State the target before you measure.\nReport the percentile the target names, not the mean.'}
        />
      </Field>
    </Dialog>
  );
}

function Holders({
  skill,
  members,
  onClose,
  onSubmit,
}: {
  skill: SkillRow;
  members: LibraryMember[];
  onClose: () => void;
  onSubmit: Call;
}) {
  const [held, setHeld] = useState(new Set(skill.holders.map((h) => h.id)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function toggle(memberId: string, next: boolean) {
    setBusy(memberId);
    setError(null);
    void onSubmit(
      { method: 'PATCH', body: JSON.stringify({ skillId: skill.id, memberId, held: next }) },
      next ? `Given to ${members.find((m) => m.id === memberId)?.displayName}` : 'Taken back',
    )
      .then(() =>
        setHeld((prev) => {
          const copy = new Set(prev);
          if (next) copy.add(memberId);
          else copy.delete(memberId);
          return copy;
        }),
      )
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  return (
    <Dialog
      title={`Who holds ${skill.name}`}
      hint="Everyone here is told these instructions on every turn they take."
      onClose={onClose}
      footer={<Button data-dismiss variant="primary" onClick={onClose}>Done</Button>}
    >
      <FormError message={error} />
      <ul className="-mx-1 max-h-[22rem] overflow-y-auto">
        {members.map((m) => {
          const has = held.has(m.id);
          return (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-[var(--hover)]">
                <input
                  type="checkbox"
                  checked={has}
                  disabled={busy === m.id}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                  className="size-3.5 accent-[var(--accent)]"
                />
                <Avatar name={m.displayName} kind={m.kind} size="xs" />
                <span className="text-[12.5px] text-[var(--fg-2)]">{m.displayName}</span>
                {m.kind === 'human' ? (
                  <span className="ml-auto text-[10.5px] text-[var(--fg-4)]">a reference for them</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

// ─── Connections ─────────────────────────────────────────────────────────────
// The row says what the connection actually offers, discovered from the server
// itself. That is the difference between this and a settings page: a row that
// listed tools somebody typed in would describe a capability nobody has
// confirmed the org has, which is the failure this whole section was held back
// for until there was a call path.

function Connections({
  connections,
  onHolders,
  onCheck,
}: {
  connections: ConnectionRow[];
  onHolders: (c: ConnectionRow) => void;
  onCheck: (c: ConnectionRow) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  return (
    <>
      <SectionLabel count={connections.length}>Connectors</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {connections.map((c) => (
          <li key={c.id} className="border-b border-[var(--line)] last:border-b-0">
            <div className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--hover)]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{c.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-4)]">{c.key}</span>
                  {c.lastError ? (
                    <span className="shrink-0 rounded-[3px] bg-[var(--falsified-bg)] px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.05em] text-[var(--falsified)]">
                      Unreachable
                    </span>
                  ) : c.checkedAt ? (
                    <span className="shrink-0 rounded-[3px] bg-[var(--tested-bg)] px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.05em] text-[var(--tested)]">
                      {c.tools.length} tool{c.tools.length === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">never checked</span>
                  )}
                  {c.checkedAt ? (
                    <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">
                      checked <RelativeTime value={c.checkedAt} />
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--fg-3)]">{c.summary}</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--fg-4)]">
                  {c.url}
                  {c.authEnvVar ? ` · token from ${c.authEnvVar}` : ' · no token'}
                </p>

                {c.lastError ? (
                  <p className="mt-1 max-w-[76ch] text-[11.5px] leading-[1.45] text-[var(--falsified)]">{c.lastError}</p>
                ) : null}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {c.holders.length === 0 ? (
                    <span className="text-[11px] text-[var(--fg-4)]">Nobody can call this yet</span>
                  ) : (
                    c.holders.map((h) => (
                      <span
                        key={h.id}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--sunken)] py-px pl-px pr-2"
                      >
                        <Avatar name={h.displayName} kind={h.kind as 'human' | 'agent'} size="xs" />
                        <span className="text-[10.5px] text-[var(--fg-2)]">{h.displayName}</span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-1">
                <Button
                  disabled={checking === c.id}
                  onClick={() => {
                    setChecking(c.id);
                    void onCheck(c).finally(() => setChecking(null));
                  }}
                >
                  {checking === c.id ? 'Checking…' : 'Check'}
                </Button>
                <Button
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  aria-expanded={expanded === c.id}
                  disabled={c.tools.length === 0}
                >
                  {expanded === c.id ? 'Hide' : 'Tools'}
                </Button>
                <Button onClick={() => onHolders(c)} aria-label={`Who can call ${c.name}`}>
                  Who can call
                </Button>
              </div>
            </div>

            {expanded === c.id && c.tools.length > 0 ? (
              // What the server said it offers, not what anyone typed here.
              <ul className="border-t border-[var(--line)] bg-[var(--sunken)] px-4 py-2">
                {c.tools.map((t) => (
                  <li key={t.name} className="py-1">
                    <span className="font-mono text-[11.5px] font-semibold text-[var(--fg)]">{t.name}</span>
                    {t.description ? (
                      <span className="ml-2 text-[11.5px] text-[var(--fg-3)]">{t.description}</span>
                    ) : null}
                    <p className="mt-0.5 max-w-[76ch] break-all font-mono text-[10.5px] leading-[1.5] text-[var(--fg-4)]">
                      {JSON.stringify(t.inputSchema)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        {connections.length === 0 ? (
          <li className="px-4 py-8 text-center">
            <p className="text-[12.5px] font-medium text-[var(--fg-2)]">No connections yet</p>
            <p className="mx-auto mt-1 max-w-[54ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
              An MCP server this org can reach — metrics, a repository, an issue tracker. Add one and it is
              dialled immediately, so the tools listed here are the ones that answered.
            </p>
          </li>
        ) : null}
      </ul>
    </>
  );
}

function NewConnection({ onClose, onSubmit }: { onClose: () => void; onSubmit: Call }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [summary, setSummary] = useState('');
  const [url, setUrl] = useState('');
  const [authEnvVar, setAuthEnvVar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = key || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <Dialog
      title="Add a connector"
      hint="An MCP server this org can reach. It is dialled as soon as you add it, so you find out now whether it works."
      onClose={onClose}
      footer={
        <>
          <Button data-dismiss onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim() || !summary.trim() || !url.trim()}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onSubmit(
                {
                  url: '/api/connections',
                  method: 'POST',
                  body: JSON.stringify({
                    key: suggested,
                    name: name.trim(),
                    summary: summary.trim(),
                    url: url.trim(),
                    authEnvVar: authEnvVar.trim() || null,
                  }),
                },
                `${name.trim()} added — check the row for what answered`,
              )
                .then(onClose)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Dialling…' : 'Add and dial it'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Observability" />
      </Field>
      <Field label="Key" hint="How an agent refers to this connection when it calls a tool.">
        <input className={cn(inputClass, 'font-mono')} value={suggested} onChange={(e) => setKey(e.target.value)} placeholder="observability" />
      </Field>
      <Field label="Summary" hint="One line, for the library row.">
        <input className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Metrics for the services this org runs." />
      </Field>
      <Field label="Endpoint" hint="The MCP server's http or https address.">
        <input className={cn(inputClass, 'font-mono')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://metrics.internal/mcp" />
      </Field>
      <Field
        label="Token variable"
        hint="The name of an environment variable holding the token — never the token. Leave empty if the server needs none."
      >
        <input
          className={cn(inputClass, 'font-mono')}
          value={authEnvVar}
          onChange={(e) => setAuthEnvVar(e.target.value)}
          placeholder="OBSERVABILITY_MCP_TOKEN"
        />
      </Field>
    </Dialog>
  );
}

function ConnectionHolders({
  connection,
  members,
  onClose,
  onSubmit,
}: {
  connection: ConnectionRow;
  members: LibraryMember[];
  onClose: () => void;
  onSubmit: Call;
}) {
  const [held, setHeld] = useState(new Set(connection.holders.map((h) => h.id)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function toggle(memberId: string, next: boolean) {
    setBusy(memberId);
    setError(null);
    void onSubmit(
      {
        url: '/api/connections',
        method: 'PATCH',
        body: JSON.stringify({ connectionId: connection.id, memberId, held: next }),
      },
      next ? `${members.find((m) => m.id === memberId)?.displayName} can call it` : 'Taken back',
    )
      .then(() =>
        setHeld((prev) => {
          const copy = new Set(prev);
          if (next) copy.add(memberId);
          else copy.delete(memberId);
          return copy;
        }),
      )
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  return (
    <Dialog
      title={`Who can call ${connection.name}`}
      hint="Holding a connector is the permission to call it. An agent that holds it is told what it offers on every turn."
      onClose={onClose}
      footer={<Button data-dismiss variant="primary" onClick={onClose}>Done</Button>}
    >
      <FormError message={error} />
      <ul className="-mx-1 max-h-[22rem] overflow-y-auto">
        {members.map((m) => {
          const has = held.has(m.id);
          return (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-[var(--hover)]">
                <input
                  type="checkbox"
                  checked={has}
                  disabled={busy === m.id}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                  className="size-3.5 accent-[var(--accent)]"
                />
                <Avatar name={m.displayName} kind={m.kind} size="xs" />
                <span className="text-[12.5px] text-[var(--fg-2)]">{m.displayName}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
