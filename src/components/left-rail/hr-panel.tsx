// Vuno — HR panel (left rail, fourth tab — main separate point per user)
// Per the user's direction: "Can you put HR as separate pane left side below too.
// It will be main separate point."
//
// Sections:
// - Quick stats (active agents, open risks, blocked gates)
// - Member roster (compact — links to full HR dashboard)
// - "Open HR dashboard" button → switches to the hr view

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MemberAvatar, MemberBadge, type MemberKind } from '@/components/common/agent-avatar';
import { BarChart3, Users, AlertTriangle, ShieldCheck, ArrowRight, UserPlus } from 'lucide-react';
import { useState } from 'react';

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

interface HrTotals {
  totals: {
    agents: number;
    activeAgents: number;
    claims: number;
    decisions: number;
    gates: number;
    events: number;
    openRisks: number;
    blockedGates: number;
    passedGates: number;
  };
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

export function HrPanel({ onClose }: { onClose?: () => void }) {
  const { setView, setInstallAgentOpen } = useAppStore();
  const [search, setSearch] = useState('');

  const hrRes = useFetch<HrTotals>('/api/hr-metrics');
  const agentsRes = useFetch<{ agents: Agent[] }>('/api/agents');
  const usersRes = useFetch<{ users: User[] }>('/api/users');

  const totals = hrRes.data?.totals;
  const agents = agentsRes.data?.agents ?? [];
  const users = usersRes.data?.users ?? [];

  // Compact member roster — combine users + agents, sorted, filtered
  const allMembers = [
    ...users.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      kind: 'human' as MemberKind,
      role: u.isOrgOwner ? 'CEO' : undefined,
      status: 'active',
      ownerName: undefined,
    })),
    ...agents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: (a.kind === 'personal_assistant' ? 'personal_assistant' : 'independent') as MemberKind,
      role: a.role,
      status: a.status,
      ownerName: a.ownerHumanId
        ? users.find((u) => u.id === a.ownerHumanId)?.name ?? users.find((u) => u.id === a.ownerHumanId)?.email
        : undefined,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const filteredMembers = search
    ? allMembers.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
    : allMembers;

  return (
    <div className="flex h-full flex-col">
      {/* Quick stats */}
      <div className="border-b border-border/40 p-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-2">
          <BarChart3 className="size-3 text-muted-foreground" aria-hidden />
          <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Org health
          </h3>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <StatTile
            icon={Users}
            value={totals?.activeAgents ?? '—'}
            label="agents"
            color="var(--status-believed)"
          />
          <StatTile
            icon={AlertTriangle}
            value={totals?.openRisks ?? '—'}
            label="risks"
            color={totals && totals.openRisks > 0 ? 'var(--status-falsified)' : 'var(--status-tested)'}
          />
          <StatTile
            icon={ShieldCheck}
            value={totals ? `${totals.passedGates}/${totals.gates}` : '—'}
            label="gates"
            color="var(--status-tested)"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-3 p-2">
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
            <ul className="flex flex-col gap-0.5">
              {filteredMembers.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Open the main channel for v1 (DM routing is later)
                      setView('chat');
                      onClose?.();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/50"
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
                        {m.kind !== 'human' ? <MemberBadge kind={m.kind} ownerName={m.ownerName} /> : null}
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

      {/* Footer actions */}
      <div className="flex flex-col gap-1 border-t border-border/40 p-2">
        <Button
          variant="default"
          size="sm"
          className="w-full justify-between gap-2"
          onClick={() => {
            setView('hr');
            onClose?.();
          }}
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="size-3.5" aria-hidden />
            Open HR dashboard
          </span>
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-1.5"
          onClick={() => {
            setInstallAgentOpen(true);
            onClose?.();
          }}
        >
          <UserPlus className="size-3.5" aria-hidden />
          Install agent
        </Button>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: typeof Users;
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-card/40 px-2 py-1.5">
      <Icon className="size-3 opacity-70" style={{ color }} aria-hidden />
      <span className="font-mono text-base font-bold leading-none tabular-nums" style={{ color }}>
        {value}
      </span>
      <span className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );
}
