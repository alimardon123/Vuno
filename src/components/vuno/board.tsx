'use client';

// The board.
//
// Two ways to move a card, deliberately. Dragging is what a mouse expects and
// it is the reason people ask for a board at all. But HTML5 drag-and-drop is
// invisible to a keyboard and to a screen reader, and "keyboard-operable" is in
// the definition of done — so every card also carries a menu that moves it, and
// the menu is the primary control rather than the accessibility afterthought:
// it names the destinations, which dragging never does.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { RelativeTime } from '@/components/vuno/primitives';
import type { BoardCard, BoardColumn } from '@/lib/work/board';

export function Board({ columns }: { columns: BoardColumn[] }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const destinations = columns.map((c) => ({ stage: c.stage, label: c.label, implemented: c.implemented }));

  async function move(objectiveId: string, to: string, from: string) {
    if (to === from) return;
    setBusy(objectiveId);
    try {
      const res = await fetch('/api/objectives/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectiveId, to }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');
      router.refresh();
      const label = destinations.find((d) => d.stage === to)?.label ?? to;
      toast({ title: `Moved to ${label}`, description: 'The orchestrator picks it up from there.' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    } finally {
      setBusy(null);
      setMenuFor(null);
    }
  }

  return (
    // The board scrolls sideways in its own box. The page never does.
    <div className="scroll-x flex min-h-0 flex-1 gap-2.5 p-4">
      {columns.map((col) => (
        <section
          key={col.stage}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(col.stage);
          }}
          onDragLeave={() => setOver((s) => (s === col.stage ? null : s))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData('text/plain');
            const card = columns.flatMap((c) => c.cards).find((c) => c.id === id);
            if (card) void move(id, col.stage, card.stage);
          }}
          className={cn(
            'flex w-[17.5rem] shrink-0 flex-col rounded-xl border bg-[var(--surface)] transition-colors',
            over === col.stage ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]',
          )}
        >
          <header className="flex items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
            <h2 className="text-[11.5px] font-semibold tracking-[-0.005em] text-[var(--fg)]">{col.label}</h2>
            <span className="tnum text-[10.5px] text-[var(--fg-4)]">{col.cards.length}</span>
            {/* Said once per column rather than on every card: a stage nothing
                can run yet is a property of the column. */}
            {!col.implemented && col.stage !== 'shipped' && col.stage !== 'killed' ? (
              <span
                className="ml-auto shrink-0 rounded-[3px] border border-dashed border-line-2 px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[var(--fg-4)]"
                title="Designed in ADR-0007, not built. An objective moved here would stop."
              >
                Not built
              </span>
            ) : null}
          </header>

          <p className="px-3 pb-1.5 pt-1.5 text-[10.5px] leading-[1.45] text-[var(--fg-4)]">{col.description}</p>

          <div className="scroll-y flex min-h-[3rem] flex-1 flex-col gap-1.5 px-2 pb-2">
            {col.cards.map((card) => (
              <Card
                key={card.id}
                card={card}
                busy={busy === card.id}
                dragging={dragging === card.id}
                menuOpen={menuFor === card.id}
                destinations={destinations}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', card.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(card.id);
                }}
                onDragEnd={() => setDragging(null)}
                onToggleMenu={() => setMenuFor((v) => (v === card.id ? null : card.id))}
                onMove={(to) => void move(card.id, to, card.stage)}
              />
            ))}
            {col.cards.length === 0 ? (
              <p className="px-1 py-3 text-center text-[10.5px] text-[var(--fg-4)]">Nothing here</p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function Card({
  card,
  busy,
  dragging,
  menuOpen,
  destinations,
  onDragStart,
  onDragEnd,
  onToggleMenu,
  onMove,
}: {
  card: BoardCard;
  busy: boolean;
  dragging: boolean;
  menuOpen: boolean;
  destinations: Array<{ stage: string; label: string; implemented: boolean }>;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onToggleMenu: () => void;
  onMove: (to: string) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'relative rounded-lg border border-[var(--line)] bg-[var(--raised)] p-2 transition-opacity',
        dragging && 'opacity-40',
        busy && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-1.5">
        <h3 className="min-w-0 flex-1 text-[12px] font-semibold leading-[1.35] tracking-[-0.006em] text-[var(--fg)]">
          {card.title}
        </h3>
        <button
          type="button"
          onClick={onToggleMenu}
          disabled={busy}
          aria-expanded={menuOpen}
          aria-label={`Move ${card.title}`}
          className="grid size-5 shrink-0 place-items-center rounded text-[var(--fg-4)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
      </div>

      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-[1.45] text-[var(--fg-3)]">{card.successCriteria}</p>

      {card.blocked.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {card.blocked.map((g) => (
            <li
              key={g.name}
              className="rounded-[4px] border border-falsified bg-[var(--falsified-bg)] px-1.5 py-1 text-[10px] leading-[1.4] text-[var(--falsified)]"
            >
              <span className="font-semibold uppercase tracking-[0.05em]">{g.name} blocked</span>
              {g.reason ? <span className="ml-1 opacity-90">{g.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--fg-4)]">
        {card.running > 0 ? (
          <span className="text-[var(--tested)]">{card.running} running</span>
        ) : card.pending > 0 ? (
          <span className="text-[var(--asserted)]">{card.pending} queued</span>
        ) : null}
        {card.owningDepartment ? <span>{card.owningDepartment}</span> : null}
        <span className="tnum ml-auto">
          here <RelativeTime value={card.stageEnteredAt} />
        </span>
      </div>

      {menuOpen ? (
        <div
          ref={menu}
          role="menu"
          aria-label={`Move ${card.title} to`}
          className="absolute right-1 top-7 z-20 w-[12.5rem] overflow-hidden rounded-lg border border-line-2 bg-[var(--raised)] py-1 shadow-lg"
        >
          {destinations.map((d) => {
            const here = d.stage === card.stage;
            const dead = !d.implemented && d.stage !== 'shipped' && d.stage !== 'killed';
            return (
              <button
                key={d.stage}
                type="button"
                role="menuitem"
                disabled={here || dead}
                onClick={() => onMove(d.stage)}
                title={dead ? 'That stage is designed but not built — an objective moved there would stop.' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11.5px] transition-colors',
                  here
                    ? 'font-semibold text-[var(--fg)]'
                    : dead
                      ? 'cursor-not-allowed text-[var(--fg-4)]'
                      : 'text-[var(--fg-2)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
                )}
              >
                {d.label}
                {here ? <span className="ml-auto text-[10px] text-[var(--fg-4)]">here</span> : null}
                {dead ? <span className="ml-auto text-[10px]">not built</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
