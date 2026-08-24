// Settings: how the members this org already has are configured.
//
// The same three sections Claude Code settings has, because they are the three
// real kinds of thing and people already know the words: a **skill** is what a
// member knows, a **connector** is what a member can reach, a **plugin** is a
// package that installs both and hires whoever uses them.
//
// Not a rail destination. Settings is rare and administrative — it is reached
// from the viewer menu at the foot of the rail, next to signing out. This
// briefly *was* the rail's Extensions tab, which was wrong twice over: it put
// configuration on the same footing as the places people work, and it took the
// word "Extensions", which belongs to the app catalogue — a board, a call, a
// whole feature somebody adds (docs/IA-NAVIGATION.md).

import Link from 'next/link';
import { db } from '@/lib/db';
import { listMembers } from '@/lib/members';
import { listSkills } from '@/lib/skills';
import { listConnections } from '@/lib/connections';
import { listPlugins } from '@/lib/plugins';
import { catalogue } from '@/lib/plugins/catalogue';
import { Library } from '@/components/vuno/library';
import { Plugins, type CataloguePlugin } from '@/components/vuno/plugins';
import { Empty } from '@/components/vuno/primitives';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TABS = [
  ['skills', 'Skills'],
  ['plugins', 'Plugins'],
  ['connectors', 'Connectors'],
] as const;

type Tab = (typeof TABS)[number][0];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.some(([id]) => id === requested) ? (requested as Tab) : 'skills';

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Empty title="No organisation yet" hint="Run bun run setup." />
      </main>
    );
  }

  const [skills, connections, plugins, cat, members] = await Promise.all([
    listSkills(org.id),
    listConnections(org.id),
    listPlugins(org.id),
    catalogue(),
    listMembers(org.id),
  ]);

  const available: CataloguePlugin[] = cat.entries.map(({ manifest: m }) => ({
    key: m.key,
    name: m.name,
    summary: m.summary,
    version: m.version,
    author: m.author ?? null,
    skills: m.skills.length,
    connectors: m.connectors.length,
    agents: m.agents.length,
  }));

  const holders = members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, displayName: m.displayName, kind: m.kind }));

  // The counts sit on the tabs rather than in a summary line: the number that
  // matters is the one next to the thing it counts.
  const counts: Record<Tab, number> = {
    skills: skills.length,
    plugins: plugins.length,
    connectors: connections.length,
  };

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <div className="mx-auto w-full max-w-[70rem]">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Settings</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
            What the members of this org are made of. A skill is what one knows, a connector is what one can
            reach, and a plugin installs both and hires whoever uses them.
          </p>
          <nav className="mt-2 flex gap-1" aria-label="Settings section">
            {TABS.map(([id, label]) => (
              <Link
                key={id}
                href={id === 'skills' ? '/settings' : `/settings?tab=${id}`}
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
                  tab === id
                    ? 'bg-[var(--select)] font-semibold text-[var(--fg)]'
                    : 'text-[var(--fg-3)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
                )}
              >
                {label}
                <span className="tnum text-[10.5px] text-[var(--fg-4)]">{counts[id]}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[70rem] px-6 pb-8 pt-3">
        {tab === 'plugins' ? (
          <Plugins installed={plugins} available={available} broken={cat.broken} />
        ) : (
          <Library skills={skills} connections={connections} members={holders} tab={tab} />
        )}
      </div>
    </main>
  );
}
