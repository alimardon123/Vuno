'use client';

// The second column: a searchable, dense list. Chats, Channels, Work and
// Members all wear it, which is why it takes its rows as children rather than
// knowing what a row is.

import { useState } from 'react';
import { cn } from '@/lib/utils';

export function ListPane({
  title,
  action,
  searchPlaceholder,
  onSearch,
  children,
  width = 244,
  hideOnMobile = false,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
  children: React.ReactNode;
  width?: number;
  /**
   * A phone has room for one column, not three. When a conversation is open the
   * pane steps aside for it; the list is a page you came from, not a rail you
   * keep. Below `md` the pane is full width, so the list is readable rather
   * than a 90px sliver.
   */
  hideOnMobile?: boolean;
}) {
  const [q, setQ] = useState('');

  return (
    <aside
      className={cn(
        'shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface)]',
        'w-full md:w-[var(--pane-w)]',
        hideOnMobile ? 'hidden md:flex' : 'flex',
      )}
      style={{ '--pane-w': `${width}px` } as React.CSSProperties}
      aria-label={title}
    >
      <header className="flex items-center gap-1.5 px-3 pb-1.5 pt-2.5">
        <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.label}
            title={action.label}
            className="ml-auto grid size-[22px] place-items-center rounded-md text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        ) : null}
      </header>

      {onSearch ? (
        <div className="relative mx-2.5 mb-1.5">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)]"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          >
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); onSearch(e.target.value); }}
            placeholder={searchPlaceholder ?? 'Search…'}
            aria-label={searchPlaceholder ?? 'Search'}
            className={cn(
              'w-full rounded-md border border-[var(--line)] bg-[var(--bg)] py-[5px] pl-[26px] pr-2',
              'text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-4)]',
              'focus:border-line-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
            )}
          />
        </div>
      ) : null}

      <div className="scroll-y min-h-0 flex-1 px-1.5 pb-3">{children}</div>
    </aside>
  );
}

/**
 * One row. Deliberately 30px tall with a preview and a timestamp: the old
 * sidebar used 57px rows with a role subtitle and no preview, so you saw eleven
 * conversations and none of them told you whether they needed you.
 */
export function ListRow({
  href,
  active,
  leading,
  title,
  preview,
  meta,
  badge,
  unread,
}: {
  href: string;
  active?: boolean;
  leading?: React.ReactNode;
  title: string;
  preview?: string | null;
  meta?: React.ReactNode;
  badge?: number | null;
  unread?: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-[5px] transition-colors',
        active ? 'bg-[var(--select)] text-[var(--fg)]' : 'text-[var(--fg-2)] hover:bg-[var(--hover)]',
      )}
    >
      <span className="grid place-items-center text-[var(--fg-3)]">{leading}</span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'truncate text-[12.5px] leading-[1.35] tracking-[-0.005em]',
            active || unread ? 'font-semibold text-[var(--fg)]' : 'font-medium',
          )}
        >
          {title}
        </span>
        {preview ? <span className="truncate text-[11px] leading-[1.35] text-[var(--fg-3)]">{preview}</span> : null}
      </span>
      <span className="flex items-center gap-1.5">
        {meta ? <span className="tnum text-[10px] text-[var(--fg-4)]">{meta}</span> : null}
        {badge ? (
          <span className="tnum grid h-4 min-w-4 place-items-center rounded-full bg-[var(--falsified)] px-1 text-[10px] font-semibold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </span>
    </a>
  );
}
