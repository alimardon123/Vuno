// Members: people and agents, one roster. Not "People" (implies humans, and
// this is half agents) and not "Users" (the auth word). The HR team keeps its
// name — it is a team of agents inside the org, not a tab.

import { db } from '@/lib/db';
import { listMembers, roleLabel } from '@/lib/members';
import { configuredHarnesses } from '@/lib/agents/registry';
import { reviewOrg } from '@/lib/review/metrics';
import { Review } from '@/components/vuno/review';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Empty } from '@/components/vuno/primitives';
import { Roster, type RosterMember } from '@/components/vuno/roster';

export const dynamic = 'force-dynamic';

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // A sub-view rather than a rail tab of its own, and in the URL, so a review
  // is a link someone can send. Skills and connectors used to be a third tab
  // here; they moved to Extensions, which answers "what can this org do" rather
  // than "who is in it" (docs/IA-NAVIGATION.md).
  const requested = (await searchParams).view;
  const view = requested === 'review' ? requested : 'roster';
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return <main className="flex flex-1 items-center justify-center"><Empty title="No organisation yet" hint="Run bun run setup." /></main>;
  }

  const [members, teams, memberships, agents] = await Promise.all([
    // Retired members stay on the roster in their own section: they authored
    // events and carry claims, and a roster that erases them makes the org's
    // own history unreadable.
    listMembers(org.id, { includeRetired: true }),
    db.team.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.membership.findMany({ where: { orgId: org.id }, select: { memberId: true, teamId: true, role: true } }),
    db.agentProfile.findMany({ select: { memberId: true, modelName: true, harnessName: true } }),
  ]);

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const assignment = new Map(memberships.map((m) => [m.memberId, m]));
  const harness = new Map(agents.map((a) => [a.memberId, a]));

  const roster: RosterMember[] = members.map((m) => {
    const seat = assignment.get(m.id);
    const run = harness.get(m.id);
    return {
      id: m.id,
      kind: m.kind,
      displayName: m.displayName,
      handle: m.handle,
      role: m.role,
      roleLabel: m.role ? roleLabel(m.role) : null,
      status: m.status,
      presenceState: m.presenceState,
      presenceNote: m.presenceNote,
      teamId: seat?.teamId ?? m.teamId,
      teamName: seat ? (teamName.get(seat.teamId) ?? null) : m.teamId ? (teamName.get(m.teamId) ?? null) : null,
      teamRole: seat?.role ?? null,
      ownerMemberId: m.ownerMemberId,
      ownerName: m.ownerName,
      isOrgOwner: m.isOrgOwner,
      harnessName: run?.harnessName ?? null,
      modelName: run?.modelName ?? null,
    };
  });

  const people = roster.filter((m) => m.kind === 'human' && m.status === 'active').length;
  const bots = roster.filter((m) => m.kind === 'agent' && m.status === 'active').length;

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <div className="mx-auto w-full max-w-[70rem]">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Members</h1>
            <span className="tnum text-[11.5px] text-[var(--fg-4)]">
              {people} {people === 1 ? 'person' : 'people'} · {bots} {bots === 1 ? 'agent' : 'agents'}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
            One roster. A person and an agent are the same kind of member — same teams, same workflow, same rows.
          </p>
          <nav className="mt-2 flex gap-1" aria-label="Members view">
            {([['roster', 'Roster'], ['review', 'Review']] as const).map(([id, label]) => (
              <Link
                key={id}
                href={id === 'roster' ? '/members' : `/members?view=${id}`}
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
        </div>
      </header>

      <div className="mx-auto w-full max-w-[70rem] px-6 pb-8 pt-3">
        {view === 'review' ? (
          <Review review={await reviewOrg(org.id)} />
        ) : (
          <Roster members={roster} teams={teams} runnable={configuredHarnesses()} />
        )}
      </div>
    </main>
  );
}
