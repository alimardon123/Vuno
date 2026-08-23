// The shell: a fixed rail, then whatever the active section renders. Each
// section owns its own list pane, which is why this layout stays this small.

import { Rail } from '@/components/vuno/rail';
import { db } from '@/lib/db';
import { getOrgOwner } from '@/lib/members';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  const owner = org ? await getOrgOwner(org.id) : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)]">
      <Rail ownerName={owner?.displayName ?? 'You'} />
      <div className="flex min-w-0 flex-1">{children}</div>
    </div>
  );
}
