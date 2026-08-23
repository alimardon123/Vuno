'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ListPane, ListRow } from '@/components/vuno/list-pane';
import { Avatar, RelativeTime, SectionLabel } from '@/components/vuno/primitives';
import type { Conversation } from '@/lib/conversations';

export function ChatsPane({
  conversations,
  assistantId,
}: {
  conversations: Conversation[];
  assistantId: string | null;
}) {
  const pathname = usePathname();
  const [q, setQ] = useState('');

  const { pinned, direct, groups, rooms } = useMemo(() => {
    const match = (c: Conversation) =>
      !q ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.preview?.body ?? '').toLowerCase().includes(q.toLowerCase());

    // The assistant is pinned by being your DM with it — not by a second,
    // parallel row that has to invent an id.
    const isAssistantDm = (c: Conversation) =>
      c.kind === 'dm' && assistantId !== null && c.counterpart?.id === assistantId;

    const visible = conversations.filter(match);
    return {
      pinned: conversations.find(isAssistantDm) ?? null,
      direct: visible.filter((c) => c.kind === 'dm' && !isAssistantDm(c)),
      groups: visible.filter((c) => c.kind === 'group'),
      rooms: visible.filter((c) => c.kind === 'team_room'),
    };
  }, [conversations, assistantId, q]);

  const row = (c: Conversation) => (
    <ListRow
      key={c.id}
      href={`/chats/${c.id}`}
      active={pathname === `/chats/${c.id}`}
      leading={
        <Avatar
          name={c.name}
          kind={c.counterpart?.kind ?? 'agent'}
          size="xs"
          presence={c.counterpart?.presenceState}
        />
      }
      title={c.name}
      preview={c.preview ? `${c.preview.author}: ${c.preview.body}` : 'No messages yet'}
      meta={c.lastActivityAt ? <RelativeTime value={c.lastActivityAt} /> : null}
    />
  );

  const count = (pinned ? 1 : 0) + direct.length + groups.length + rooms.length;

  return (
    <ListPane
      title="Chats"
      searchPlaceholder="Search chats…"
      onSearch={setQ}
      hideOnMobile={pathname !== '/chats'}
    >
      {pinned ? (
        <>
          <SectionLabel>Pinned</SectionLabel>
          <ListRow
            href={`/chats/${pinned.id}`}
            active={pathname === `/chats/${pinned.id}`}
            leading={
              <Avatar
                name={pinned.name}
                kind="agent"
                size="xs"
                presence={pinned.counterpart?.presenceState}
              />
            }
            title={pinned.name}
            preview={
              pinned.preview
                ? `${pinned.preview.author}: ${pinned.preview.body}`
                : pinned.counterpart?.ownerName
                  ? `${pinned.counterpart.ownerName}'s assistant`
                  : 'Your assistant'
            }
            meta={pinned.lastActivityAt ? <RelativeTime value={pinned.lastActivityAt} /> : null}
          />
        </>
      ) : null}

      {direct.length > 0 ? <SectionLabel count={direct.length}>Direct messages</SectionLabel> : null}
      {direct.map(row)}

      {groups.length > 0 ? <SectionLabel count={groups.length}>Group chats</SectionLabel> : null}
      {groups.map(row)}

      {rooms.length > 0 ? <SectionLabel count={rooms.length}>Team rooms</SectionLabel> : null}
      {rooms.map(row)}

      {count === 0 ? (
        <p className="px-2 py-6 text-center text-[11.5px] text-[var(--fg-4)]">
          {q ? 'Nothing matches that.' : 'No chats yet.'}
        </p>
      ) : null}
    </ListPane>
  );
}
