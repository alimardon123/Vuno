'use client';

// The roster, and the things you can do to it: hire, promote, demote, promote
// an assistant to a colleague, retire.
//
// One row shape for a person and an agent, one set of actions, because they are
// the same kind of member (ADR-0009). The only asymmetries are real ones: an
// agent names what runs it, and only an assistant can become a colleague.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, PresenceDot, SectionLabel, type PresenceState } from '@/components/vuno/primitives';
import { Button, Dialog, Field, FormError, inputClass } from '@/components/vuno/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface RosterMember {
  id: string;
  kind: 'human' | 'agent';
  displayName: string;
  handle: string;
  role: string | null;
  roleLabel: string | null;
  status: string;
  presenceState: PresenceState;
  presenceNote: string | null;
  teamId: string | null;
  teamName: string | null;
  teamRole: string | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  isOrgOwner: boolean;
  harnessName: string | null;
  modelName: string | null;
}

export interface TeamOption {
  id: string;
  name: string;
}

const TEAM_ROLES = [
  { id: 'MEMBER', label: 'Member' },
  { id: 'TEAM_LEAD', label: 'Team lead' },
  { id: 'DEPARTMENT_HEAD', label: 'Department head' },
] as const;

const HARNESSES = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Needs ANTHROPIC_API_KEY' },
  { id: 'ollama', label: 'Ollama', hint: 'A local model — needs OLLAMA_BASE_URL' },
] as const;

type Open =
  | { kind: 'hire'; as: 'human' | 'agent' }
  | { kind: 'role'; member: RosterMember }
  | { kind: 'colleague'; member: RosterMember }
  | { kind: 'retire'; member: RosterMember }
  | null;

export function Roster({
  members,
  teams,
  runnable,
  initialQuery = '',
}: {
  members: RosterMember[];
  teams: TeamOption[];
  /** Harnesses this install can actually run, so a member who cannot is flagged. */
  runnable: string[];
  /**
   * Seeded from `?q=` so a link to a person lands on that person. The Org view
   * links here by handle; without this the link arrived at an unfiltered
   * roster, which is a dangling anchor with extra steps.
   */
  initialQuery?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [q, setQ] = useState(initialQuery);
  const router = useRouter();
  const { toast } = useToast();

  const visible = members.filter(
    (m) =>
      !q ||
      m.displayName.toLowerCase().includes(q.toLowerCase()) ||
      m.handle.includes(q.toLowerCase()) ||
      (m.roleLabel ?? '').toLowerCase().includes(q.toLowerCase()) ||
      (m.teamName ?? '').toLowerCase().includes(q.toLowerCase()),
  );

  const active = visible.filter((m) => m.status === 'active');
  const retired = visible.filter((m) => m.status !== 'active');

  async function send(url: string, body: unknown, done: string) {
    const res = await fetch(url, {
      method: url.includes('/members/') ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? 'That did not work');
    setOpen(null);
    router.refresh();
    toast({ title: done });
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the roster…"
          aria-label="Search the roster"
          className={cn(inputClass, 'max-w-[16rem]')}
        />
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setOpen({ kind: 'hire', as: 'human' })}>Add a person</Button>
          <Button variant="primary" onClick={() => setOpen({ kind: 'hire', as: 'agent' })}>
            Install an agent
          </Button>
        </div>
      </div>

      {/* When one harness is missing, that is a fact about one agent and the
          row says so. When none is configured, it is a fact about the install,
          and repeating it on every agent says the same thing nine times while
          hiding the one thing worth doing about it. */}
      {runnable.length === 0 ? (
        <p className="mb-2 rounded-lg border border-line-2 bg-[var(--sunken)] px-3 py-2 text-[11.5px] text-[var(--fg-2)]">
          No model is configured, so no agent here can run. Set{' '}
          <code className="rounded bg-[var(--raised)] px-1 font-mono text-[11px]">ANTHROPIC_API_KEY</code> for hosted
          models, or <code className="rounded bg-[var(--raised)] px-1 font-mono text-[11px]">OLLAMA_HOST</code> for local
          ones, and restart. Everything else on this page works without one.
        </p>
      ) : null}

      <SectionLabel count={active.length}>Everyone</SectionLabel>
      <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {active.map((m) => (
          <Row key={m.id} member={m} runnable={runnable} onAct={setOpen} />
        ))}
        {active.length === 0 ? (
          <li className="px-4 py-6 text-center text-[11.5px] text-[var(--fg-4)]">
            {q ? 'Nobody matches that.' : 'Nobody here yet.'}
          </li>
        ) : null}
      </ul>

      {retired.length > 0 ? (
        <>
          <SectionLabel count={retired.length}>Retired</SectionLabel>
          <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] opacity-60">
            {retired.map((m) => (
              <Row key={m.id} member={m} runnable={runnable} onAct={setOpen} />
            ))}
          </ul>
        </>
      ) : null}

      {open?.kind === 'hire' ? (
        <HireDialog as={open.as} teams={teams} members={members} onClose={() => setOpen(null)} onSubmit={send} />
      ) : null}
      {open?.kind === 'role' ? (
        <RoleDialog member={open.member} onClose={() => setOpen(null)} onSubmit={send} />
      ) : null}
      {open?.kind === 'colleague' ? (
        <ColleagueDialog member={open.member} teams={teams} onClose={() => setOpen(null)} onSubmit={send} />
      ) : null}
      {open?.kind === 'retire' ? (
        <RetireDialog member={open.member} onClose={() => setOpen(null)} onSubmit={send} />
      ) : null}
    </>
  );
}

