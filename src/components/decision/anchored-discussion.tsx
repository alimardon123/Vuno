// Vuno — Anchored discussion
// Discussion timeline scoped to this decision: ProposalOpened, ObjectionRaised,
// ExperimentRequested, ExperimentCompleted, BenchmarkReported, DecisionRecorded,
// ClaimStatusChanged, RoleAssigned, etc.

'use client';

import { useMemo } from 'react';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { useFetch } from '@/hooks/use-fetch';
import { format, formatDistanceToNow } from 'date-fns';
import type { ChatMessageProjection } from '@/lib/events/project';
import type { EventRecord, EventPayloadMap } from '@/lib/events/types';
import { projectChatMessages } from '@/lib/events/project';
import { MessageBubble } from '@/components/chat/message-bubble';
import { Skeleton } from '@/components/ui/skeleton';

interface AgentsResponse {
  agents: {
    id: string;
    name: string;
    role: string;
    status: string;
    avatarGlyph?: string | null;
  }[];
}

interface AnchoredDiscussionProps {
  events: EventRecord[];
  loading?: boolean;
}

export function AnchoredDiscussion({
  events,
  loading,
}: AnchoredDiscussionProps) {
  // Project to chat messages, then re-render using MessageBubble.
  const messages: ChatMessageProjection[] = useMemo(
    () => projectChatMessages(events),
    [events],
  );

  const agentsRes = useFetch<AgentsResponse>('/api/agents');
  const agents = agentsRes.data?.agents ?? [];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No discussion events yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 py-2">
      {messages.map((m) => {
        // For "anchored" hints — if this is an ObjectionRaised or BenchmarkReported
        // in a debate, prefix it with a quote of the section it's anchored to.
        const anchor = anchorText(m);
        return (
          <div key={m.id} className="flex flex-col gap-0">
            {anchor ? (
              <div className="ml-3 mt-2 border-l-2 border-muted pl-2 text-xs italic text-muted-foreground">
                &gt; On “{anchor}”
              </div>
            ) : null}
            <MessageBubble message={m} />
          </div>
        );
      })}
      {/* Hint agentById is used implicitly via MessageBubble; keeps agents refetched */}
      <span className="sr-only">{agentById.size} agents</span>
    </div>
  );
}

// Derive a small "anchored quote" per message — for v1 this is best-effort
// from the payload (e.g. the claim text of an objection).
function anchorText(m: ChatMessageProjection): string | null {
  const p = m.payload as
    | (EventPayloadMap[keyof EventPayloadMap] & {
        claimText?: string;
        metric?: string;
        kind?: string;
        purpose?: string;
      })
    | null;
  if (!p) return null;
  if (m.type === 'ObjectionRaised' && p.claimText) {
    return p.claimText.slice(0, 60);
  }
  if (m.type === 'ExperimentRequested' && p.purpose) {
    return p.purpose.slice(0, 60);
  }
  if (m.type === 'BenchmarkReported' && p.metric) {
    return p.metric;
  }
  return null;
}

// Re-export type for downstream importers
export type { EventRecord };
