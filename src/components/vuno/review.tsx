// How the organisation is working. Every number here is a query over the spine
// and the ledger, so each one can be traced back to the events behind it.
//
// The presentation carries one rule: a member without enough history shows
// counts, not a rate. "100%" from a single objection is the kind of number that
// gets someone promoted for having been asked once.

import { Avatar } from '@/components/vuno/primitives';
import { roleLabel } from '@/lib/members';
import type { OrgReview } from '@/lib/review/metrics';
import { ENOUGH_TO_JUDGE } from '@/lib/review/metrics';

export function Review({ review }: { review: OrgReview }) {
  const { escalation, spend, gates, ledger } = review;

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Escalation rate"
          value={escalation.rate === null ? '—' : pct(escalation.rate)}
          detail={`${escalation.parked} of ${escalation.total} objectives waiting on a person`}
          hint="The health metric: if everything escalates, the org has made you the bottleneck it was meant to remove."
          alarming={escalation.rate !== null && escalation.rate > 0.5}
        />
        <Stat
          label="Spent"
          value={money(spend.totalCents)}
          detail={`${spend.runs} run${spend.runs === 1 ? '' : 's'}, ${spend.failedRuns} failed`}
          hint="Every run records what it cost, including the ones that cost nothing."
        />
        <Stat
          label="Gates blocked"
          value={`${gates.blocked} of ${gates.total}`}
          detail="Each one names the claim or risk behind it"
          alarming={gates.blocked > 0}
        />
        <Stat
          label="Unsure"
          value={`${ledger.uncertain} of ${ledger.total}`}
          detail={`${ledger.falsified} falsified`}
          hint="A ledger that can say 'we do not know' is worth more than one that cannot."
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <header className="border-b border-[var(--line)] px-4 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">Per member</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
            Measured on what happened to what they said, not on how much they said. Fewer than {ENOUGH_TO_JUDGE}{' '}
            settled outcomes shows counts rather than a rate.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--line)] text-[10.5px] uppercase tracking-[0.05em] text-[var(--fg-4)]">
                <th className="px-4 py-1.5 text-left font-semibold">Member</th>
                <Th title="Claims they put on the ledger, and where those ended up.">Claims</Th>
                <Th title="Of the claims that were settled either way, the share that survived. A claim nobody tested is not a survival.">Survival</Th>
                <Th title="Objections that became claims, and what happened to those claims.">Objections</Th>
                <Th title="Of the objections that were settled, the share that turned out to be right.">Precision</Th>
                <Th title="Runs the orchestrator recorded for them.">Runs</Th>
                <Th title="What their runs cost.">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {review.members.map((m) => (
                <tr key={m.memberId} className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--hover)]">
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} kind={m.kind} size="xs" />
                      <span className="truncate font-medium">{m.name}</span>
                      {m.role ? (
                        <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">{roleLabel(m.role)}</span>
                      ) : null}
                    </div>
                  </td>
                  <Td>
                    {m.claims.total === 0 ? '—' : m.claims.total}
                    {m.claims.falsified > 0 ? (
                      <span className="ml-1 text-[10.5px] text-[var(--falsified)]">{m.claims.falsified} falsified</span>
                    ) : null}
                  </Td>
                  <Rate value={m.claimSurvival} settled={m.claims.tested + m.claims.falsified} />
                  <Td>{m.objections.raised === 0 ? '—' : m.objections.raised}</Td>
                  <Rate value={m.objectionPrecision} settled={m.objections.upheld + m.objections.overturned} />
                  <Td>
                    {m.runs.total === 0 ? '—' : m.runs.total}
                    {m.runs.failed > 0 ? (
                      <span className="ml-1 text-[10.5px] text-[var(--falsified)]">{m.runs.failed} failed</span>
                    ) : null}
                  </Td>
                  <Td>{m.runs.costCents === 0 ? '—' : money(m.runs.costCents)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Th({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <th className="px-3 py-1.5 text-right font-semibold" title={title}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="tnum whitespace-nowrap px-3 py-1.5 text-right text-[var(--fg-2)]">{children}</td>;
}

/** A rate, or why there isn't one. Never a percentage from two data points. */
function Rate({ value, settled }: { value: number | null; settled: number }) {
  if (value === null) {
    return (
      <td
        className="tnum whitespace-nowrap px-3 py-1.5 text-right text-[var(--fg-4)]"
        title={
          settled === 0
            ? 'Nothing has been settled either way yet.'
            : `Only ${settled} settled — too few to read as a rate.`
        }
      >
        {settled === 0 ? '—' : `${settled} settled`}
      </td>
    );
  }
  return (
    <td className="tnum whitespace-nowrap px-3 py-1.5 text-right">
      <span className={value >= 0.6 ? 'text-[var(--tested)]' : 'text-[var(--falsified)]'}>{pct(value)}</span>
    </td>
  );
}

function Stat({
  label,
  value,
  detail,
  hint,
  alarming,
}: {
  label: string;
  value: string;
  detail: string;
  hint?: string;
  alarming?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5" title={hint}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--fg-4)]">{label}</p>
      <p className={`tnum mt-0.5 text-[19px] font-semibold tracking-[-0.02em] ${alarming ? 'text-[var(--falsified)]' : ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-[1.4] text-[var(--fg-3)]">{detail}</p>
    </div>
  );
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function money(cents: number): string {
  if (cents === 0) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}
