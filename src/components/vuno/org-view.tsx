// The org: the same members, arranged by who they work with.
//
// Two renderings of one tree, because they answer different questions. The
// outline answers "who is in Engineering" and is where you go to find a person.
// The graph answers "what shape is this org" — how many departments, how deep,
// where the agents are concentrated — which a list cannot show at all.
//
// The outline uses `<details>`, not a state hook. Native disclosure is
// keyboard-operable, announced correctly by a screen reader, and survives
// having no JavaScript — three things a `useState` chevron has to reimplement
// and usually gets two of.

import Link from 'next/link';
import { Avatar, SectionLabel } from '@/components/vuno/primitives';
import type { DepartmentNode, OrgMember, OrgTree } from '@/lib/members/org-tree';
import { roleLabel } from '@/lib/members';
import { cn } from '@/lib/utils';

export function OrgView({ tree }: { tree: OrgTree }) {
  const { departments, unassigned, totals } = tree;

  return (
    <>
      <p className="mb-2 max-w-[62ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
        {totals.departments} {totals.departments === 1 ? 'department' : 'departments'}, {totals.teams}{' '}
        {totals.teams === 1 ? 'team' : 'teams'}, {totals.people} {totals.people === 1 ? 'person' : 'people'} and{' '}
        {totals.agents} {totals.agents === 1 ? 'agent' : 'agents'} — on the same teams, in the same seats.
      </p>

      <OrgGraph tree={tree} />

      <SectionLabel count={departments.length}>Departments</SectionLabel>
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {departments.map((d, i) => (
          <Department key={d.id} department={d} first={i === 0} />
        ))}
        {departments.length === 0 ? (
          <p className="px-4 py-8 text-center text-[11.5px] text-[var(--fg-4)]">No departments yet.</p>
        ) : null}
      </div>

      {unassigned.length > 0 ? (
        <>
          <SectionLabel count={unassigned.length}>Not on a team</SectionLabel>
          <ul className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            {unassigned.map((m) => (
              <li key={m.id} className="border-b border-[var(--line)] last:border-b-0">
                <MemberRow member={m} />
              </li>
            ))}
          </ul>
          <p className="mt-1.5 max-w-[62ch] text-[11px] leading-[1.5] text-[var(--fg-4)]">
            Hired and not placed. They can still be mentioned and still hold skills — a seat is how work reaches
            them, not whether they exist.
          </p>
        </>
      ) : null}
    </>
  );
}

function Department({ department: d, first }: { department: DepartmentNode; first: boolean }) {
  const total = d.headcount.people + d.headcount.agents;
  return (
    <details open={first} className="border-b border-[var(--line)] last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
        <Chevron />
        <span className="text-[13px] font-semibold tracking-[-0.008em]">{d.name}</span>
        <span className="tnum text-[11px] text-[var(--fg-4)]">
          {d.teams.length} {d.teams.length === 1 ? 'team' : 'teams'} · {total}
        </span>
        <Split people={d.headcount.people} agents={d.headcount.agents} className="ml-auto" />
      </summary>

      <div className="border-t border-[var(--line)] bg-[var(--sunken)] px-4 py-1.5">
        {d.teams.map((t) => (
          <details key={t.id} open className="py-0.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
              <Chevron small />
              <span className="text-[12px] font-medium text-[var(--fg-2)]">{t.name}</span>
              <span className="tnum text-[10.5px] text-[var(--fg-4)]">{t.members.length}</span>
              {t.lead ? (
                <span className="text-[10.5px] text-[var(--fg-4)]">led by {t.lead.displayName}</span>
              ) : null}
            </summary>
            <ul className="ml-3 border-l border-[var(--line)] pl-2">
              {t.members.map((m) => (
                <li key={m.id}>
                  <MemberRow member={m} dense />
                </li>
              ))}
              {t.members.length === 0 ? (
                <li className="px-2 py-1.5 text-[11px] text-[var(--fg-4)]">Nobody on this team yet</li>
              ) : null}
            </ul>
          </details>
        ))}
        {d.teams.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-[var(--fg-4)]">No teams in this department yet.</p>
        ) : null}
      </div>
    </details>
  );
}