function Row({
  member: m,
  runnable,
  onAct,
}: {
  member: RosterMember;
  runnable: string[];
  onAct: (o: Open) => void;
}) {
  // The same chip on every row carries no information. This one appears only
  // when it changes something: this agent's harness is not configured while
  // another one is, so mentioning them queues a turn that fails and moving
  // them to the working harness fixes it. With nothing configured at all there
  // is no such choice to make, and the roster says it once at the top instead.
  const cannotRun =
    runnable.length > 0 &&
    m.kind === 'agent' &&
    m.status === 'active' &&
    m.harnessName !== null &&
    !runnable.includes(m.harnessName);
  const canPromote = m.status === 'active' && m.teamId !== null;
  const canBeColleague = m.status === 'active' && m.kind === 'agent' && m.ownerMemberId !== null;
  const canRetire = m.status === 'active' && !m.isOrgOwner;

  return (
    <li className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--line)] px-4 py-2 transition-colors last:border-b-0 hover:bg-[var(--hover)]">
      <Avatar name={m.displayName} kind={m.kind} size="md" presence={m.presenceState} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{m.displayName}</span>
          {m.isOrgOwner ? <Chip>Owner</Chip> : null}
          {m.ownerName ? <Chip>{m.ownerName}&rsquo;s assistant</Chip> : m.roleLabel ? <Chip>{m.roleLabel}</Chip> : null}
          {cannotRun ? (
            <span
              title={`No ${m.harnessName} harness is configured, so ${m.displayName} cannot run.`}
              className="shrink-0 rounded-[4px] border border-falsified bg-[var(--falsified-bg)] px-1 py-px text-[10px] font-medium text-[var(--falsified)]"
            >
              {m.harnessName} not configured
            </span>
          ) : null}
        </div>
        <p className="truncate text-[11px] text-[var(--fg-3)]">
          @{m.handle}
          {m.teamName ? ` · ${m.teamName}` : ''}
          {m.teamRole && m.teamRole !== 'MEMBER' ? ` · ${label(m.teamRole)}` : ''}
          {m.presenceNote ? ` · ${m.presenceNote}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* Visible on hover or keyboard focus — a row of buttons on every row
            would drown the roster, and hover-only would strand the keyboard. */}
        <div className="flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {canPromote ? (
            <Button onClick={() => onAct({ kind: 'role', member: m })} aria-label={`Change ${m.displayName}'s role`}>
              Role
            </Button>
          ) : null}
          {canBeColleague ? (
            <Button
              onClick={() => onAct({ kind: 'colleague', member: m })}
              aria-label={`Promote ${m.displayName} to colleague`}
            >
              To colleague
            </Button>
          ) : null}
          {canRetire ? (
            <Button variant="danger" onClick={() => onAct({ kind: 'retire', member: m })} aria-label={`Retire ${m.displayName}`}>
              Retire
            </Button>
          ) : null}
        </div>
        <PresenceDot state={m.presenceState} ring="var(--surface)" />
        <span className="w-[92px] truncate text-right text-[11px] text-[var(--fg-4)]">{m.teamName ?? '—'}</span>
      </div>
    </li>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1 py-px text-[10px] text-[var(--fg-3)]">
      {children}
    </span>
  );
}

function label(role: string): string {
  return TEAM_ROLES.find((r) => r.id === role)?.label ?? role.replace(/_/g, ' ').toLowerCase();
}

type Submit = (url: string, body: unknown, done: string) => Promise<void>;

