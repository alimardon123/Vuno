// Vuno — Chats panel (left rail, default)
// Per the user's direction: like Teams, but sleeker.
// Sections: Pinned (personal assistant at top) + Direct Messages + Team Chats.
// NO agents list here — agents live in the Org panel's members roster.
//
// Per the "Beautiful" principle: group chats get initial-based avatars (like
// DMs) + a small Users icon prefix to indicate "team". DMs get real DM scopes
// via /api/dms (get-or-create). The PA chat opens a real DM with Bob.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MemberAvatar, MemberBadge, type MemberKind } from '@/components/common/agent-avatar';
import { Pin, MessageSquare, Users, Search, UserCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState, useCallback } from 'react';

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
  isDm?: boolean;
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

export function ChatsPanel({ onClose }: { onClose?: () => void }) {
  const { activeChannelId, setActiveChannel, setView, bumpChatNonce } = useAppStore();
  const [search, setSearch] = useState('');
  const [creatingDm, setCreatingDm] = useState<string | null>(null);

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

  // Group chats = team-scoped channels (channels with a teamId, not DMs)
  // These are the real "team group chats" — they have avatars + team icon prefix.
  const groupChats = channels.filter((c) => c.teamId && !c.isDm);

  // DMs = independent agents + humans (excluding the current user)
  // Clicking creates a real DM channel via /api/dms
  const independentAgents = agents.filter((a) => a.kind === 'independent');
  const otherHumans = users; // the CEO is the only human in v1
  const dmContacts = [
    ...otherHumans.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      kind: 'human' as MemberKind,
      role: u.isOrgOwner ? 'Org Owner (CEO)' : undefined,
      memberKind: 'human' as const,
    })),
    ...independentAgents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: 'independent' as MemberKind,
      role: a.role,
      memberKind: 'agent' as const,
    })),
  ].filter((dm) => {
    if (!search) return true;
    return dm.name.toLowerCase().includes(search.toLowerCase());
  });

  // Open a DM with a member — creates the DM channel if it doesn't exist
  const openDm = useCallback(async (memberId: string, memberKind: 'agent' | 'human') => {
    setCreatingDm(memberId);
    try {
      const res = await fetch('/api/dms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withMemberId: memberId, withMemberKind: memberKind }),
      });
      const data = (await res.json()) as { ok: boolean; channel?: { id: string } };
      if (data.ok && data.channel) {
        setActiveChannel(data.channel.id);
        setView('chat');
        bumpChatNonce();
      }
    } catch (err) {
      console.error('[chats] failed to open DM:', err);
    } finally {
      setCreatingDm(null);
      onClose?.();
    }
  }, [setActiveChannel, setView, bumpChatNonce, onClose]);

  // Filter group chats by search
  const filteredGroupChats = groupChats.filter((c) => {
    if (!search) return true;
    return c.name.toLowerCase().includes(search.toLowerCase());
  });

  // Build a merged, sorted list of all chats (DMs + group chats)
  const mergedChats = [
    ...dmContacts.map((dm) => ({
      type: 'dm' as const,
      id: dm.id,
      name: dm.name,
      kind: dm.kind,
      role: dm.role,
      memberKind: dm.memberKind,
    })),
    ...filteredGroupChats.map((c) => {
      const team = teams.find((t) => t.id === c.teamId);
      return {
        type: 'group' as const,
        id: c.id,
        name: c.name,
        teamName: team?.name ?? null,
        isActive: activeChannelId === c.id,
      };
    }),
  ].sort((a, b) => a.name.localeCompare(b.name));

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

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
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
                {personalAssistants.map((a) => {
                  const isActive = creatingDm === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={creatingDm !== null}
                        onClick={() => openDm(a.id, 'agent')}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                          creatingDm !== null && creatingDm !== a.id && 'opacity-50',
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
                  );
                })}
              </ul>
            </section>
          ) : null}

          {/* Merged chat list — DMs + group chats in one list (Teams-style).
              Group chats get an initial-based avatar (like DMs) + a small Users
              icon prefix before the name to indicate "team". DMs get real DM scopes. */}
          <section aria-label="Chats">
            <div className="mb-1 flex items-center gap-1.5 px-2">
              <MessageSquare className="size-3 text-muted-foreground" aria-hidden />
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Chats
              </h3>
            </div>
            <ul className="flex flex-col gap-0.5">
              {mergedChats.length === 0 ? (
                <li className="px-2 py-1 text-xs text-muted-foreground">No chats</li>
              ) : (
                mergedChats.map((item) => {
                  if (item.type === 'dm') {
                    const isCreating = creatingDm === item.id;
                    return (
                      <li key={`dm-${item.id}`}>
                        <button
                          type="button"
                          disabled={creatingDm !== null}
                          onClick={() => openDm(item.id, item.memberKind)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                            creatingDm !== null && creatingDm !== item.id && 'opacity-50',
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
                          {isCreating ? (
                            <span className="text-[0.5625rem] text-muted-foreground animate-pulse">opening…</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  }
                  // Group chat — avatar (initial-based) + small Users icon prefix before name
                  return (
                    <li key={`group-${item.id}`}>
                      <button
                        type="button"
                        disabled={creatingDm !== null}
                        onClick={() => {
                          setActiveChannel(item.id);
                          setView('chat');
                          onClose?.();
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          item.isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-l-primary'
                            : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                          creatingDm !== null && 'opacity-50',
                        )}
                      >
                        <MemberAvatar name={item.name} kind="independent" size="sm" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-center gap-1.5">
                            {/* Small Users icon prefix before the name — indicates "team" */}
                            <Users className="size-2.5 shrink-0 text-primary/60" aria-hidden />
                            <span className="truncate font-medium leading-none">{item.name}</span>
                          </div>
                          {item.teamName ? (
                            <span className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                              {item.teamName}
                            </span>
                          ) : null}
                        </div>
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
