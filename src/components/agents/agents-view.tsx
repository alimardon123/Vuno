// Vuno — Agents view
// Per SCREENS.md §5: grid of agent cards. "+ Install Agent" button at top.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { AgentCard } from '@/components/agents/agent-card';
import { InstallAgentDialog } from '@/components/agents/install-agent-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Users, UserPlus } from 'lucide-react';

interface AgentsResponse {
  agents: {
    id: string;
    name: string;
    role: string;
    kind: string;
    modelName: string;
    harnessName: string;
    tools: string[];
    permissions: string[];
    teamId: string | null;
    status: string;
    installedAt: string;
  }[];
}

export function AgentsView() {
  const { setInstallAgentOpen } = useAppStore();
  const agentsRes = useFetch<AgentsResponse>('/api/agents', {
    intervalMs: 5000,
  });

  const agents = agentsRes.data?.agents ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Users className="size-4 text-muted-foreground" aria-hidden />
        <h1 className="text-base font-semibold leading-none">Agents</h1>
        <span className="text-xs text-muted-foreground">
          {agents.length} active
        </span>
        <Button
          variant="default"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => setInstallAgentOpen(true)}
        >
          <UserPlus className="size-3.5" aria-hidden />
          Install Agent
        </Button>
      </header>

      <ScrollArea className="flex-1 scrollbar-sleek">
        {agentsRes.loading ? (
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="m-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p className="text-base font-medium text-foreground">
              No agents yet
            </p>
            <p className="mt-1">
              Install the first agent to start the org. v1 ships simulated
              adapters — the same install/config UI unlocks real models in v2.
            </p>
            <Button
              variant="default"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setInstallAgentOpen(true)}
            >
              <UserPlus className="size-3.5" aria-hidden />
              Install Agent
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        )}
      </ScrollArea>

      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        Click <span className="text-foreground">Install Agent</span> to add a
        new specialized agent. v1 ships simulated harnesses.
      </footer>

      <InstallAgentDialog />
    </div>
  );
}
