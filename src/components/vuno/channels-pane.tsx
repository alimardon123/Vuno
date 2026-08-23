'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ListPane, ListRow } from '@/components/vuno/list-pane';
import { RelativeTime, SectionLabel } from '@/components/vuno/primitives';
import type { Conversation } from '@/lib/conversations';

export function ChannelsPane({ conversations }: { conversations: Conversation[] }) {
  const pathname = usePathname();
  const [q, setQ] = useState('');

  const { rooms, open } = useMemo(() => {
    const visible = conversations.filter(
      (c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.topic ?? '').toLowerCase().includes(q.toLowerCase()),
    );
    return {
      // A team's own channel is created with the team and cannot be deleted, so
      // it reads differently from one someone opened.
      rooms: visible.filter((c) => c.kind === 'team_room'),
      open: visible.filter((c) => c.kind === 'channel'),
    };
  }, [conversations, q]);

  const row = (c: Conversation) => (
    <ListRow
      key={c.id}
      href={`/channels/${c.id}`}
      active={pathname === `/channels/${c.id}`}
      leading={<span className="text-[13px] leading-none text-[var(--fg-4)]">#</span>}
      title={c.name}
      preview={c.preview ? `${c.preview.author}: ${c.preview.body}` : (c.topic ?? 'No messages yet')}
      meta={c.lastActivityAt ? <RelativeTime value={c.lastActivityAt} /> : null}
    />
  );

  return (
    <ListPane
      title="Channels"
      searchPlaceholder="Search channels…"
      onSearch={setQ}
      hideOnMobile={pathname !== '/channels'}
    >
      {rooms.length > 0 ? <SectionLabel count={rooms.length}>Team channels</SectionLabel> : null}
      {rooms.map(row)}
      {open.length > 0 ? <SectionLabel count={open.length}>Channels</SectionLabel> : null}
      {open.map(row)}
      {rooms.length + open.length === 0 ? (
        <p className="px-2 py-6 text-center text-[11.5px] text-[var(--fg-4)]">
          {q ? 'Nothing matches that.' : 'No channels yet.'}
        </p>
      ) : null}
    </ListPane>
  );
}
