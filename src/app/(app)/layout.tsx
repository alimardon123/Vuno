// The shell: a fixed rail, then whatever the active section renders. Each
// section owns its own list pane, which is why this layout stays this small.

import { redirect } from 'next/navigation';
import { Rail } from '@/components/vuno/rail';
import { Ringing } from '@/components/vuno/ringing';
import { currentViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The middleware turns away anyone with no cookie, but it cannot check
  // whether the cookie names a real session — Prisma does not run in the edge
  // runtime. This is where a forged or expired one is actually refused, and it
  // sits in the layout so every page under it inherits the check rather than
  // each one remembering to make it.
  const viewer = await currentViewer();
  if (!viewer) redirect('/sign-in');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)]">
      {/* Above everything, because a call has to reach somebody who is reading
          something else — that is what separates a call from a notice. */}
      <Ringing />

      {/* The rail is seven destinations plus the theme menu and your avatar —
          nine stops before any content, on every page. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-[var(--raised)] focus:px-3 focus:py-2 focus:text-[12.5px] focus:font-medium focus:text-[var(--fg)] focus:outline-2 focus:outline-[var(--accent)]"
      >
        Skip to content
      </a>
      <Rail viewer={viewer} />
      <div id="content" className="flex min-w-0 flex-1">{children}</div>
    </div>
  );
}
