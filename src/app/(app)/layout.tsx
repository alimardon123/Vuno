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
      {/* The rail is six destinations plus the theme menu and your avatar —
          eight stops before any content, on every page. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-[var(--raised)] focus:px-3 focus:py-2 focus:text-[12.5px] focus:font-medium focus:text-[var(--fg)] focus:outline-2 focus:outline-[var(--accent)]"
      >
        Skip to content
      </a>
      <Rail ownerName={owner?.displayName ?? 'You'} />
      <div id="content" className="flex min-w-0 flex-1">{children}</div>
    </div>
  );
}
