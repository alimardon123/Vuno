// Vuno — Settings panel (left rail, third tab)
// Holds app-level views: Epistemic Ledger, Project Wiki, HR / Meta, File Objective,
// theme toggle, help. This is the "navigation" surface — distinct from the
// chat-list (Chats panel) and org-roster (Org panel).

'use client';

import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  BookOpen,
  FileText,
  BarChart3,
  Target,
  Palette,
  HelpCircle,
  PanelLeftClose,
  Brain,
  Radar,
} from 'lucide-react';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { ATTENTION_PATTERNS } from '@/lib/agents/attention-router';
import { ROLE_LABELS } from '@/lib/agents/types';

export function SettingsPanel({ onClose }: { onClose?: () => void }) {
  const { activeView, setView, setFileObjectiveOpen } = useAppStore();

  const navItems: Array<{
    label: string;
    icon: typeof BookOpen;
    view: 'ledger' | 'wiki' | 'hr' | 'thoughts' | 'attention';
    description: string;
  }> = [
    {
      label: 'Epistemic Ledger',
      icon: BookOpen,
      view: 'ledger',
      description: 'Every claim with status + provenance.',
    },
    {
      label: 'Project Wiki',
      icon: FileText,
      view: 'wiki',
      description: 'A project page generated from the ledger.',
    },
    {
      label: 'Thought Graph',
      icon: Brain,
      view: 'thoughts',
      description: 'The cognitive web — how agents\' reasoning connects.',
    },
    {
      label: 'Attention Router',
      icon: Radar,
      view: 'attention',
      description: 'What each agent listens for in channel chatter.',
    },
    {
      label: 'HR / Meta',
      icon: BarChart3,
      view: 'hr',
      description: 'The org evaluating itself — metrics visualized.',
    },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Mobile close */}
      {onClose ? (
        <div className="flex items-center justify-between border-b border-border/40 p-2 md:hidden">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Settings
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close"
            onClick={onClose}
          >
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-3 p-2">
          <section aria-label="App views">
            <div className="mb-1 px-2">
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Views
              </h3>
            </div>
            <ul className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <li key={item.view}>
                  <button
                    type="button"
                    onClick={() => {
                      setView(item.view);
                      onClose?.();
                    }}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      activeView === item.view
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <item.icon className="size-3.5 opacity-70" aria-hidden />
                      <span className="font-medium">{item.label}</span>
                    </div>
                    <span className="ml-5 text-[0.6875rem] text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Actions">
            <div className="mb-1 px-2">
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Actions
              </h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                setFileObjectiveOpen(true);
                onClose?.();
              }}
            >
              <Target className="size-3.5" aria-hidden />
              File Objective
            </Button>
          </section>

          <section aria-label="Preferences">
            <div className="mb-1 px-2">
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Preferences
              </h3>
            </div>
            <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <Palette className="size-3.5 opacity-70" aria-hidden />
                <span>Theme</span>
              </div>
              <ThemeToggle />
            </div>
          </section>
        </div>
      </ScrollArea>

      <div className="border-t border-border/40 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => {
            // open help via the parent
            onClose?.();
          }}
        >
          <HelpCircle className="size-3.5" aria-hidden />
          Help & about
        </Button>
      </div>
    </div>
  );
}
