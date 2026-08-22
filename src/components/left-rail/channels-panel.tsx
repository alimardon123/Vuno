// Vuno — Channels panel (left rail, second tab)
// Per the user's direction: channels can span org levels or be dynamic.
// Each team/department gets one default channel, but we can also create
// separate channels and add any department, team, or user (human/agent).
//
// Sections:
// - All channels (with # prefix, sorted by name)
// - "Create channel" entry at bottom (opens a dialog — v1: placeholder)

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Hash, Search, Plus, Star } from 'lucide-react';
import { useState, useMemo } from 'react';

interface Channel {
  id: string;
  name: string;
  slug: string;
  topic: string | null;
  teamId: string | null;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  departmentId: string;
}

interface ChannelsResponse {
  channels: Channel[];
  departments: { id: string; name: string }[];
  teams: Team[];
}

export function ChannelsPanel({ onClose }: { onClose?: () => void }) {
  const { activeChannelId, setActiveChannel } = useAppStore();
  const [search, setSearch] = useState('');

  const channelsRes = useFetch<ChannelsResponse>('/api/channels');
  const channels = channelsRes.data?.channels ?? [];
  const teams = channelsRes.data?.teams ?? [];

  const teamById = new Map(teams.map((t) => [t.id, t]));

  const filteredChannels = useMemo(() => {
    const sorted = [...channels].sort((a, b) => a.name.localeCompare(b.name));
    if (!search) return sorted;
    return sorted.filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.topic ?? '').toLowerCase().includes(search.toLowerCase())
    );
  }, [channels, search]);

  return (
    <div className="flex h-full flex-col">
      {/* Search + create */}
      <div className="border-b border-border/40 p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5 w-full justify-start gap-1.5 text-xs"
          onClick={() => {
            // v1: channel creation is a later slice — show a toast for now
            // via the parent AppShell's toast. For now, just focus the search.
            // TODO: open a CreateChannelDialog
          }}
        >
          <Plus className="size-3.5" aria-hidden />
          Create channel
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-4 p-2">
          <section aria-label="All channels">
            <div className="mb-1 flex items-center justify-between px-2">
              <div className="flex items-center gap-1.5">
                <Hash className="size-3 text-muted-foreground" aria-hidden />
                <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Channels
                </h3>
              </div>
              <span className="text-[0.625rem] text-muted-foreground">{filteredChannels.length}</span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {filteredChannels.length === 0 ? (
                <li className="px-2 py-1 text-xs text-muted-foreground">No channels</li>
              ) : (
                filteredChannels.map((c) => {
                  const isActive = activeChannelId === c.id;
                  const team = c.teamId ? teamById.get(c.teamId) : null;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChannel(c.id);
                          onClose?.();
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-l-primary'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50',
                        )}
                      >
                        <Hash className="size-3.5 opacity-60" aria-hidden />
                        <span className="truncate">{c.name}</span>
                        {team ? (
                          <span className="ml-auto truncate text-[0.625rem] text-muted-foreground">
                            {team.name}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
