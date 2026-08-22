// AI Org OS — Left rail
// Channels list (with unread badge) + agents list (with health dot) + nav buttons
// (Ledger, Agents, File Objective). On mobile, rendered inside a Sheet.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { AgentAvatar } from '@/components/common/agent-avatar';
import {
  Hash,
  BookOpen,
  Users,
  Target,
  PanelLeftClose,
  FileText,
} from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  slug: string;
  topic: string | null;
  teamId: string | null;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  departmentId: string;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  kind: string;
  teamId: string | null;
  status: string;
  modelName: string;
  harnessName: string;
}

interface ChannelsResponse {
  channels: Channel[];
  departments: { id: string; name: string }[];
  teams: Team[];
}

interface AgentsResponse {
  agents: Agent[];
}

export function LeftRail({ onClose }: { onClose?: () => void }) {
  const {
    activeView,
    activeChannelId,
    setView,
    setActiveChannel,
    setFileObjectiveOpen,
  } = useAppStore();

  const channelsRes = useFetch<ChannelsResponse>('/api/channels');
  const agentsRes = useFetch<AgentsResponse>('/api/agents');

  const teams = channelsRes.data?.teams ?? [];
  const channels = channelsRes.data?.channels ?? [];
  const agents = agentsRes.data?.agents ?? [];

  const teamById = new Map(teams.map((t) => [t.id, t]));

  return (
    <div className="bg-sidebar flex h-full w-64 flex-col gap-4 border-r">
      {/* Header (mobile only — close button) */}
      {onClose ? (
        <div className="flex items-center justify-between border-b p-3 md:hidden">
          <span className="text-sm font-medium">Navigation</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      ) : null}

      <ScrollArea className="flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-6 p-3">
          {/* Channels */}
          <section aria-label="Channels">
            <div className="mb-1 flex items-center justify-between px-2">
              <h3 className="text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Channels
              </h3>
            </div>
            <ul className="flex flex-col gap-0.5">
              {channelsRes.loading ? (
                <li className="px-2 py-1 text-sm text-muted-foreground">
                  Loading…
                </li>
              ) : channels.length === 0 ? (
                <li className="px-2 py-1 text-sm text-muted-foreground">
                  No channels
                </li>
              ) : (
                channels.map((c) => {
                  const isActive =
                    activeChannelId === c.id && activeView === 'chat';
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChannel(c.id);
                          onClose?.();
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <Hash
                          className="size-3.5 opacity-60"
                          aria-hidden
                        />
                        <span className="truncate">{c.name}</span>
                        {c.teamId && teamById.get(c.teamId) ? (
                          <span className="ml-auto text-[0.625rem] text-muted-foreground">
                            {teamById.get(c.teamId)?.name ?? ''}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          {/* Agents */}
          <section aria-label="Agents">
            <div className="mb-1 flex items-center justify-between px-2">
              <h3 className="text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Agents
              </h3>
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-[0.625rem] font-medium"
              >
                {agents.length}
              </Badge>
            </div>
            <ul className="flex flex-col gap-0.5">
              {agentsRes.loading ? (
                <li className="px-2 py-1 text-sm text-muted-foreground">
                  Loading…
                </li>
              ) : agents.length === 0 ? (
                <li className="px-2 py-1 text-sm text-muted-foreground">
                  No agents
                </li>
              ) : (
                agents.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setView('agents');
                        onClose?.();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    >
                      <AgentAvatar
                        name={a.name}
                        role={a.role}
                        size="sm"
                        health={a.status === 'active' ? 'ok' : 'warn'}
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="ml-auto text-[0.625rem] text-muted-foreground">
                        {a.role}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      </ScrollArea>

      {/* Bottom nav buttons */}
      <nav
        className="flex flex-col gap-1 border-t p-3"
        aria-label="App navigation"
      >
        <Button
          variant={activeView === 'ledger' ? 'secondary' : 'ghost'}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            setView('ledger');
            onClose?.();
          }}
        >
          <BookOpen className="size-4" aria-hidden />
          Epistemic Ledger
        </Button>
        <Button
          variant={activeView === 'wiki' ? 'secondary' : 'ghost'}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            setView('wiki');
            onClose?.();
          }}
        >
          <FileText className="size-4" aria-hidden />
          Project Wiki
        </Button>
        <Button
          variant={activeView === 'agents' ? 'secondary' : 'ghost'}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            setView('agents');
            onClose?.();
          }}
        >
          <Users className="size-4" aria-hidden />
          Agents
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            setFileObjectiveOpen(true);
            onClose?.();
          }}
        >
          <Target className="size-4" aria-hidden />
          File Objective
        </Button>
      </nav>
    </div>
  );
}
