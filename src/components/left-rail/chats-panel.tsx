// Vuno — Chats panel (left rail, default)
// Per the user's direction: like Teams, but sleeker.
// This panel shows ONLY CHATS — DMs (1:1) + Group chats (ad-hoc multi-person).
// Team channels live in the Channels panel. These are NEVER called "channels".
//
// Sections: Pinned (personal assistant) + Direct Messages + Group Chats.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MemberAvatar, MemberBadge, type MemberKind } from '@/components/common/agent-avatar';
import { Pin, MessageSquare, Users, Search, Plus, UserCircle, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useState, useCallback } from 'react';

interface Agent {
  id: string;
  name: string;
  role: string;
  kind: string;
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

interface Chat {
  id: string;
  name: string;
  slug: string;
  topic: string | null;
  teamId: string | null;
  isDm?: boolean;
  isChat?: boolean;
  isGroupChat?: boolean;
}

interface ChannelsResponse {
  channels: Chat[];
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}

interface AgentsResponse {
  agents: Agent[];
}

interface UsersResponse {
  users: User[];
}

interface GroupChatsResponse {
  chats: Chat[];
}

export function ChatsPanel({ onClose }: { onClose?: () => void }) {
  const { activeChannelId, setActiveChannel, setView, bumpChatNonce } = useAppStore();
  const [search, setSearch] = useState('');
  const [creatingDm, setCreatingDm] = useState<string | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

  const channelsRes = useFetch<ChannelsResponse>('/api/channels');
  const agentsRes = useFetch<AgentsResponse>('/api/agents');
  const usersRes = useFetch<UsersResponse>('/api/users');
  const groupChatsRes = useFetch<GroupChatsResponse>('/api/group-chats');

  const agents = agentsRes.data?.agents ?? [];
  const users = usersRes.data?.users ?? [];
  const allChats = channelsRes.data?.channels ?? [];
  const groupChats = groupChatsRes.data?.chats ?? [];

  // Personal assistants (pinned at top)
  const personalAssistants = agents.filter((a) => a.kind === 'personal_assistant');

  // DMs = channels with isDm=true (these are the chats created by /api/dms)
  const dmChats = allChats.filter((c) => c.isDm);

  // Owner-name lookup
  const ownerName = (ownerId: string | null) => {
    if (!ownerId) return undefined;
    const owner = users.find((u) => u.id === ownerId);
    return owner?.name ?? owner?.email ?? 'unknown';
  };

  // DM contacts — all agents + humans (excluding current user)
  // Clicking creates a real DM chat via /api/dms
  const independentAgents = agents.filter((a) => a.kind === 'independent');
  const otherHumans = users;
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

  // Open a DM — creates the chat if it doesn't exist
  const openDm = useCallback(async (memberId: string, memberKind: 'agent' | 'human') => {
    setCreatingDm(memberId);
    try {
      const res = await fetch('/api/dms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withMemberId: memberId, withMemberKind: memberKind }),
      });
      const data = (await res.json()) as { ok: boolean; chat?: { id: string } };
      if (data.ok && data.chat) {
        setActiveChannel(data.chat.id);
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

  return (
    <div className="flex h-full flex-col">
      {/* Search + create group chat */}
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
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5 w-full justify-start gap-1.5 text-xs"
          onClick={() => setCreateGroupOpen(true)}
        >
          <Plus className="size-3.5" aria-hidden />
          New group chat
        </Button>
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

          {/* Direct Messages */}
          <section aria-label="Direct messages">
            <div className="mb-1 flex items-center gap-1.5 px-2">
              <MessageSquare className="size-3 text-muted-foreground" aria-hidden />
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Direct Messages
              </h3>
            </div>
            <ul className="flex flex-col gap-0.5">
              {dmContacts.length === 0 ? (
                <li className="px-2 py-1 text-xs text-muted-foreground">No contacts</li>
              ) : (
                dmContacts.map((dm) => {
                  const isCreating = creatingDm === dm.id;
                  return (
                    <li key={`dm-${dm.id}`}>
                      <button
                        type="button"
                        disabled={creatingDm !== null}
                        onClick={() => openDm(dm.id, dm.memberKind)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                          creatingDm !== null && creatingDm !== dm.id && 'opacity-50',
                        )}
                      >
                        <MemberAvatar name={dm.name} kind={dm.kind} size="sm" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium leading-none">{dm.name}</span>
                            {dm.kind !== 'human' ? <MemberBadge kind={dm.kind} /> : null}
                          </div>
                          {dm.role ? (
                            <span className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">{dm.role}</span>
                          ) : null}
                        </div>
                        {isCreating ? (
                          <span className="text-[0.5625rem] text-muted-foreground animate-pulse">opening…</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          {/* Group Chats — ad-hoc multi-person chats (not team channels) */}
          {filteredGroupChats.length > 0 ? (
            <section aria-label="Group chats">
              <div className="mb-1 flex items-center gap-1.5 px-2">
                <Users className="size-3 text-muted-foreground" aria-hidden />
                <h3 className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Group Chats
                </h3>
              </div>
              <ul className="flex flex-col gap-0.5">
                {filteredGroupChats.map((c) => {
                  const isActive = activeChannelId === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChannel(c.id);
                          setView('chat');
                          onClose?.();
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-l-primary'
                            : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/60',
                        )}
                      >
                        {/* Group chat avatar (initial-based) + small Users icon prefix */}
                        <MemberAvatar name={c.name} kind="independent" size="sm" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-center gap-1.5">
                            <Users className="size-2.5 shrink-0 text-primary/60" aria-hidden />
                            <span className="truncate font-medium leading-none">{c.name}</span>
                          </div>
                          {c.topic ? (
                            <span className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                              {c.topic}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </ScrollArea>

      {/* Create group chat dialog */}
      <CreateGroupChatDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        agents={agents}
        users={users}
        onCreated={(chatId) => {
          setActiveChannel(chatId);
          setView('chat');
          bumpChatNonce();
          groupChatsRes.refetch();
          setCreateGroupOpen(false);
          onClose?.();
        }}
      />
    </div>
  );
}

// ─── Create Group Chat dialog ──────────────────────────────────────────────
interface CreateGroupChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  users: User[];
  onCreated: (chatId: string) => void;
}

function CreateGroupChatDialog({ open, onOpenChange, agents, users, onCreated }: CreateGroupChatDialogProps) {
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const allMembers = [
    ...users.map((u) => ({ id: u.id, name: u.name ?? u.email, kind: 'human' as const })),
    ...agents.map((a) => ({ id: a.id, name: a.name, kind: 'agent' as const })),
  ];

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim() || selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/group-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), memberIds: Array.from(selectedIds) }),
      });
      const data = (await res.json()) as { ok: boolean; chat?: { id: string }; error?: string };
      if (data.ok && data.chat) {
        onCreated(data.chat.id);
        setName('');
        setSelectedIds(new Set());
      } else {
        throw new Error(data.error ?? 'Failed to create group chat');
      }
    } catch (e) {
      console.error('[group-chat] failed:', e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group chat</DialogTitle>
          <DialogDescription>
            Create an ad-hoc group chat with multiple members. Not tied to a team.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Chat name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering sync"
              className="text-sm"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              Members ({selectedIds.size} selected)
            </label>
            <ScrollArea className="h-48 rounded-md border border-border/40">
              <ul className="flex flex-col gap-0.5 p-1">
                {allMembers.map((m) => {
                  const isSelected = selectedIds.has(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-accent/50',
                        )}
                      >
                        <MemberAvatar name={m.name} kind={m.kind === 'human' ? 'human' : 'independent'} size="sm" />
                        <span className="flex-1 truncate text-left">{m.name}</span>
                        {isSelected ? (
                          <span className="text-xs">✓</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={submitting || !name.trim() || selectedIds.size === 0}
          >
            {submitting ? 'Creating…' : 'Create chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
