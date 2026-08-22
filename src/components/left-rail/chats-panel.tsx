// Vuno — Chats panel (left rail, default)
// Per the user's direction: like Teams, but sleeker.
// Sections: Pinned (personal assistant at top) + Direct Messages + Team Chats.
// NO agents list here — agents live in the Org panel's members roster.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MemberAvatar, MemberBadge, type MemberKind } from '@/components/common/agent-avatar';
import { Hash, Pin, Star, MessageSquare, Users, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

interface Agent {
  id: string;
  name: string;
  role: string;
  kind: string; // 'independent' | 'personal_assistant'
  teamId: string | null;
  status: string;
  ownerHumanId: string | null;
}

interface User {
  id: string;
  name: string | null;
  email: string;
  isOrgOwner: boolean;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  departmentId: string;
}

interface Channel {
  id: string;
  name: string;
  slug: string;
  topic: string | null;
  teamId: string | null;
}

interface ChannelsResponse {
  channels: Channel[];
  departments: { id: string; name: string }[];
  teams: Team[];
}

interface AgentsResponse {
  agents: Agent[];
}

interface UsersResponse {
  users: User[];
}

// Static "recent DMs" list for v1 — in a real app this comes from a DM-scoped
// query of the event spine. For now we surface the org agents + the CEO as
// recent contacts so the panel has content.
// TODO: replace with a /api/dms endpoint that returns actual recent DM conversations.

export function ChatsPanel({ onClose }: { onClose?: () => void }) {
  const { activeChannelId, setActiveChannel, setView } = useAppStore();
  const [search, setSearch] = useState('');

  const channelsRes = useFetch<ChannelsResponse>('/api/channels');
  const agentsRes = useFetch<AgentsResponse>('/api/agents');
  const usersRes = useFetch<UsersResponse>('/api/users');

  const agents = agentsRes.data?.agents ?? [];
  const users = usersRes.data?.users ?? [];
  const teams = channelsRes.data?.teams ?? [];
  const channels = channelsRes.data?.channels ?? [];

  // Personal assistants (pinned at top)
  const personalAssistants = agents.filter((a) => a.kind === 'personal_assistant');

  // Owner-name lookup for personal assistants
  const ownerName = (ownerId: string | null) => {
    if (!ownerId) return undefined;
    const owner = users.find((u) => u.id === ownerId);
    return owner?.name ?? owner?.email ?? 'unknown';
  };

  // Recent DMs — for v1, surface all org agents (independent kind) and humans
  // except the current user. In a real app this would be sorted by last-message-time.
  const independentAgents = agents.filter((a) => a.kind === 'independent');
  const otherHumans = users; // the CEO is the only human in v1
  const recentDMs = [
    ...otherHumans.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      kind: 'human' as MemberKind,
      role: u.isOrgOwner ? 'Org Owner (CEO)' : undefined,
      lastMessage: '',
    })),
    ...independentAgents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: 'independent' as MemberKind,
      role: a.role,
      lastMessage: '',
    })),
  ].filter((dm) => {
    if (!search) return true;
    return dm.name.toLowerCase().includes(search.toLowerCase());
  });

  // Team chats — for v1, treat each team as a "group chat" (no # prefix).
  // In a real app these would be separate group-chat entities, but for the demo
  // we surface the teams directly.
  const teamChats = teams.filter((t) => {
    if (!search) return true;
    return t.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b border-border/40 p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-4 p-2">
          {/* Pinned personal assistant */}
          {personalAssistants.length > 0 ? (
            <section aria-label="Pinned">
              <div className="mb-1 flex items-center gap-1.5 px-2">
                <Pin className="size-3 text-muted-foreground" aria-hidden />
                <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Pinned
                </h3>
              </div>
              <ul className="flex flex-col gap-0.5">
                {personalAssistants.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => { setView('chat'); onClose?.(); }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                      )}
                    >
                      <MemberAvatar name={a.name} kind="personal_assistant" size="sm" health={a.status === 'active' ? 'ok' : 'warn'} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium leading-none">{a.name}</span>
                          <MemberBadge kind="personal_assistant" ownerName={ownerName(a.ownerHumanId)} />
                        </div>
                        <span className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                          {ownerName(a.ownerHumanId)}&apos;s assistant
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Merged chat list — DMs + group chats in one list (Teams-style).
              Group chats get a Users icon before their name to distinguish them. */}
          <section aria-label="Chats">
            <div className="mb-1 flex items-center gap-1.5 px-2">
              <MessageSquare className="size-3 text-muted-foreground" aria-hidden />
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Chats
              </h3>
            </div>
            <ul className="flex flex-col gap-0.5">
              {(() => {
                // Merge DMs + group chats into one list, sorted alphabetically
                const dmItems = recentDMs.map((dm) => ({
                  type: 'dm' as const,
                  id: dm.id,
                  name: dm.name,
                  kind: dm.kind,
                  role: dm.role,
                }));
                const groupItems = teamChats.map((t) => {
                  const firstChannel = channels.find((c) => c.teamId === t.id);
                  return {
                    type: 'group' as const,
                    id: t.id,
                    name: t.name,
                    firstChannelId: firstChannel?.id,
                    isActive: firstChannel && activeChannelId === firstChannel.id,
                  };
                });
                const merged = [...dmItems, ...groupItems].sort((a, b) => a.name.localeCompare(b.name));
                if (merged.length === 0) return <li className="px-2 py-1 text-xs text-muted-foreground">No chats</li>;
                return merged.map((item) => {
                  if (item.type === 'dm') {
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const firstChannel = channels[0];
                            if (firstChannel) setActiveChannel(firstChannel.id);
                            onClose?.();
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                          )}
                        >
                          <MemberAvatar name={item.name} kind={item.kind} size="sm" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium leading-none">{item.name}</span>
                              {item.kind !== 'human' ? <MemberBadge kind={item.kind} /> : null}
                            </div>
                            {item.role ? (
                              <span className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">{item.role}</span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  }
                  // Group chat — Users icon before the name
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.firstChannelId) setActiveChannel(item.firstChannelId);
                          onClose?.();
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          item.isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                        )}
                      >
                        <span className="grid size-5 place-items-center rounded bg-muted text-muted-foreground" aria-hidden>
                          <Users className="size-3" />
                        </span>
                        <span className="truncate">{item.name}</span>
                        <span className="ml-auto rounded bg-primary/10 px-1 py-0 text-[0.5625rem] font-medium leading-none text-primary">
                          team
                        </span>
                      </button>
                    </li>
                  );
                });
              })()}
            </ul>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
