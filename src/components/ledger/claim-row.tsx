// AI Org OS — Claim row (ledger)
// Each row: claim statement / status pill / provenance / evidence count / contradicts count.
// Filterable; row expands to show provenance chain.

'use client';

import { useState } from 'react';
import { StatusPill } from '@/components/common/status-pill';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { ROLE_LABELS } from '@/lib/agents/types';
import { ChevronDown, ChevronRight, Link2, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import type { ClaimStatus } from '@/lib/events/types';
import { cn } from '@/lib/utils';

interface AgentsResponse {
  agents: {
    id: string;
    name: string;
    role: string;
    status: string;
  }[];
}

export interface ClaimRowData {
  id: string;
  statement: string;
  status: ClaimStatus;
  scopeType: string;
  scopeId: string;
  provenanceEventId: string;
  provenanceActorType: string;
  provenanceAgentId?: string | null;
  evidenceIds: string[];
  contradictsIds: string[];
  statusReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClaimRowProps {
  claim: ClaimRowData;
  agents: AgentsResponse['agents'];
  onOpenDecision?: (id: string) => void;
}

export function ClaimRow({ claim, agents, onOpenDecision }: ClaimRowProps) {
  const [expanded, setExpanded] = useState(false);
  const agent = claim.provenanceAgentId
    ? agents.find((a) => a.id === claim.provenanceAgentId)
    : null;

  // If the claim scope is a decision, allow click-through to the decision page
  const decisionScope = claim.scopeType === 'decision';

  return (
    <li
      className={cn(
        'border-b transition-colors last:border-b-0',
        'hover:bg-accent/30',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
        aria-expanded={expanded}
      >
        {/* Chevron */}
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </span>

        {/* Statement */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[0.625rem] text-muted-foreground">
              {claim.id.slice(0, 22)}
            </span>
            <span className="text-[0.625rem] text-muted-foreground">
              · {format(new Date(claim.updatedAt), 'PP')}
            </span>
          </div>
          <p className="mt-0.5 text-sm leading-snug text-foreground">
            {claim.statement}
          </p>
        </div>

        {/* Status pill */}
        <div className="shrink-0">
          <StatusPill status={claim.status} />
        </div>

        {/* Provenance */}
        <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground md:flex md:w-48">
          {agent ? (
            <>
              <AgentAvatar
                name={agent.name}
                role={agent.role}
                size="sm"
              />
              <div className="flex flex-col leading-tight">
                <span className="truncate font-medium text-foreground">
                  {agent.name}
                </span>
                <span className="text-[0.625rem]">
                  {ROLE_LABELS[agent.role] ?? agent.role}
                </span>
              </div>
            </>
          ) : (
            <span className="italic">{claim.provenanceActorType}</span>
          )}
        </div>

        {/* Evidence count */}
        <div className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex md:w-12 md:justify-end">
          <FileText className="size-3" aria-hidden />
          <span className="font-mono">{claim.evidenceIds.length}</span>
        </div>

        {/* Contradicts count */}
        <div className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex md:w-12 md:justify-end">
          <Link2 className="size-3" aria-hidden />
          <span className="font-mono">{claim.contradictsIds.length}</span>
        </div>
      </button>

      {/* Expanded panel */}
      {expanded ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden border-t bg-muted/30 px-3 py-3"
        >
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div>
              <div className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
                Provenance
              </div>
              <div className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
                event: {claim.provenanceEventId.slice(0, 22)}
              </div>
              <div className="font-mono text-[0.6875rem] text-muted-foreground">
                actor: {claim.provenanceActorType}
                {agent ? ` (${agent.name})` : ''}
              </div>
              <div className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
                scope: {claim.scopeType}/{claim.scopeId}
              </div>
            </div>

            <div>
              <div className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
                Status reason
              </div>
              <div className="mt-1 text-foreground">
                {claim.statusReason ?? '—'}
              </div>
              <div className="mt-2 text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
                Evidence ({claim.evidenceIds.length})
              </div>
              <ul className="mt-0.5 flex flex-col gap-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                {claim.evidenceIds.length === 0 ? (
                  <li className="italic">no evidence</li>
                ) : (
                  claim.evidenceIds.map((id) => (
                    <li key={id} className="truncate">{id}</li>
                  ))
                )}
              </ul>
              {claim.contradictsIds.length > 0 ? (
                <>
                  <div className="mt-2 text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
                    Contradicts ({claim.contradictsIds.length})
                  </div>
                  <ul className="mt-0.5 flex flex-col gap-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                    {claim.contradictsIds.map((id) => (
                      <li key={id} className="truncate">{id}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>

          {decisionScope && onOpenDecision ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => onOpenDecision(claim.scopeId)}
                className="text-xs text-primary hover:underline"
              >
                Open decision {claim.scopeId} →
              </button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </li>
  );
}
