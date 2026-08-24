// The one page reachable signed out. On the first run of a seeded org it asks
// you to set a password rather than asking for one nobody has yet.

import { db } from '@/lib/db';
import { needsFirstRun } from '@/lib/auth';
import { SignInForm } from '@/components/vuno/sign-in-form';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  const firstRun = org ? await needsFirstRun(org.id) : false;
  const { next } = await searchParams;

  // Which account is being claimed, shown rather than assumed — and it gives
  // the form a username field, without which a password manager has nothing to
  // save the credential against.
  const owner = firstRun && org
    ? await db.humanProfile.findFirst({
        where: { isOrgOwner: true, member: { orgId: org.id } },
        select: { email: true, member: { select: { displayName: true } } },
      })
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-5 py-16">
      <div className="w-full max-w-[22rem]">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            className="grid size-7 place-items-center rounded-[8px]"
            style={{ background: 'linear-gradient(148deg,#E8EBEE 0%,#E8EBEE 48%,#7C8792 48%,#7C8792 100%)' }}
            aria-hidden
          />
          <div className="flex flex-col">
            <span className="text-[14px] font-semibold tracking-[-0.015em]">Vuno</span>
            {org ? <span className="text-[11px] text-[var(--fg-3)]">{org.name}</span> : null}
          </div>
        </div>

        <SignInForm
          firstRun={firstRun}
          hasOrg={Boolean(org)}
          next={next ?? '/activity'}
          ownerEmail={owner?.email ?? null}
          ownerName={owner?.member.displayName ?? null}
        />
      </div>
    </main>
  );
}