function MemberRow({ member: m, dense }: { member: OrgMember; dense?: boolean }) {
  return (
    <Link
      href={`/members?q=${encodeURIComponent(m.handle)}`}
      className={cn(
        'flex items-center gap-2 rounded transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]',
        dense ? 'px-2 py-1' : 'px-4 py-2',
      )}
    >
      <Avatar name={m.displayName} kind={m.kind} size={dense ? 'xs' : 'sm'} presence={m.presenceState} />
      <span className={cn('truncate font-medium text-[var(--fg)]', dense ? 'text-[11.5px]' : 'text-[12.5px]')}>
        {m.displayName}
      </span>
      <span className="truncate font-mono text-[10.5px] text-[var(--fg-4)]">@{m.handle}</span>
      {m.ownerName ? (
        <Chip>{m.ownerName}&rsquo;s assistant</Chip>
      ) : m.role ? (
        <Chip>{roleLabel(m.role)}</Chip>
      ) : null}
      {m.teamRoleLabel && m.teamRole !== 'MEMBER' ? <Chip>{m.teamRoleLabel}</Chip> : null}
    </Link>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1 py-px text-[10px] text-[var(--fg-3)]">
      {children}
    </span>
  );
}

/**
 * People and agents in one bar.
 *
 * The only number this product is really about. A department that is nine
 * agents and one person is a different thing from one that is the reverse, and
 * a headcount of ten says neither.
 */
function Split({ people, agents, className }: { people: number; agents: number; className?: string }) {
  const total = people + agents;
  if (total === 0) return null;
  return (
    <span
      className={cn('flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--sunken)]', className)}
      title={`${people} ${people === 1 ? 'person' : 'people'}, ${agents} ${agents === 1 ? 'agent' : 'agents'}`}
      aria-label={`${people} ${people === 1 ? 'person' : 'people'}, ${agents} ${agents === 1 ? 'agent' : 'agents'}`}
    >
      <span className="h-full bg-[var(--fg-3)]" style={{ width: `${(people / total) * 100}%` }} />
      <span className="h-full bg-[var(--agent-edge)]" style={{ width: `${(agents / total) * 100}%` }} />
    </span>
  );
}

