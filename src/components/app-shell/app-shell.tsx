// Vuno — App Shell
// Root shell: top bar + 3-column layout (left rail / main / right rail) + sticky footer.
// Auto-seeds the database on first mount.

'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { TopBar } from '@/components/app-shell/top-bar';
import { LeftRail } from '@/components/app-shell/left-rail';
import { RightRail } from '@/components/app-shell/right-rail';
import { ChatView } from '@/components/chat/chat-view';
import { DecisionView } from '@/components/decision/decision-view';
import { LedgerView } from '@/components/ledger/ledger-view';
import { AgentsView } from '@/components/agents/agents-view';
import { WikiView } from '@/components/wiki/wiki-view';
import { HRView } from '@/components/hr/hr-view';
import { ThoughtGraphView } from '@/components/thoughts/thought-graph-view';
import { InstallAgentDialog } from '@/components/agents/install-agent-dialog';
import { FileObjectiveDialog } from '@/components/objective/file-objective-dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Menu,
  PanelRight,
} from 'lucide-react';
import { useFetch } from '@/hooks/use-fetch';

interface OrgInfo {
  tenant: { name: string } | null;
  org: { name: string } | null;
}

export function AppShell() {
  const {
    activeView,
    leftRailOpen,
    rightRailOpen,
    setLeftRailOpen,
    setRightRailOpen,
    installAgentOpen,
    fileObjectiveOpen,
  } = useAppStore();

  // org info (for top bar + footer)
  const orgInfoRes = useFetch<OrgInfo>('/api/org-info');

  // boot-sequence state — no longer blocks the UI; seeds in the background
  const [bootError, setBootError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // auto-seed on first mount + auto-select the first channel once seeding completes
  // The app shell renders immediately; the chat view shows a subtle loading
  // state until the first channel is selected.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const statusRes = await fetch('/api/seed');
        const status = (await statusRes.json()) as {
          seeded: boolean;
        };
        if (!status.seeded) {
          const postRes = await fetch('/api/seed', { method: 'POST' });
          const post = (await postRes.json()) as { ok: boolean };
          if (cancelled) return;
          if (!post.ok) {
            setBootError('Seed failed');
            return;
          }
        }
        // Fetch channels and auto-select the first one (the seeded #storage-engine)
        try {
          const channelsRes = await fetch('/api/channels');
          const channelsJson = (await channelsRes.json()) as {
            channels: { id: string; name: string }[];
          };
          if (cancelled) return;
          const firstChannel = channelsJson.channels[0];
          if (firstChannel && !useAppStore.getState().activeChannelId) {
            useAppStore.getState().setActiveChannel(firstChannel.id);
          }
        } catch {
          // ignore channel fetch errors — user can still pick manually
        }
      } catch (e) {
        if (!cancelled) {
          setBootError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (bootError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold">Failed to initialize</h1>
        <p className="text-sm text-muted-foreground">{bootError}</p>
        <Button onClick={() => location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        tenantName={orgInfoRes.data?.tenant?.name ?? 'Acme'}
        orgName={orgInfoRes.data?.org?.name ?? 'Storage Engine Co.'}
        onHelp={() => setHelpOpen(true)}
      />

      {/* Mobile top bar action row */}
      <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setLeftRailOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-4" aria-hidden />
          Chats
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-2"
          onClick={() => setRightRailOpen(true)}
          aria-label="Open context"
        >
          <PanelRight className="size-4" aria-hidden />
          Context
        </Button>
      </div>

      {/* 3-column layout — fills remaining height; each column scrolls internally */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail — fixed, never scrolls with the page; internal ScrollArea handles overflow */}
        <aside className="hidden md:flex md:shrink-0" aria-label="Navigation" style={{ width: 'calc(48px + 240px)' }}>
          <LeftRail />
        </aside>

        {/* Main content — scrolls internally */}
        <main className="h-full min-h-0 flex-1 overflow-hidden" role="main">
          {activeView === 'chat' ? <ChatView /> : null}
          {activeView === 'decision' ? <DecisionView /> : null}
          {activeView === 'ledger' ? <LedgerView /> : null}
          {activeView === 'agents' ? <AgentsView /> : null}
          {activeView === 'wiki' ? <WikiView /> : null}
          {activeView === 'hr' ? <HRView /> : null}
          {activeView === 'thoughts' ? <ThoughtGraphView /> : null}
        </main>

        {/* Right rail — hidden on mobile; sheet-triggered */}
        <aside
          className="hidden w-80 shrink-0 lg:block"
          aria-label="Context"
        >
          <RightRail />
        </aside>
      </div>

      {/* Mobile left rail sheet */}
      <Sheet
        open={leftRailOpen}
        onOpenChange={(open) => setLeftRailOpen(open)}
      >
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <LeftRail onClose={() => setLeftRailOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Mobile right rail sheet */}
      <Sheet
        open={rightRailOpen}
        onOpenChange={(open) => setRightRailOpen(open)}
      >
        <SheetContent side="bottom" className="h-[60vh] p-0">
          <SheetTitle className="sr-only">Context</SheetTitle>
          <RightRail onClose={() => setRightRailOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Dialogs */}
      <InstallAgentDialog
        open={installAgentOpen}
        onOpenChange={(open) =>
          useAppStore.getState().setInstallAgentOpen(open)
        }
      />
      <FileObjectiveDialog
        open={fileObjectiveOpen}
        onOpenChange={(open) =>
          useAppStore.getState().setFileObjectiveOpen(open)
        }
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

// ─── Help dialog ─────────────────────────────────────────────────────────────
function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vuno — what is this?</DialogTitle>
          <DialogDescription>
            A communication app on the surface. A working company underneath.
            Specialized AI agents and humans who genuinely collaborate —
            proposing, challenging each other with evidence, running
            experiments, blocking each other at quality gates — while everyone
            watches it happen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            The differentiator is{' '}
            <span className="text-foreground font-medium">
              traceable, falsifiable reasoning
            </span>
            . Every claim has a status and provenance; debate is the
            state-transition function that moves claims between statuses.
          </p>
          <p>
            The killer demo is the seeded falsification arc: an architecture
            proposal reached <em>believed</em>, a benchmark{' '}
            <em>falsified</em> it, and the gate <em>blocked</em> the build.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <span className="text-foreground">Chat</span> — a projection of
              the append-only event spine.
            </li>
            <li>
              <span className="text-foreground">Decision</span> — a
              GitHub-PR-style artifact with anchored discussion + gates.
            </li>
            <li>
              <span className="text-foreground">Ledger</span> — every claim with
              status + provenance. The distinctive surface.
            </li>
            <li>
              <span className="text-foreground">Project Wiki</span> — a project
              page generated entirely from the ledger. Always current; never
              maintained separately.
            </li>
            <li>
              <span className="text-foreground">HR / Meta</span> — the org
              evaluating itself. Objection precision, proposal survival rate,
              gate-block accuracy, visualized as charts.
            </li>
            <li>
              <span className="text-foreground">Agents</span> — install
              specialized AI agents (simulated in v1).
            </li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
