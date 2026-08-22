// Vuno — Org panel (left rail, second tab)
// Per the user's direction: org-level alignment with org/department/teams.
// Shows the org tree (org → departments → teams → channels) and a full
// members roster (all humans + agents). This is where agents live, NOT in the
// chat list.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { MemberAvatar, MemberBadge, type MemberKind } from '@/components/common/agent-avatar';
import { Hash, Building2, ChevronRight, Search, Users, UserCircle2 } from 'lucide-react';
import { useState, useMemo } from 'react';

interface Agent {
  id: string;
  name: string;
  role: string;
  kind: string;
  teamId: string | null;
  status: string;
  ownerHumanId: string | null;
}

interface User {
  id: string;
  name: string | null;
  email: string;
  isOrgOwner: boolean;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  departmentId: string;
}

interface Department {
  id: string;
  name: string;
  slug: string;
}

interface Channel {
  id: string;
  name: string;
  slug: string;
  topic: string | null;
  teamId: string | null;
}

interface OrgData {
  org: { id: string; name: string } | null;
  departments: Department[];
  teams: Team[];
  channels: Channel[];
}

const ROLE_LABELS: Record<string, string> = {
  architect: 'Distributed Systems Architect',
  engineer: 'Software Engineer',
  security: 'Security Architect',
  perf: 'Performance Engineer',
  qa: 'QA Engineer',
  devils_advocate: "Devil's Advocate",
  verifier: 'Verifier',
  product: 'Product Lead',
  research: 'Researcher',
  hr: 'HR / Meta',
};