function Chevron({ small }: { small?: boolean }) {
  const s = small ? 11 : 13;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[var(--fg-4)] transition-transform [details[open]>summary_&]:rotate-90"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ─── The graph ───────────────────────────────────────────────────────────────

const ROW = 34;
/** Where a department's name ends. Right-aligned to it, so nothing crosses it. */
const DEPT_X = 190;
/** Where the edge out of a department starts — clear of the label. */
const DEPT_EDGE_X = DEPT_X + 10;
const TEAM_X = 250;
const WIDTH = 720;

/**
 * The org's shape, left to right: the org, its departments, their teams.
 *
 * Deliberately not a general graph layout. The relation here is containment
 * and it is the same at every edge, so the edges carry no labels and the
 * caption says once what they mean. What the picture adds over the outline is
 * proportion — how wide the org is, how much of each team is agents — which is
 * why every team node carries its own split rather than a headcount.
 *
 * Drawn in `currentColor` so it belongs to whichever of the five themes is on;
 * the one saturated colour is the agent teal, which means the same thing here
 * as it does on an avatar.
 */
function OrgGraph({ tree }: { tree: OrgTree }) {
  const rows: Array<{ dept: DepartmentNode; teamIndex: number }> = [];
  for (const dept of tree.departments) {
    if (dept.teams.length === 0) rows.push({ dept, teamIndex: -1 });
    else dept.teams.forEach((_, teamIndex) => rows.push({ dept, teamIndex }));
  }
  if (rows.length === 0) return null;

  const height = rows.length * ROW + 40;
  const midY = height / 2;

  // Where each department's label sits: the middle of its own rows, so the
  // line into it leaves from the name rather than from the first team.
  const deptY = new Map<string, number>();
  for (const dept of tree.departments) {
    const mine = rows.map((r, i) => (r.dept.id === dept.id ? i : -1)).filter((i) => i >= 0);
    deptY.set(dept.id, 26 + (mine[0] + mine[mine.length - 1]) / 2 * ROW + ROW / 2);
  }

  return (
    <figure className="mb-3 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        style={{ width: '100%', maxWidth: `${WIDTH}px`, height: 'auto' }}
        role="img"
        aria-label={`${tree.totals.departments} departments and ${tree.totals.teams} teams, with people and agents on the same teams`}
        className="text-[var(--fg-3)]"
      >
        {/* Org → department */}
        {tree.departments.map((d) => {
          const y = deptY.get(d.id) ?? midY;
          return (
            <path
              key={`o-${d.id}`}
              d={`M 14 ${midY} C 60 ${midY} 60 ${y} 96 ${y}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.45}
            />
          );
        })}
        <circle cx={14} cy={midY} r={4} fill="currentColor" />

        {rows.map((row, i) => {
          const y = 26 + i * ROW + ROW / 2;
          const team = row.teamIndex >= 0 ? row.dept.teams[row.teamIndex] : null;
          const dy = deptY.get(row.dept.id) ?? y;
          const people = team ? team.members.filter((m) => m.kind === 'human').length : 0;
          const agents = team ? team.members.filter((m) => m.kind === 'agent').length : 0;
          const total = people + agents;

          return (
            <g key={`${row.dept.id}-${row.teamIndex}`}>
              {/* Department → team */}
              {team ? (
                <path
                  d={`M ${DEPT_EDGE_X} ${dy} C ${TEAM_X - 30} ${dy} ${TEAM_X - 30} ${y} ${TEAM_X - 8} ${y}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  opacity={0.35}
                />
              ) : null}

              {/* The department name, drawn once on its middle row */}
              {Math.abs(dy - y) < 1 ? (
                // Right-aligned so the edge leaving it starts past the last
                // letter. Left-aligned, a long department name sat underneath
                // its own connector and read as struck through.
                <text
                  x={DEPT_X}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[var(--fg)]"
                  fontSize={12}
                  fontWeight={600}
                >
                  {row.dept.name}
                </text>
              ) : null}

              {team ? (
                <>
                  <text x={TEAM_X} y={y + 4} className="fill-[var(--fg-2)]" fontSize={11.5}>
                    {team.name}
                  </text>
                  {/* The split, as a bar rather than a number: proportion is the
                      thing a picture can say and a list cannot. */}
                  {total > 0 ? (
                    <>
                      <rect x={TEAM_X + 150} y={y - 4} width={120} height={8} rx={4} className="fill-[var(--sunken)]" />
                      <rect
                        x={TEAM_X + 150}
                        y={y - 4}
                        width={(people / total) * 120}
                        height={8}
                        rx={4}
                        className="fill-[var(--fg-3)]"
                      />
                      <rect
                        x={TEAM_X + 150 + (people / total) * 120}
                        y={y - 4}
                        width={(agents / total) * 120}
                        height={8}
                        rx={4}
                        className="fill-[var(--agent-edge)]"
                      />
                      <text x={TEAM_X + 282} y={y + 4} className="fill-[var(--fg-4)]" fontSize={10.5}>
                        {people} · {agents}
                      </text>
                    </>
                  ) : (
                    <text x={TEAM_X + 150} y={y + 4} className="fill-[var(--fg-4)]" fontSize={10.5}>
                      empty
                    </text>
                  )}
                  {team.lead ? (
                    <text x={TEAM_X + 330} y={y + 4} className="fill-[var(--fg-4)]" fontSize={10.5}>
                      {team.lead.displayName}
                    </text>
                  ) : null}
                </>
              ) : (
                <text x={TEAM_X} y={y + 4} className="fill-[var(--fg-4)]" fontSize={11}>
                  no teams
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--fg-4)]">
        <span>Every line is containment: the org holds departments, a department holds teams.</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-full bg-[var(--fg-3)]" aria-hidden />
          people
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-full bg-[var(--agent-edge)]" aria-hidden />
          agents
        </span>
      </figcaption>
    </figure>
  );
}
