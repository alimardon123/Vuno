// Vuno — Agent card
// Per SCREENS.md §5: avatar (lucide icon by role), name, role label, model/harness mono,
// team name, status badge, green health dot.

'use client';

import { AgentAvatar } from '@/components/common/agent-avatar';
import { StatusPill } from '@/components/common/status-pill';
import { Card, CardContent } from '@/components/ui/card';
import { ROLE_LABELS } from '@/lib/agents/types';

interface Agent {
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
}

interface TeamsResponse {
  teams: { id: string; name: string }[];
}

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Card className="gap-3 py-4 transition-colors hover:bg-accent/30">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex items-center gap-3">
          <AgentAvatar
            name={agent.name}
            role={agent.role}
            size="lg"
            health={agent.status === 'active' ? 'ok' : 'warn'}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="truncate text-base font-semibold leading-tight">
              {agent.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {ROLE_LABELS[agent.role] ?? agent.role}
            </div>
            <div className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
              {agent.modelName} / {agent.harnessName}
            </div>
          </div>
          <div className="shrink-0">
            <StatusPill
              status={agent.status === 'active' ? 'passed' : 'uncertain'}
              label={agent.status}
              withGlyph={false}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
          <span>
            kind:{' '}
            <span className="font-mono text-foreground">
              {agent.kind === 'personal_assistant'
                ? 'personal-assistant'
                : 'independent'}
            </span>
          </span>
          <span>·</span>
          <span>
            team:{' '}
            <span className="font-mono text-foreground">
              {agent.teamId ?? 'unassigned'}
            </span>
          </span>
          <span>·</span>
          <span>
            tools:{' '}
            <span className="font-mono text-foreground">
              {agent.tools.length}
            </span>
          </span>
          <span>·</span>
          <span>
            permissions:{' '}
            <span className="font-mono text-foreground">
              {agent.permissions.length}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Re-export for downstream
export type { Agent };
export type { TeamsResponse };
