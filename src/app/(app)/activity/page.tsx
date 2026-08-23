// Activity: the screen you open first. What needs you, ordered by urgency.
//
// The workflow doc names the risk that the escalation ladder routes everything
// to you and you become the bottleneck the product was meant to remove. You
// cannot manage that without a place that shows it.

import Link from 'next/link';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';
import { memberMap } from '@/lib/members';
import { isStage, STAGES } from '@/lib/orchestrator/stages';
import { noHarnessConfiguredMessage } from '@/lib/agents/registry';
import { Avatar, Empty, GateChip, RelativeTime, StatusPill, gateLabel, type ClaimStatus } from '@/components/vuno/primitives';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return <main className="flex flex-1 items-center justify-center"><Empty title="No organisation yet" hint="Run bun run setup to seed one." /></main>;
  }

  const [blockedGates, objectives, recentClaims, failedItems, sessions] = await Promise.all([
    db.gate.findMany({ where: { orgId: org.id, state: 'blocked' } }),
    db.objective.findMany({ where: { orgId: org.id, status: { not: 'shipped' } }, orderBy: { stageEnteredAt: 'desc' } }),
    db.claim.findMany({ where: { orgId: org.id }, orderBy: { updatedAt: 'desc' }, take: 6 }),
    db.workItem.findMany({ where: { orgId: org.id, state: 'failed' }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    db.workSession.findMany({ where: { orgId: org.id }, orderBy: { startedAt: 'desc' }, take: 8 }),
  ]);
  const members = await memberMap([
    ...recentClaims.map((c) => c.provenanceMemberId ?? ''),
    ...sessions.map((s) => s.memberId),
  ].filter(Boolean));

  const parked = objectives.filter((o) => {
    const stage = isStage(o.stage) ? o.stage : 'filed';
    return !STAGES[stage].implemented;
  });

  const nothingNeedsYou = blockedGates.length === 0 && failedItems.length === 0 && parked.length === 0;

  // An org whose agents cannot run should say so once, here, rather than
  // leaving you to work it out from failed work items.
  const noHarness = noHarnessConfiguredMessage();

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Activity</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">What needs you, and what the organisation did while you were away.</p>
      </header>

      <div className="flex flex-col gap-5 p-6 mx-auto w-full max-w-[70rem]">
        {noHarness ? (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
            <p className="text-[12.5px] font-semibold text-[var(--fg)]">No model is configured</p>
            <p className="mt-1 max-w-[76ch] text-[11.5px] leading-[1.55] text-[var(--fg-3)]">
              Agents cannot run, so mentioning one queues a turn that fails. Set{' '}
              <code className="rounded-[3px] bg-[var(--sunken)] px-1 py-px font-mono text-[11px]">ANTHROPIC_API_KEY</code>{' '}
              for hosted models, or{' '}
              <code className="rounded-[3px] bg-[var(--sunken)] px-1 py-px font-mono text-[11px]">OLLAMA_BASE_URL</code>{' '}
              to use a local one — both go in <code className="rounded-[3px] bg-[var(--sunken)] px-1 py-px font-mono text-[11px]">.env</code>.
              Everything deterministic works without either: objectives route, gates evaluate, claims transition.
            </p>
          </div>
        ) : null}

        {nothingNeedsYou ? (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-[var(--fg-2)]">Nothing is waiting on you.</p>
            <p className="mt-1 text-[11.5px] text-[var(--fg-3)]">Escalation rate is the health metric here — an empty list is the goal, not a bug.</p>
          </div>
        ) : null}

        {blockedGates.length > 0 ? (
          <Panel title="Blocked gates" hint="A gate blocks because a query over the ledger says so. It can name what blocked it.">
            {blockedGates.map((g) => {
              let evidence: Array<{ label: string }> = [];
              try { evidence = JSON.parse(g.evidence || '[]') as Array<{ label: string }>; } catch { evidence = []; }
              return (
                <Row key={g.id} href={`/work#gate-${g.id}`}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold">{gateLabel(g.name)}</span>
                      <GateChip state={g.state} />
                    </div>
                    {g.reason ? <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">{g.reason}</p> : null}
                    {evidence.slice(0, 2).map((e, i) => (
                      <p key={i} className="mt-0.5 truncate pl-3 text-[11px] text-[var(--fg-4)]">↳ {e.label}</p>
                    ))}
                  </div>
                </Row>
              );
            })}
          </Panel>
        ) : null}

        {parked.length > 0 ? (
          <Panel title="Objectives waiting on a decision" hint="These have reached a stage the orchestrator cannot advance on its own.">
            {parked.map((o) => {
              const stage = isStage(o.stage) ? o.stage : 'filed';
              return (
                <Row key={o.id} href={`/work#objective-${o.id}`}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12.5px] font-semibold">{o.title}</span>
                    <span className="text-[11.5px] text-[var(--fg-3)]">
                      Parked at <span className="text-[var(--fg-2)]">{STAGES[stage].label}</span> · <RelativeTime value={String(o.stageEnteredAt)} />
                    </span>
                  </div>
                </Row>
              );
            })}
          </Panel>
        ) : null}

        {failedItems.length > 0 ? (
          <Panel title="Work that failed" hint="Retried to its attempt limit and stopped, rather than looping.">
            {failedItems.map((i) => (
              // Work reached from a mention belongs to no objective, so there
              // is nothing on /work to point at — the row still shows the
              // failure and what to do about it.
              <Row key={i.id} href={i.objectiveId ? `/work#objective-${i.objectiveId}` : undefined}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-[12px]">{i.kind}</span>
                  <span className="truncate text-[11.5px] text-[var(--falsified)]">{i.lastError}</span>
                </div>
                <span className="tnum text-[10.5px] text-[var(--fg-4)]">{i.attempts} attempts</span>
              </Row>
            ))}
          </Panel>
        ) : null}

        <Panel title="Latest on the ledger" hint="What the organisation currently believes.">
          {recentClaims.map((c) => {
            const m = c.provenanceMemberId ? members.get(c.provenanceMemberId) : null;
            return (
              <Row key={c.id} href={`/ledger#claim-${c.id}`}>
                {m ? <Avatar name={m.displayName} kind={m.kind} size="xs" /> : <span className="size-5" />}
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--fg-2)]">{c.statement}</span>
                <StatusPill status={c.status as ClaimStatus} />
              </Row>
            );
          })}
        </Panel>

        {sessions.length > 0 ? (
          <Panel title="Recent runs" hint="Every attempt is recorded with who made it and what it cost.">
            {sessions.map((s) => {
              const m = members.get(s.memberId);
              return (
                <Row key={s.id}>
                  {m ? <Avatar name={m.displayName} kind={m.kind} size="xs" /> : <span className="size-5" />}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--fg-2)]">
                    {m?.displayName ?? 'Orchestrator'}
                  </span>
                  <span className="text-[10.5px] text-[var(--fg-4)]">{s.outcome}</span>
                  <span className="tnum text-[10.5px] text-[var(--fg-4)]">
                    {s.durationMs != null ? `${s.durationMs}ms` : '—'}
                  </span>
                  <RelativeTime className="tnum text-[10.5px] text-[var(--fg-4)]" value={String(s.startedAt)} />
                </Row>
              );
            })}
          </Panel>
        ) : null}
      </div>
    </main>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-4)]">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] text-[var(--fg-3)]">{hint}</p> : null}
      </header>
      <ul>{children}</ul>
    </section>
  );
}

/**
 * A row, and a link to the thing it names when there is one. Activity used to
 * report a blocked gate and a falsified claim and leave you to go find them —
 * "every surface has a URL" is only useful if something points at it.
 */
function Row({ children, href }: { children: React.ReactNode; href?: string }) {
  const inner = 'flex items-center gap-2.5 px-4 py-2 transition-colors';
  return (
    <li className="border-b border-[var(--line)] last:border-b-0">
      {href ? (
        <Link
          href={href}
          className={cn(inner, 'hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]')}
        >
          {children}
        </Link>
      ) : (
        <div className={cn(inner, 'hover:bg-[var(--hover)]')}>{children}</div>
      )}
    </li>
  );
}
