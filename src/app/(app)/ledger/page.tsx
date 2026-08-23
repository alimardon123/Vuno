// Ledger: what the organisation believes, and what would change its mind.
// The differentiator, so it stays one click from anywhere.

import { db } from '@/lib/db';
import { memberMap } from '@/lib/members';
import { claimHistory } from '@/lib/ledger/claims';
import { Avatar, Empty, RelativeTime, StatusPill, StatusTrail, type ClaimStatus } from '@/components/vuno/primitives';

export const dynamic = 'force-dynamic';

const ORDER: ClaimStatus[] = ['falsified', 'uncertain', 'believed', 'asserted', 'tested'];

export default async function LedgerPage() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return <main className="flex flex-1 items-center justify-center"><Empty title="No organisation yet" hint="Run bun run setup." /></main>;
  }

  const claims = await db.claim.findMany({ where: { orgId: org.id }, orderBy: { updatedAt: 'desc' } });
  const members = await memberMap(claims.map((c) => c.provenanceMemberId ?? '').filter(Boolean));
  const histories = await Promise.all(claims.map((c) => claimHistory(c.id)));

  const counts = ORDER.map((s) => ({ status: s, n: claims.filter((c) => c.status === s).length }));

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Ledger</h1>
          <span className="tnum text-[11.5px] text-[var(--fg-4)]">{claims.length} claims</span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
          Every claim the organisation holds, with the evidence that moved it. Status transitions; claims are never re-created.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {counts.filter((c) => c.n > 0).map((c) => (
            <span key={c.status} className="inline-flex items-center gap-1.5">
              <StatusPill status={c.status} />
              <span className="tnum text-[11px] text-[var(--fg-4)]">{c.n}</span>
            </span>
          ))}
        </div>
      </header>

      {claims.length === 0 ? (
        <Empty title="Nothing on the ledger yet" hint="A proposal becomes a claim. Evidence moves it." />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {claims.map((c, i) => {
            const history = histories[i];
            const member = c.provenanceMemberId ? members.get(c.provenanceMemberId) : null;
            const trail = history.map((h) => h.from);
            let evidence: string[] = [];
            try { evidence = JSON.parse(c.evidenceIds || '[]') as string[]; } catch { evidence = []; }

            return (
              <li key={c.id} className="px-6 py-3 transition-colors hover:bg-[var(--hover)]">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <p className="min-w-0 flex-1 text-[13px] font-medium leading-[1.45] text-[var(--fg)]">{c.statement}</p>
                  <StatusPill status={c.status as ClaimStatus} />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {trail.length > 0 ? <StatusTrail trail={trail} current={c.status as ClaimStatus} /> : null}
                  {member ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fg-3)]">
                      <Avatar name={member.displayName} kind={member.kind} size="xs" />
                      {member.displayName}
                      {member.role ? <span className="text-[var(--fg-4)]">· {member.role}</span> : null}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--fg-4)]">system</span>
                  )}
                  <span className="tnum text-[10.5px] text-[var(--fg-4)]">
                    {evidence.length} evidence · updated <RelativeTime value={String(c.updatedAt)} />
                  </span>
                </div>

                {c.statusReason ? (
                  <p className="mt-1 max-w-[76ch] text-[11.5px] leading-[1.5] text-[var(--fg-3)]">{c.statusReason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
