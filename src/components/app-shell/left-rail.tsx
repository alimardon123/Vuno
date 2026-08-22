// Vuno — Left rail (icon rail + content panel)
// Per the user's direction: Buzz/Slack-style icon rail with 5 panels.
//   💬 Chats     — pinned personal assistant + DMs + team chats
//   # Channels   — all channels (can span org levels, be dynamic)
//   🏢 Org       — org/department/team tree + members
//   👥 HR         — org health + members + quick access to HR dashboard (MAIN POINT)
//   ⚙️ Settings  — app views + preferences
//
// The icon rail is a fixed-width (48px) vertical strip on the far left,
// followed by the active panel content (240px). This is the Slack/Teams/Discord
// pattern — sleek, scalable, and lets us add panels without crowding tabs.

'use client';

import { useAppStore, type LeftPanel } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { ChatsPanel } from '@/components/left-rail/chats-panel';
import { ChannelsPanel } from '@/components/left-rail/channels-panel';
import { OrgPanel } from '@/components/left-rail/org-panel';
import { HrPanel } from '@/components/left-rail/hr-panel';
import { SettingsPanel } from '@/components/left-rail/settings-panel';
import {
  MessageSquare,
  Hash,
  Building2,
  Users,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

const PANEL_TABS: Array<{ id: LeftPanel; label: string; icon: LucideIcon }> = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'org', label: 'Org', icon: Building2 },
  { id: 'hr', label: 'HR', icon: Users },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function LeftRail({ onClose }: { onClose?: () => void }) {
  const { leftPanel, setLeftPanel } = useAppStore();

  return (
    <div className="bg-sidebar flex h-full border-r">
      {/* Icon rail — fixed 48px wide */}
      <nav
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/40 py-2"
        role="tablist"
        aria-label="Panel switcher"
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
              title={tab.label}
              onClick={() => setLeftPanel(tab.id)}
              className={cn(
                'group relative flex size-9 items-center justify-center rounded-lg transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
            >
              <tab.icon className="size-4" aria-hidden />
              {/* Tooltip on hover */}
              <span className="pointer-events-none absolute left-full ml-2 z-50 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Active panel content — 240px wide */}
      <div className="flex-1 overflow-hidden">
        {leftPanel === 'chats' ? <ChatsPanel onClose={onClose} /> : null}
        {leftPanel === 'channels' ? <ChannelsPanel onClose={onClose} /> : null}
        {leftPanel === 'org' ? <OrgPanel onClose={onClose} /> : null}
        {leftPanel === 'hr' ? <HrPanel onClose={onClose} /> : null}
        {leftPanel === 'settings' ? <SettingsPanel onClose={onClose} /> : null}
      </div>
    </div>
  );
}
