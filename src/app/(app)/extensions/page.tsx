// Extensions: the apps this org has added.
//
// A whole feature, not a setting — the Teams "add an app to your team" idea, or
// a VS Code extension. Adding Boards puts a board in Work; removing it takes
// the board away. That is the whole test an entry here has to pass, and it is
// why the catalogue is short: everything in it controls a surface that visibly
// appears and disappears.
//
// What is deliberately *not* here: skills, plugins and connectors. Those
// configure the members the org already has rather than adding anything to the
// org, and they live in Settings the way Claude Code has them
// (docs/IA-NAVIGATION.md).

import { db } from '@/lib/db';
import { appsFor } from '@/lib/apps';
import { Apps } from '@/components/vuno/apps';
import { Empty } from '@/components/vuno/primitives';

export const dynamic = 'force-dynamic';

export default async function ExtensionsPage() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Empty title="No organisation yet" hint="Run bun run setup." />
      </main>
    );
  }

  const apps = await appsFor(org.id);
  const added = apps.filter((a) => a.installed).length;

  return (
    <main className="scroll-y min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
        <div className="mx-auto w-full max-w-[70rem]">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Extensions</h1>
            <span className="tnum text-[11.5px] text-[var(--fg-4)]">
              {added} of {apps.length} added
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">
            Whole features you add to this org — a board, calls, a meeting scheduler. Each one names the
            surface it puts on screen, and taking it away takes that surface with it.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[70rem] px-6 pb-8 pt-3">
        <Apps apps={apps} />
      </div>
    </main>
  );
}
