// AI Org OS — Ledger view (the distinctive surface)
// Per SCREENS.md §4. Dense table. Filterable by project (dropdown), status (multi-select),
// actor (dropdown). Sorted by updatedAt desc.

'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { ClaimRow, type ClaimRowData } from '@/components/ledger/claim-row';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  Filter,
  Plus,
  X,
} from 'lucide-react';
import type { ClaimStatus } from '@/lib/events/types';
import { motion, AnimatePresence } from 'framer-motion';

interface ClaimsResponse {
  claims: ClaimRowData[];
}

interface AgentsResponse {
  agents: { id: string; name: string; role: string }[];
}

const ALL_STATUSES: ClaimStatus[] = [
  'asserted',
  'believed',
  'tested',
  'falsified',
  'uncertain',
];

export function LedgerView() {
  const {
    ledgerFilters,
    setLedgerFilter,
    toggleLedgerStatus,
    resetLedgerFilters,
    setActiveDecision,
  } = useAppStore();

  const claimsRes = useFetch<ClaimsResponse>('/api/claims');
  const agentsRes = useFetch<AgentsResponse>('/api/agents');

  const claims = claimsRes.data?.claims ?? [];
  const agents = agentsRes.data?.agents ?? [];

  // Build a unique list of project scopes from the claims
  const projectScopes = useMemo(() => {
    const set = new Map<string, { scopeType: string; scopeId: string }>();
    for (const c of claims) {
      set.set(c.scopeId, {
        scopeType: c.scopeType,
        scopeId: c.scopeId,
      });
    }
    return Array.from(set.values());
  }, [claims]);

  // Filter claims client-side based on the active filters
  const filtered = useMemo(() => {
    return claims.filter((c) => {
      if (
        ledgerFilters.status.length > 0 &&
        !ledgerFilters.status.includes(c.status)
      )
        return false;
      if (ledgerFilters.actorId && c.provenanceAgentId !== ledgerFilters.actorId)
        return false;
      if (ledgerFilters.scopeId && c.scopeId !== ledgerFilters.scopeId)
        return false;
      return true;
    });
  }, [claims, ledgerFilters]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" aria-hidden />
          <h1 className="text-base font-semibold leading-none">
            Epistemic Ledger
          </h1>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {claims.length} claims
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Every claim the organization holds. Status + provenance + evidence. The
          source of truth; everything else is a projection.
        </p>
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Filter className="size-3.5 text-muted-foreground" aria-hidden />

        {/* Project (scope) filter */}
        <Select
          value={ledgerFilters.scopeId ?? '__all__'}
          onValueChange={(v) =>
            setLedgerFilter('scopeId', v === '__all__' ? null : v)
          }
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by project">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All scopes</SelectItem>
            {projectScopes.map((s) => (
              <SelectItem key={s.scopeId} value={s.scopeId}>
                <span className="font-mono text-xs">{s.scopeType}</span>
                {' / '}
                <span className="font-mono text-xs">{s.scopeId}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Actor filter */}
        <Select
          value={ledgerFilters.actorId ?? '__all__'}
          onValueChange={(v) =>
            setLedgerFilter('actorId', v === '__all__' ? null : v)
          }
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by actor">
            <SelectValue placeholder="All actors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All actors</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}{' '}
                <span className="text-muted-foreground text-[0.625rem]">
                  ({a.role})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status multi-select */}
        <StatusMultiSelect />

        {(ledgerFilters.status.length > 0 ||
          ledgerFilters.actorId ||
          ledgerFilters.scopeId) ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={resetLedgerFilters}
          >
            <X className="size-3" aria-hidden /> Clear
          </Button>
        ) : null}
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 scrollbar-sleek">
        {claimsRes.loading ? (
          <LedgerSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyLedger />
        ) : (
          <Card className="m-3 gap-0 overflow-hidden py-0">
            {/* Header row (md+ only) */}
            <div className="hidden grid-cols-[1.5rem_1fr_auto_12rem_3rem_3rem] items-center gap-3 border-b bg-muted/40 px-3 py-1.5 text-[0.6875rem] uppercase tracking-widest text-muted-foreground md:grid">
              <span></span>
              <span>Claim</span>
              <span className="text-right">Status</span>
              <span>Provenance</span>
              <span className="text-right">Evid</span>
              <span className="text-right">Con</span>
            </div>
            <ul>
              <AnimatePresence initial={false}>
                {filtered.map((c) => (
                  <motion.div
                    key={c.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ClaimRow
                      claim={c}
                      agents={agents}
                      onOpenDecision={(id) => setActiveDecision(id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        )}
      </ScrollArea>

      {/* Footer summary */}
      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        Showing {filtered.length} of {claims.length} claims · ledger is the
        source of truth
      </footer>
    </div>
  );
}

// ─── Status multi-select popover ─────────────────────────────────────────────
function StatusMultiSelect() {
  const { ledgerFilters, toggleLedgerStatus } = useAppStore();
  const [open, setOpen] = useState(false);
  const count = ledgerFilters.status.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          aria-label="Filter by status"
        >
          <span>Status</span>
          {count > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground">
              {count}
            </span>
          ) : null}
          <Plus className="size-3 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="start">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
            Filter by status
          </Label>
          {ALL_STATUSES.map((s) => (
            <label
              key={s}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent',
              )}
            >
              <Checkbox
                checked={ledgerFilters.status.includes(s)}
                onCheckedChange={() => toggleLedgerStatus(s)}
              />
              <span className="capitalize">{s}</span>
            </label>
          ))}
          {count > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-7 justify-start text-xs"
              onClick={() => {
                for (const s of [...ledgerFilters.status]) {
                  toggleLedgerStatus(s);
                }
              }}
            >
              Clear status filter
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LedgerSkeleton() {
  return (
    <div className="m-3 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function EmptyLedger() {
  return (
    <div className="m-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      <p className="text-base font-medium text-foreground">
        Nothing here yet
      </p>
      <p className="mt-1">
        No claims match the current filters. Try clearing them, or post a
        Proposal from a channel to seed a new claim.
      </p>
    </div>
  );
}

// (no other exports — view is the default)
