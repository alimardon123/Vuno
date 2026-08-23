// Members: people and agents, one roster. Not "People" (implies humans, and
// this is half agents) and not "Users" (the auth word). The HR team keeps its
// name — it is a team of agents inside the org, not a tab.

import { db } from '@/lib/db';
import { listMembers, memberLabel } from '@/lib/members';
import { Avatar, Empty, PresenceDot, SectionLabel } from '@/components/vuno/primitives';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return <main className="flex flex-1 items-center justify-center"><Empty title="No organisation yet" hint="Run bun run setup." /></main>;
  }

  const [members, teams, memberships] = await Promise.all([
    listMembers(org.id),
    db.team.findMany({ where: { orgId: org.id }, select: { id: true, name: true } }),
    db.membership.findMany({ where: { orgId: org.id }, select: { memberId: true, teamId: true, role: true } }),
  ]);

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const roleOf = new Map(memberships.map((m) => [m.memberId, { team: teamName.get(m.teamId) ?? null, role: m.role }]));

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Members</h1>
          <span className="tnum text-[11.5px] text-[var(--fg-4)]">
            {members.filter((m) => m.kind === 'human').length} people · {members.filter((m) => m.kind === 'agent').length} agents
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
          One roster. A person and an agent are the same kind of member — same teams, same workflow, same rows.
        </p>
      </header>

      <div className="px-6 pb-8">
        <SectionLabel count={members.length}>Everyone</SectionLabel>
        <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {members.map((m) => {
            const label = memberLabel(m);
            const assignment = roleOf.get(m.id);
            return (
              <li
                key={m.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--line)] px-4 py-2 last:border-b-0 transition-colors hover:bg-[var(--hover)]"
              >
                <Avatar name={m.displayName} kind={m.kind} size="md" presence={m.presenceState} />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-[13px] font-semibold tracking-[-0.008em]">{m.displayName}</span>
                    {label.chip ? (
                      <span className="shrink-0 rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1 py-px text-[10px] text-[var(--fg-3)]">
                        {label.chip}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-[var(--fg-3)]">
                    {m.presenceNote ?? (assignment ? `${assignment.team} · ${assignment.role.toLowerCase().replace(/_/g, ' ')}` : `@${m.handle}`)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PresenceDot state={m.presenceState} ring="var(--surface)" />
                  <span className="w-[92px] truncate text-right text-[11px] text-[var(--fg-4)]">
                    {assignment?.team ?? '—'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