export function OrgPanel({ onClose }: { onClose?: () => void }) {
  const { activeChannelId, setActiveChannel, setView, setInstallAgentOpen } = useAppStore();
  const [search, setSearch] = useState('');
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const orgRes = useFetch<OrgData>('/api/channels');
  const agentsRes = useFetch<{ agents: Agent[] }>('/api/agents');
  const usersRes = useFetch<{ users: User[] }>('/api/users');

  const org = orgRes.data?.org ?? null;
  const departments = orgRes.data?.departments ?? [];
  const teams = orgRes.data?.teams ?? [];
  const channels = orgRes.data?.channels ?? [];
  const agents = agentsRes.data?.agents ?? [];
  const users = usersRes.data?.users ?? [];

  // Team lookups
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const deptById = new Map(departments.map((d) => [d.id, d]));

  // Members: combine users + agents, filter by search
  const allMembers = useMemo(() => {
    const userMembers = users.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      kind: 'human' as MemberKind,
      role: u.isOrgOwner ? 'CEO' : undefined,
      teamId: null,
      status: 'active',
      ownerName: undefined,
    }));
    const agentMembers = agents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: (a.kind === 'personal_assistant' ? 'personal_assistant' : 'independent') as MemberKind,
      role: a.role,
      teamId: a.teamId,
      status: a.status,
      ownerName: a.ownerHumanId
        ? users.find((u) => u.id === a.ownerHumanId)?.name ?? users.find((u) => u.id === a.ownerHumanId)?.email
        : undefined,
    }));
    return [...userMembers, ...agentMembers].sort((a, b) => a.name.localeCompare(b.name));
  }, [users, agents]);

  const filteredMembers = allMembers.filter((m) => {
    if (!search) return true;
    return m.name.toLowerCase().includes(search.toLowerCase());
  });

  function toggleDept(id: string) {
    setExpandedDepts((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTeam(id: string) {
    setExpandedTeams((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-4 p-2">
          {/* Org tree — correct hierarchy: org → leadership → departments → teams → channels */}
          <section aria-label="Organization">
            <div className="mb-1 flex items-center gap-1.5 px-2">
              <Building2 className="size-3 text-muted-foreground" aria-hidden />
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Organization
              </h3>
            </div>
            <div className="flex flex-col gap-0.5">
              {/* Org root — with type tag */}
              <div className="flex items-center gap-1.5 px-2 py-1 text-sm font-medium">
                <Building2 className="size-3.5 text-primary" aria-hidden />
                <span>{org?.name ?? 'Org'}</span>
                <span className="rounded bg-primary/10 px-1 py-0 text-[0.5625rem] font-medium leading-none text-primary">org</span>
              </div>

              {/* Leadership — CEO and higher-level officials shown separately */}
              {users.filter((u) => u.isOrgOwner).length > 0 ? (
                <div className="ml-3 flex flex-col border-l border-border/40 pl-2">
                  <div className="px-2 py-0.5 text-[0.5625rem] uppercase tracking-widest text-muted-foreground/70">
                    Leadership
                  </div>
                  {users.filter((u) => u.isOrgOwner).map((u) => (
                    <div key={u.id} className="flex items-center gap-1.5 px-2 py-1 text-sm">
                      <MemberAvatar name={u.name ?? u.email} kind="human" size="sm" />
                      <span className="truncate">{u.name ?? u.email}</span>
                      <span className="rounded bg-muted px-1 py-0 text-[0.5625rem] font-medium leading-none text-muted-foreground">CEO</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Departments — with type tag */}
              {departments.map((dept) => {
                const deptTeams = teams.filter((t) => t.departmentId === dept.id);
                const isExpanded = expandedDepts.has(dept.id);
                return (
                  <div key={dept.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleDept(dept.id)}
                      className="flex items-center gap-1.5 px-2 py-1 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/40"
                    >
                      <ChevronRight className={cn('size-3 transition-transform', isExpanded && 'rotate-90')} aria-hidden />
                      <span className="font-medium">{dept.name}</span>
                      <span className="rounded bg-muted px-1 py-0 text-[0.5625rem] font-medium leading-none text-muted-foreground">dept</span>
                      <span className="ml-auto text-[0.625rem] text-muted-foreground">
                        {deptTeams.length} {deptTeams.length === 1 ? 'team' : 'teams'}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="ml-3 flex flex-col border-l border-border/40 pl-2">
                        {deptTeams.map((t) => {
                          const teamChannels = channels.filter((c) => c.teamId === t.id);
                          const teamExpanded = expandedTeams.has(t.id);
                          return (
                            <div key={t.id} className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => toggleTeam(t.id)}
                                className="flex items-center gap-1.5 px-2 py-1 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/40"
                              >
                                <ChevronRight
                                  className={cn('size-3 transition-transform', teamExpanded && 'rotate-90')}
                                  aria-hidden
                                />
                                <span>{t.name}</span>
                                <span className="rounded bg-muted px-1 py-0 text-[0.5625rem] font-medium leading-none text-muted-foreground">team</span>
                                <span className="ml-auto text-[0.625rem] text-muted-foreground">
                                  {teamChannels.length} {teamChannels.length === 1 ? 'channel' : 'channels'}
                                </span>
                              </button>
                              {teamExpanded ? (
                                <div className="ml-3 flex flex-col border-l border-border/40 pl-2">
                                  {/* Team channels */}
                                  {teamChannels.length > 0 ? (
                                    <div className="flex flex-col">
                                      <div className="px-2 py-0.5 text-[0.5625rem] uppercase tracking-widest text-muted-foreground/70">
                                        Channels
                                      </div>
                                      <ul className="flex flex-col">
                                        {teamChannels.map((c) => {
                                          const isActive = activeChannelId === c.id;
                                          return (
                                            <li key={c.id}>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setActiveChannel(c.id);
                                                  onClose?.();
                                                }}
                                                className={cn(
                                                  'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
                                                  isActive
                                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/40',
                                                )}
                                              >
                                                <Hash className="size-3 opacity-60" aria-hidden />
                                                <span className="truncate">{c.name}</span>
                                              </button>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {/* Team members */}
                                  <div className="mt-1 flex flex-col">
                                    <div className="px-2 py-0.5 text-[0.5625rem] uppercase tracking-widest text-muted-foreground/70">
                                      Members
                                    </div>
                                    <ul className="flex flex-col">
                                      {allMembers
                                        .filter((m) => {
                                          // CEO and higher-level officials are shown in the Leadership
                                          // section, NOT under each team. Only show agents whose
                                          // teamId matches this team.
                                          if (m.kind === 'human') return false;
                                          const agent = agents.find((a) => a.id === m.id);
                                          return agent?.teamId === t.id;
                                        })
                                        .map((m) => (
                                          <li key={m.id}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                // Open the team's first channel for v1
                                                const firstChannel = channels.find((c) => c.teamId === t.id);
                                                if (firstChannel) setActiveChannel(firstChannel.id);
                                                onClose?.();
                                              }}
                                              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-sidebar-accent/40"
                                            >
                                              <MemberAvatar
                                                name={m.name}
                                                kind={m.kind}
                                                size="sm"
                                                health={m.status === 'active' ? 'ok' : 'warn'}
                                              />
                                              <div className="flex min-w-0 flex-1 flex-col">
                                                <div className="flex items-center gap-1">
                                                  <span className="truncate text-xs font-medium leading-none">{m.name}</span>
                                                  {m.kind !== 'human' ? (
                                                    <MemberBadge kind={m.kind} ownerName={m.ownerName} />
                                                  ) : null}
                                                </div>
                                              </div>
                                            </button>
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Members */}
          <section aria-label="Members">
            <div className="mb-1 flex items-center justify-between px-2">
              <div className="flex items-center gap-1.5">
                <Users className="size-3 text-muted-foreground" aria-hidden />
                <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Members
                </h3>
              </div>
              <span className="text-[0.625rem] text-muted-foreground">{filteredMembers.length}</span>
            </div>
            <div className="mb-1 px-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search members…"
                  className="h-7 pl-6 text-xs"
                />
              </div>
            </div>
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto scrollbar-sleek">
              {filteredMembers.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Open the first channel for v1 (DM routing is a later slice)
                      const firstChannel = channels[0];
                      if (firstChannel) setActiveChannel(firstChannel.id);
                      onClose?.();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/40"
                  >
                    <MemberAvatar
                      name={m.name}
                      kind={m.kind}
                      size="sm"
                      health={m.status === 'active' ? 'ok' : 'warn'}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium leading-none">{m.name}</span>
                        {m.kind !== 'human' ? (
                          <MemberBadge kind={m.kind} ownerName={m.ownerName} />
                        ) : null}
                      </div>
                      <span className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                        {m.kind === 'human'
                          ? m.role ?? 'Member'
                          : ROLE_LABELS[m.role ?? ''] ?? m.role}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </ScrollArea>

      {/* Install agent button at bottom */}
      <div className="border-t border-border/40 p-2">
        <button
          type="button"
          onClick={() => {
            setInstallAgentOpen(true);
            onClose?.();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
        >
          <UserCircle2 className="size-3.5" aria-hidden />
          Install agent
        </button>
      </div>
    </div>
  );
}
