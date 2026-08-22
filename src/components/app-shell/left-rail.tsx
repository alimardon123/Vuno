// Vuno — Left rail (panel switcher + active panel)
// Per the user's direction: Teams-style three-panel switcher.
//   💬 Chats  — pinned personal assistant + DMs + team chats (no #)
//   🏢 Org    — org/department/team tree + members roster (all agents live here)
//   ⚙️ Settings — app views (Ledger, Wiki, HR) + theme + help
//
// This replaces the old single-panel left rail that had channels + agents in one list.

'use client';

import { useAppStore, type LeftPanel } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { ChatsPanel } from '@/components/left-rail/chats-panel';
import { OrgPanel } from '@/components/left-rail/org-panel';
import { SettingsPanel } from '@/components/left-rail/settings-panel';
import { MessageSquare, Building2, Settings as SettingsIcon } from 'lucide-react';

const PANEL_TABS: Array<{ id: LeftPanel; label: string; icon: typeof MessageSquare }> = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'org', label: 'Org', icon: Building2 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function LeftRail({ onClose }: { onClose?: () => void }) {
  const { leftPanel, setLeftPanel } = useAppStore();

  return (
    <div className="bg-sidebar flex h-full w-64 flex-col border-r">
      {/* Panel switcher — 3 tabs at the top */}
      <div
        className="flex shrink-0 items-center gap-0.5 border-b border-border/40 p-1"
        role="tablist"
        aria-label="Left panel switcher"
      >
        {PANEL_TABS.map((tab) => {
          const isActive = leftPanel === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              onClick={() => setLeftPanel(tab.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-foreground',
              )}
            >
              <tab.icon className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active panel content */}
      <div className="flex-1 overflow-hidden">
        {leftPanel === 'chats' ? <ChatsPanel onClose={onClose} /> : null}
        {leftPanel === 'org' ? <OrgPanel onClose={onClose} /> : null}
        {leftPanel === 'settings' ? <SettingsPanel onClose={onClose} /> : null}
      </div>
    </div>
  );
}
