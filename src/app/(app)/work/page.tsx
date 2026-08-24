// Work: objectives and what is happening to them. This surface did not exist —
// filing an objective was a button in Settings with nowhere to go afterwards,
// which is why there was nothing to watch.

import Link from 'next/link';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';
import { board } from '@/lib/work/board';
import { Board } from '@/components/vuno/board';
import { memberMap } from '@/lib/members';
import { isStage, STAGES, STAGE_ORDER, stageProgress } from '@/lib/orchestrator/stages';
import { Avatar, Empty, GateChip, RelativeTime, gateLabel } from '@/components/vuno/primitives';

export const dynamic = 'force-dynamic';

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // A view of the same objectives, not a second destination. The board is an
  // arrangement of this work — putting it on the rail would imply it is
  // somewhere else, and it would then need its own way of filing an objective
  // (docs/IA-NAVIGATION.md).
  const view = (await searchParams).view === 'board' ? 'board' : 'list';
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return <main className="flex flex-1 items-center justify-center"><Empty title="No organisation yet" hint="Run bun run setup." /></main>;
  }

  const objectives = await db.objective.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'desc' } });
  const [items, sessions, gates] = await Promise.all([
    db.workItem.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } }),
    db.workSession.findMany({ where: { orgId: org.id }, orderBy: { startedAt: 'desc' }, take: 300 }),
    db.gate.findMany({ where: { orgId: org.id } }),
  ]);
  const members = await memberMap(sessions.map((s) => s.memberId));

  const nav = (
    <nav className="mt-2 flex gap-1" aria-label="Work view">
      {([['list', 'List'], ['board', 'Board']] as const).map(([id, label]) => (
        <Link
          key={id}
          href={id === 'list' ? '/work' : '/work?view=board'}
          aria-current={view === id ? 'page' : undefined}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
            'focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
            view === id
              ? 'bg-[var(--select)] font-semibold text-[var(--fg)]'
              : 'text-[var(--fg-3)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  if (view === 'board') {
    return (
      // Not `scroll-y`: the board owns its own scrolling in both directions, and
      // a page that also scrolls would give a card two scrollbars to fight.
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Work</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
            The same objectives, by stage. Drag a card or use its menu to move one — that is a judgment the
            orchestrator records and then carries on from.
          </p>
          {nav}
        </header>
        {objectives.length === 0 ? (
          <Empty title="No objectives yet" hint="File one and the orchestrator routes it, assembles a working group, and starts interrogating it." />
        ) : (
          <Board columns={await board(org.id)} />
        )}
      </main>
    );
  }

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <div className="mx-auto w-full max-w-[70rem]">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Work</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
          Objectives, and what the organisation is doing about them. The orchestrator advances these on its own.
        </p>
        {nav}
        </div>
      </header>

      {objectives.length === 0 ? (
        <Empty title="No objectives yet" hint="File one and the orchestrator routes it, assembles a working group, and starts interrogating it." />
      ) : (
        <div className="flex flex-col gap-3 p-6 mx-auto w-full max-w-[70rem]">
          {objectives.map((o) => {
            const stage = isStage(o.stage) ? o.stage : 'filed';
            const spec = STAGES[stage];
            const progress = stageProgress(stage);
            const mine = items.filter((i) => i.objectiveId === o.id);
            const mySessions = sessions.filter((s) => mine.some((i) => i.id === s.workItemId));
            const running = mine.filter((i) => i.state === 'leased').length;
            const pending = mine.filter((i) => i.state === 'pending').length;

            return (
              <article
                key={o.id}
                id={`objective-${o.id}`}
                className="scroll-mt-20 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 pb-2.5 pt-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[14px] font-semibold tracking-[-0.012em]">{o.title}</h2>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--fg-2)]">{o.successCriteria}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {o.owningDepartment ? (
                      <span className="rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1.5 py-px text-[10px] text-[var(--fg-3)]">
                        {o.owningDepartment}
                      </span>
                    ) : null}
                    <span className="rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1.5 py-px text-[10px] text-[var(--fg-3)]">
                      {o.autonomyLevel}
                    </span>
                  </div>
                </div>

                {/* Where it is, and how far that is. */}
                <div className="border-t border-[var(--line)] px-4 py-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-[var(--fg)]">{spec.label}</span>
                    <span className="tnum text-[10.5px] text-[var(--fg-4)]">
                      stage {progress.index} of {progress.total}
                    </span>
                    {running > 0 ? (
                      <span className="rounded-[4px] bg-[var(--asserted-bg)] px-1.5 py-px text-[10px] font-semibold text-[var(--asserted)]">
                        {running} running
                      </span>
                    ) : null}
                    {pending > 0 ? (
                      <span className="rounded-[4px] bg-[var(--sunken)] px-1.5 py-px text-[10px] text-[var(--fg-3)]">
                        {pending} queued
                      </span>
                    ) : null}
                    {!spec.implemented ? (
                      // Says what it means for the reader, not what it means for
                      // the runtime: they are the one this is waiting on.
                      <span className="ml-auto text-[10.5px] text-[var(--fg-4)]">Waiting on you — the orchestrator cannot advance this stage</span>
                    ) : null}
                  </div>
                  <div className="flex gap-px overflow-hidden rounded-full" role="img" aria-label={`Stage ${progress.index} of ${progress.total}`}>
                    {STAGE_ORDER.map((s, i) => (
                      <span
                        key={s}
                        title={STAGES[s].label}
                        className="h-[3px] flex-1"
                        style={{ background: i <= progress.index ? 'var(--fg-2)' : 'var(--line)' }}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-[1.5] text-[var(--fg-3)]">{spec.description}</p>
                </div>

                {mySessions.length > 0 ? (
                  <div className="border-t border-[var(--line)]">
                    <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-4)]">
                      What ran
                    </div>
                    <ul className="pb-2">
                      {mySessions.slice(0, 6).map((s) => {
                        const m = members.get(s.memberId);
                        const kind = mine.find((i) => i.id === s.workItemId)?.kind ?? 'work';
                        return (
                          <li key={s.id} className="flex items-center gap-2 px-4 py-[3px] text-[11.5px]">
                            {m ? <Avatar name={m.displayName} kind={m.kind} size="xs" /> : <span className="size-5" />}
                            <span className="min-w-0 truncate text-[var(--fg-2)]">{m?.displayName ?? 'Orchestrator'}</span>
                            <span className="truncate font-mono text-[10.5px] text-[var(--fg-4)]">{kind}</span>
                            <span className="tnum ml-auto text-[10.5px] text-[var(--fg-4)]">
                              {s.durationMs != null ? `${s.durationMs}ms` : '—'}
                            </span>
                            <RelativeTime className="tnum text-[10.5px] text-[var(--fg-4)]" value={String(s.startedAt)} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}

          {gates.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
              <h2 className="border-b border-[var(--line)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-4)]">
                Gates
              </h2>
              <ul>
                {gates.map((g) => {
                  let evidence: Array<{ label: string }> = [];
                  try { evidence = JSON.parse(g.evidence || '[]') as Array<{ label: string }>; } catch { evidence = []; }
                  return (
                    <li key={g.id} id={`gate-${g.id}`} className="scroll-mt-20 border-b border-[var(--line)] px-4 py-2 last:border-b-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium">{gateLabel(g.name)}</span>
                        <GateChip state={g.state} />
                      </div>
                      {g.reason ? <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">{g.reason}</p> : null}
                      {evidence.slice(0, 3).map((e, i) => (
                        <p key={i} className="mt-0.5 truncate pl-3 text-[11px] text-[var(--fg-4)]">↳ {e.label}</p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
