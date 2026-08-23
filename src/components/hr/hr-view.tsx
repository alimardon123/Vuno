// Vuno — HR / Meta dashboard
// Per the vision doc §5: "HR agents are ordinary agents whose work objects
// happen to be agents and teams. They read the ledger, file proposals, and
// pass through the same debate and gates as any other work."
//
// This view visualizes the org evaluating itself:
// - Objection precision per agent (what fraction of objections were validated)
// - Proposal survival rate per agent (what fraction of proposals weren't falsified)
// - Claim status distribution (donut)
// - Gate evaluation summary
// - Event-type histogram (what the org has been doing)
// - Per-agent activity table with all the metrics
//
// Pure projection of /api/hr-metrics — no separate metrics table.

'use client';

import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { StatusPill } from '@/components/common/status-pill';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
} from 'recharts';
import {
  BarChart3,
  Users,
  ShieldCheck,
  Activity,
  Gauge,
  Target,
  AlertTriangle,
  Microscope,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ─── API response types ─────────────────────────────────────────────────────
interface AgentMetric {
  agentId: string;
  agentName: string;
  agentRole: string;
  roleLabel: string;
  teamId: string | null;
  kind: string;
  modelName: string;
  status: string;
  proposalsOpened: number;
  objectionsRaised: number;
  evidenceAttached: number;
  experimentsRequested: number;
  experimentsCompleted: number;
  benchmarksReported: number;
  risksFlagged: number;
  decisionsRecorded: number;
  messagesPosted: number;
  totalActions: number;
  objectionPrecision: number | null;
  proposalSurvivalRate: number | null;
}

interface ClaimStatusCount {
  status: string;
  count: number;
  color: string;
}

interface GateMetric {
  id: string;
  name: string;
  state: string;
  policy: string;
  reason: string | null;
  decisionId: string | null;
}

interface EventTypeCount {
  type: string;
  count: number;
  color: string;
}

interface HrMetricsResponse {
  org: { id: string; name: string } | null;
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
  agentMetrics: AgentMetric[];
  claimStatusDistribution: ClaimStatusCount[];
  gateEvaluations: GateMetric[];
  eventTypeHistogram: EventTypeCount[];
  debateStateDistribution: { state: string; count: number }[];
  generatedAt: string;
}

// ─── Main view ───────────────────────────────────────────────────────────────
export function HRView() {
  const res = useFetch<HrMetricsResponse>('/api/hr-metrics', { intervalMs: 15000 });

  if (res.loading) return <HRSkeleton />;
  if (!res.data || !res.data.org) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-base font-medium">No organization yet</span>
        <p className="text-sm text-muted-foreground">
          The HR dashboard is generated from org-wide metrics. Seed the demo
          org first.
        </p>
      </div>
    );
  }

  const m = res.data;
  const generatedAt = new Date(m.generatedAt);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border/70 px-6 py-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="size-5 text-primary" aria-hidden />
          <div className="flex-1">
            <h1 className="text-xl font-semibold leading-tight tracking-tight">
              HR / Meta Dashboard
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The organization evaluating itself — objection precision,
              proposal survival, gate-block accuracy. Per the vision: HR is
              peer-to-CEO in visibility, subordinate in authority.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">
              <Sparkles className="size-3" aria-hidden />
              Generated from the ledger
            </span>
            <span>
              {m.totals.events} events · updated{' '}
              <time title={generatedAt.toLocaleString()}>
                {formatDistanceToNow(generatedAt, { addSuffix: true })}
              </time>
            </span>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
          {/* KPI tiles */}
          <KPITiles totals={m.totals} />

          {/* Charts grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ObjectionPrecisionChart agents={m.agentMetrics} />
            <ProposalSurvivalChart agents={m.agentMetrics} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ClaimStatusDonut distribution={m.claimStatusDistribution} />
            <EventTypeHistogram histogram={m.eventTypeHistogram} />
          </div>

          {/* Gate evaluations */}
          <GateEvaluations gates={m.gateEvaluations} />

          {/* Agent activity table */}
          <AgentActivityTable agents={m.agentMetrics} />
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── KPI tiles ───────────────────────────────────────────────────────────────
function KPITiles({
  totals,
}: {
  totals: HrMetricsResponse['totals'];
}) {
  const tiles: Array<{
    label: string;
    value: number | string;
    icon: LucideIcon;
    color?: string;
    sub?: string;
  }> = [
    {
      label: 'Active agents',
      value: totals.activeAgents,
      icon: Users,
      color: 'var(--status-believed)',
      sub: `${totals.agents} total`,
    },
    {
      label: 'Total events',
      value: totals.events,
      icon: Activity,
      color: 'var(--status-uncertain)',
      sub: 'on the spine',
    },
    {
      label: 'Claims',
      value: totals.claims,
      icon: Microscope,
      color: 'var(--status-tested)',
      sub: 'in the ledger',
    },
    {
      label: 'Decisions',
      value: totals.decisions,
      icon: Target,
      color: 'var(--status-believed)',
      sub: `${totals.blockedGates} blocked gates`,
    },
    {
      label: 'Open risks',
      value: totals.openRisks,
      icon: AlertTriangle,
      color: totals.openRisks > 0 ? 'var(--status-falsified)' : 'var(--status-tested)',
      sub: totals.openRisks > 0 ? 'needs attention' : 'all clear',
    },
    {
      label: 'Gates passed',
      value: `${totals.passedGates}/${totals.gates}`,
      icon: ShieldCheck,
      color: 'var(--status-tested)',
      sub: `${totals.blockedGates} blocked`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="group flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/40 px-4 py-3 transition-colors hover:border-border hover:bg-card/70"
        >
          <div className="flex items-center justify-between">
            <t.icon
              className="size-4 opacity-70"
              style={{ color: t.color }}
              aria-hidden
            />
          </div>
          <div
            className="font-mono text-2xl font-bold leading-none tabular-nums tracking-tight"
            style={{ color: t.color }}
          >
            {t.value}
          </div>
          <div className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
            {t.label}
          </div>
          {t.sub ? (
            <div className="text-[0.6875rem] text-muted-foreground/80">{t.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ─── Objection precision bar chart ─────────────────────────────────────────
function ObjectionPrecisionChart({ agents }: { agents: AgentMetric[] }) {
  // Only show agents with at least 1 objection
  const data = agents
    .filter((a) => a.objectionsRaised > 0)
    .map((a) => ({
      name: a.agentName,
      role: a.roleLabel,
      precision: a.objectionPrecision ?? 0,
      count: a.objectionsRaised,
    }));

  const chartConfig: ChartConfig = {
    precision: { label: 'Precision', color: 'var(--status-tested)' },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Gauge className="size-4 text-primary" aria-hidden />
          Objection precision
          <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[0.625rem]">
            {data.length} agents
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Fraction of an agent&apos;s objections that were later validated by a
          benchmark or experiment.
        </p>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart label="No objections raised yet." />
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.005 250 / 40%)" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                tick={{ fontSize: 11, fill: 'oklch(0.66 0.01 250)' }}
                stroke="oklch(0.30 0.005 250 / 40%)"
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: 'oklch(0.85 0.005 250)' }}
                stroke="oklch(0.30 0.005 250 / 40%)"
                width={48}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              {/* Background track: shows the 100% potential as a subtle bar so 0% values are visible */}
              <Bar dataKey={() => 1} fill="oklch(0.25 0.005 250 / 40%)" radius={[0, 4, 4, 0]} maxBarSize={24} />
              <Bar dataKey="precision" fill="var(--status-tested)" radius={[0, 4, 4, 0]} maxBarSize={24}>
                <LabelList
                  dataKey="precision"
                  position="right"
                  formatter={(v: number) => `${Math.round(v * 100)}%`}
                  style={{ fontSize: 11, fill: 'oklch(0.85 0.005 250)' }}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Proposal survival rate bar chart ──────────────────────────────────────
function ProposalSurvivalChart({ agents }: { agents: AgentMetric[] }) {
  const data = agents
    .filter((a) => a.proposalsOpened > 0)
    .map((a) => ({
      name: a.agentName,
      role: a.roleLabel,
      survival: a.proposalSurvivalRate ?? 0,
      count: a.proposalsOpened,
    }));

  const chartConfig: ChartConfig = {
    survival: { label: 'Survival', color: 'var(--status-believed)' },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="size-4 text-primary" aria-hidden />
          Proposal survival rate
          <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[0.625rem]">
            {data.length} agents
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Fraction of an agent&apos;s proposals that were NOT later falsified.
        </p>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart label="No proposals opened yet." />
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.005 250 / 40%)" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                tick={{ fontSize: 11, fill: 'oklch(0.66 0.01 250)' }}
                stroke="oklch(0.30 0.005 250 / 40%)"
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: 'oklch(0.85 0.005 250)' }}
                stroke="oklch(0.30 0.005 250 / 40%)"
                width={48}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              {/* Background track: shows the 100% potential as a subtle bar so 0% values are visible */}
              <Bar dataKey={() => 1} fill="oklch(0.25 0.005 250 / 40%)" radius={[0, 4, 4, 0]} maxBarSize={24} />
              <Bar dataKey="survival" fill="var(--status-believed)" radius={[0, 4, 4, 0]} maxBarSize={24}>
                <LabelList
                  dataKey="survival"
                  position="right"
                  formatter={(v: number) => `${Math.round(v * 100)}%`}
                  style={{ fontSize: 11, fill: 'oklch(0.85 0.005 250)' }}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Claim status donut ─────────────────────────────────────────────────────
function ClaimStatusDonut({
  distribution,
}: {
  distribution: ClaimStatusCount[];
}) {
  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  const data = distribution.map((d) => ({
    name: d.status,
    value: d.count,
    fill: d.color,
  }));

  const chartConfig: ChartConfig = distribution.reduce((acc, d) => {
    acc[d.status] = { label: d.status, color: d.color };
    return acc;
  }, {} as ChartConfig);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Microscope className="size-4 text-primary" aria-hidden />
          Claim status distribution
          <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[0.625rem]">
            {total} total
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every claim in the ledger, grouped by epistemic status.
        </p>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyChart label="No claims in the ledger." />
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative">
              <ChartContainer config={chartConfig} className="mx-auto h-[200px] w-[200px]">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              {/* Center label in the donut hole */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-bold leading-none text-foreground tabular-nums">
                  {total}
                </span>
                <span className="mt-1 text-[0.625rem] uppercase tracking-widest text-muted-foreground">
                  {total === 1 ? 'claim' : 'claims'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {distribution.map((d) => (
                <div key={d.status} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-3 rounded-sm"
                    style={{ backgroundColor: d.color }}
                    aria-hidden
                  />
                  <span className="text-foreground/80">{d.status}</span>
                  <span className="ml-auto font-mono font-semibold text-foreground">
                    {d.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Event-type histogram ──────────────────────────────────────────────────
function EventTypeHistogram({
  histogram,
}: {
  histogram: EventTypeCount[];
}) {
  const chartConfig: ChartConfig = histogram.reduce((acc, h) => {
    acc[h.type] = { label: h.type, color: h.color };
    return acc;
  }, {} as ChartConfig);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4 text-primary" aria-hidden />
          Event-type histogram
          <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[0.625rem]">
            {histogram.length} types
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          What the organization has been doing — counted from the event spine.
        </p>
      </CardHeader>
      <CardContent>
        {histogram.length === 0 ? (
          <EmptyChart label="No events yet." />
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart data={histogram} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.005 250 / 40%)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'oklch(0.66 0.01 250)' }}
                stroke="oklch(0.30 0.005 250 / 40%)"
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="type"
                tick={{ fontSize: 10, fill: 'oklch(0.85 0.005 250)' }}
                stroke="oklch(0.30 0.005 250 / 40%)"
                width={130}
                interval={0}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {histogram.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fontSize: 10, fill: 'oklch(0.85 0.005 250)' }}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Gate evaluations ────────────────────────────────────────────────────────
function GateEvaluations({ gates }: { gates: GateMetric[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Gate evaluations
          <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[0.625rem]">
            {gates.length} gates
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Each gate is a deterministic query over the ledger. {gates.filter((g) => g.state === 'blocked').length}{' '}
          blocked, {gates.filter((g) => g.state === 'passed').length} passed.
        </p>
      </CardHeader>
      <CardContent>
        {gates.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No gates yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {gates.map((g) => (
              <GateRow key={g.id} gate={g} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GateRow({ gate }: { gate: GateMetric }) {
  const stateColor =
    gate.state === 'passed'
      ? 'var(--status-tested)'
      : gate.state === 'blocked'
        ? 'var(--status-falsified)'
        : 'var(--status-uncertain)';
  return (
    <div
      className="flex flex-col gap-1 rounded-md border-l-[3px] bg-card/30 px-3 py-2.5 transition-colors hover:bg-card/60"
      style={{ borderColor: stateColor }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold capitalize">{gate.name} gate</span>
        <StatusPill
          status={
            gate.state === 'passed'
              ? 'passed'
              : gate.state === 'blocked'
                ? 'blocked'
                : 'pending'
          }
          pulse={gate.state === 'blocked'}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        policy: <span className="font-mono text-foreground/80">{gate.policy}</span>
      </div>
      {gate.reason ? (
        <div className="text-xs leading-relaxed text-foreground/80">{gate.reason}</div>
      ) : null}
    </div>
  );
}

// ─── Agent activity table ───────────────────────────────────────────────────
function AgentActivityTable({ agents }: { agents: AgentMetric[] }) {
  const sorted = [...agents].sort((a, b) => b.totalActions - a.totalActions);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="size-4 text-primary" aria-hidden />
          Agent activity &amp; metrics
          <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[0.625rem]">
            {agents.length} agents
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Per-agent counts and derived metrics from the event spine. Sorted by
          total actions.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto scrollbar-sleek">
          <table className="w-full text-sm">
            <thead className="border-y border-border/60 bg-muted/30 text-[0.625rem] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Agent</th>
                <th className="px-3 py-2 text-right font-medium" title="Proposals opened">Prop</th>
                <th className="px-3 py-2 text-right font-medium" title="Objections raised">Obj</th>
                <th className="px-3 py-2 text-right font-medium" title="Evidence attached">Evid</th>
                <th className="px-3 py-2 text-right font-medium" title="Benchmarks reported">Bench</th>
                <th className="px-3 py-2 text-right font-medium" title="Risks flagged">Risk</th>
                <th className="px-3 py-2 text-right font-medium" title="Decisions recorded">Dec</th>
                <th className="px-3 py-2 text-right font-medium" title="Messages posted">Msg</th>
                <th className="px-3 py-2 text-right font-medium" title="Total actions">Total</th>
                <th className="px-3 py-2 text-right font-medium" title="Objection precision (fraction of objections validated)">Obj prec</th>
                <th className="px-3 py-2 text-right font-medium" title="Proposal survival rate (fraction not falsified)">Prop surv</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a, idx) => (
                <tr
                  key={a.agentId}
                  className={cn(
                    'border-b border-border/30 transition-colors hover:bg-accent/50',
                    idx % 2 === 1 && 'bg-muted/20',
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <AgentAvatar name={a.agentName} role={a.agentRole} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium leading-none">
                          {a.agentName}
                        </div>
                        <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                          {a.roleLabel}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/80">
                    {a.proposalsOpened}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/80">
                    {a.objectionsRaised}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/80">
                    {a.evidenceAttached}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/80">
                    {a.benchmarksReported}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/80">
                    {a.risksFlagged}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/80">
                    {a.decisionsRecorded}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {a.messagesPosted}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
                    {a.totalActions}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {a.objectionPrecision === null ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      <span
                        style={{
                          color:
                            a.objectionPrecision >= 0.8
                              ? 'var(--status-tested)'
                              : a.objectionPrecision >= 0.5
                                ? 'var(--status-asserted)'
                                : 'var(--status-falsified)',
                        }}
                      >
                        {Math.round(a.objectionPrecision * 100)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {a.proposalSurvivalRate === null ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      <span
                        style={{
                          color:
                            a.proposalSurvivalRate >= 0.8
                              ? 'var(--status-tested)'
                              : a.proposalSurvivalRate >= 0.5
                                ? 'var(--status-asserted)'
                                : 'var(--status-falsified)',
                        }}
                      >
                        {Math.round(a.proposalSurvivalRate * 100)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-md border border-dashed border-border/60 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function HRSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}
