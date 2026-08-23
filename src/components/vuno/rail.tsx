'use client';

// Vuno — the app rail.
//
// Six destinations, and the test every future feature has to pass: if it needs a
// seventh, it probably belongs inside one that already exists
// (docs/IA-NAVIGATION.md).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeMenu } from '@/components/vuno/theme-menu';

const TABS = [
  { href: '/activity', label: 'Activity', hint: 'What needs you', icon: ActivityIcon },
  { href: '/chats', label: 'Chats', hint: 'Direct and group messages', icon: ChatIcon },
  { href: '/channels', label: 'Channels', hint: 'Team and project channels', icon: HashIcon },
  { href: '/work', label: 'Work', hint: 'Objectives, products, experiments', icon: WorkIcon },
  { href: '/members', label: 'Members', hint: 'People and agents', icon: MembersIcon },
  { href: '/ledger', label: 'Ledger', hint: 'What the org believes', icon: LedgerIcon },
] as const;

export function Rail({ ownerName }: { ownerName: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="flex w-[52px] shrink-0 flex-col items-center gap-0.5 bg-[var(--rail)] py-2"
    >
      <Link
        href="/activity"
        aria-label="Vuno — home"
        className="mb-2.5 grid size-[26px] place-items-center rounded-[7px]"
        style={{ background: 'linear-gradient(148deg,#E8EBEE 0%,#E8EBEE 48%,#7C8792 48%,#7C8792 100%)' }}
      />

      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            title={`${tab.label} — ${tab.hint}`}
            className={cn(
              'group relative grid size-[38px] place-items-center rounded-lg transition-colors',
              active
                ? 'bg-white/[0.11] text-white'
                : 'text-[var(--rail-fg)] hover:bg-white/[0.07] hover:text-white',
            )}
          >
            {active ? (
              <span className="absolute -left-[7px] top-[10px] h-[18px] w-[3px] rounded-r-[3px] bg-white" aria-hidden />
            ) : null}
            <Icon />
            <span className="sr-only">{tab.label}</span>
            <span
              className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-[var(--line)] bg-[var(--raised)] px-2 py-1 text-[11px] text-[var(--fg)] shadow-lg group-hover:block"
              role="tooltip"
            >
              {tab.label}
            </span>
          </Link>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1">
        <ThemeMenu />
        <span
          className="grid size-[26px] place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-white"
          title={ownerName}
        >
          {ownerName.slice(0, 1).toUpperCase()}
        </span>
      </div>
    </nav>
  );
}

const S = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function ActivityIcon() { return <svg {...S}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>; }
function ChatIcon() { return <svg {...S}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l2-4a8.4 8.4 0 0 1 7-12.4 8.4 8.4 0 0 1 9 7z" /></svg>; }
function HashIcon() { return <svg {...S}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>; }
function WorkIcon() { return <svg {...S}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>; }
function MembersIcon() { return <svg {...S}><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3.2" /><path d="M22 20v-1.5a4 4 0 0 0-3-3.85" /><path d="M16 3.6a4 4 0 0 1 0 7.75" /></svg>; }
function LedgerIcon() { return <svg {...S}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M9 8h7M9 12h5" /></svg>; }