/** Shared submit plumbing: one busy flag, one error line, one place it can fail. */
function useSubmit(onSubmit: Submit) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (url: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(url, body, done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function HireDialog({
  as,
  teams,
  members,
  onClose,
  onSubmit,
}: {
  as: 'human' | 'agent';
  teams: TeamOption[];
  members: RosterMember[];
  onClose: () => void;
  onSubmit: Submit;
}) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [teamId, setTeamId] = useState('');
  const [role, setRole] = useState(as === 'agent' ? 'security' : '');
  const [harness, setHarness] = useState<string>('anthropic');
  const [model, setModel] = useState('claude-opus-5');
  const [ownerId, setOwnerId] = useState('');
  const { busy, error, run } = useSubmit(onSubmit);

  // Suggested, not forced: a handle you can still edit before it is yours.
  const suggested = handle || name.trim().toLowerCase().split(/\s+/)[0] || '';
  const people = members.filter((m) => m.kind === 'human' && m.status === 'active');

  return (
    <Dialog
      title={as === 'agent' ? 'Install an agent' : 'Add a person'}
      hint={
        as === 'agent'
          ? 'An agent joins the roster like anyone else. Naming what runs it is part of hiring it.'
          : 'A person and an agent are the same kind of member — same teams, same roles.'
      }
      onClose={onClose}
      footer={
        <>
          <Button data-dismiss onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim() || !suggested}
            onClick={() =>
              void run(
                '/api/members',
                {
                  kind: as,
                  displayName: name.trim(),
                  handle: suggested,
                  teamId: teamId || null,
                  ...(as === 'agent'
                    ? { role: role.trim() || 'agent', harnessName: harness, modelName: model.trim() }
                    : {}),
                  ...(as === 'agent' && ownerId ? { ownerMemberId: ownerId } : {}),
                },
                `${name.trim()} joined the org`,
              )
            }
          >
            {busy ? 'Adding…' : as === 'agent' ? 'Install' : 'Add'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={as === 'agent' ? 'Sid' : 'Mira Okonkwo'} />
      </Field>
      <Field label="Handle" hint="What people type after @ to bring them into a conversation.">
        <input className={inputClass} value={suggested} onChange={(e) => setHandle(e.target.value)} placeholder="sid" />
      </Field>
      {as === 'agent' ? (
        <>
          <Field label="Role" hint="What this agent is for — security, performance, research.">
            <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label="Harness" hint={HARNESSES.find((h) => h.id === harness)?.hint}>
            <select className={inputClass} value={harness} onChange={(e) => setHarness(e.target.value)}>
              {HARNESSES.map((h) => (
                <option key={h.id} value={h.id}>{h.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-5" />
          </Field>
          <Field label="Works for" hint="Leave empty for a colleague who works for the org.">
            <select className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">The org</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      <Field label="Team" hint="Optional. They can join one later.">
        <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}

function RoleDialog({ member, onClose, onSubmit }: { member: RosterMember; onClose: () => void; onSubmit: Submit }) {
  const [to, setTo] = useState(member.teamRole === 'MEMBER' ? 'TEAM_LEAD' : 'MEMBER');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit(onSubmit);

  return (
    <Dialog
      title={`${member.displayName}'s role`}
      hint={`Currently ${label(member.teamRole ?? 'MEMBER')} on ${member.teamName ?? 'no team'}. The change goes on the record with its reason.`}
      onClose={onClose}
      footer={
        <>
          <Button data-dismiss onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !reason.trim()}
            onClick={() => void run(`/api/members/${member.id}`, { action: 'change_role', to, reason: reason.trim() }, `${member.displayName} is now ${label(to)}`)}
          >
            {busy ? 'Saving…' : 'Change role'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="New role">
        <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>
          {TEAM_ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Reason" hint="Why now. Somebody reading this in six months should understand it.">
        <textarea
          className={cn(inputClass, 'min-h-[64px] resize-y')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ran the WAL review end to end and caught the memory issue nobody else did."
        />
      </Field>
    </Dialog>
  );
}

function ColleagueDialog({
  member,
  teams,
  onClose,
  onSubmit,
}: {
  member: RosterMember;
  teams: TeamOption[];
  onClose: () => void;
  onSubmit: Submit;
}) {
  const [teamId, setTeamId] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit(onSubmit);

  return (
    <Dialog
      title={`Promote ${member.displayName} to colleague`}
      hint={`${member.displayName} works for ${member.ownerName} and sees what they see. A colleague works for the org, on a team, like anyone else.`}
      onClose={onClose}
      footer={
        <>
          <Button data-dismiss onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run(
                `/api/members/${member.id}`,
                { action: 'promote_to_colleague', reason: reason.trim(), teamId: teamId || null },
                `${member.displayName} works for the org now`,
              )
            }
          >
            {busy ? 'Promoting…' : 'Promote'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="Team" hint="Optional, but a colleague with no team has nobody to work with.">
        <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Reason">
        <textarea
          className={cn(inputClass, 'min-h-[64px] resize-y')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Has been doing org-wide research for a month; the work is not personal any more."
        />
      </Field>
    </Dialog>
  );
}

function RetireDialog({ member, onClose, onSubmit }: { member: RosterMember; onClose: () => void; onSubmit: Submit }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit(onSubmit);

  return (
    <Dialog
      title={`Retire ${member.displayName}`}
      hint="They keep their history — everything they said and every claim they made stays on the record. They stop holding a role and stop being brought into conversations."
      onClose={onClose}
      footer={
        <>
          <Button data-dismiss onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy || !reason.trim()}
            onClick={() => void run(`/api/members/${member.id}`, { action: 'retire', reason: reason.trim() }, `${member.displayName} has been retired`)}
          >
            {busy ? 'Retiring…' : 'Retire'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="Reason">
        <textarea
          className={cn(inputClass, 'min-h-[64px] resize-y')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Role folded into Verifier after the QA review."
        />
      </Field>
    </Dialog>
  );
}
