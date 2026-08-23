'use client';

// The Library: what an agent is made of.
//
// Multica gives Agents, Runtimes and Skills three separate nav items. That is
// an implementation detail promoted to navigation — all three answer the same
// question, so this is one section inside Members (docs/IA-NAVIGATION.md).
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

export interface LibraryMember {
  id: string;
  displayName: string;
  kind: 'human' | 'agent';
}

export function Library({ skills, members }: { skills: SkillRow[]; members: LibraryMember[] }) {
  const [open, setOpen] = useState<{ kind: 'new' } | { kind: 'holders'; skill: SkillRow } | null>(null);
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
          Instructions an agent can hold, in the <span className="font-mono text-[11px]">SKILL.md</span> convention.
          Holding one changes what that agent is told on every turn — it is a staffing decision, not a setting.
        </p>
        <Button className="ml-auto shrink-0" variant="primary" onClick={() => setOpen({ kind: 'new' })}>
          Write a skill
        </Button>
      </div>

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
                <Button onClick={() => setOpen({ kind: 'holders', skill: s })} aria-label={`Choose who holds ${s.name}`}>
                  Who holds it
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

      {open?.kind === 'new' ? <NewSkill onClose={() => setOpen(null)} onSubmit={call} /> : null}
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
