'use client';

// Theme is a per-viewer preference applied to <html> before paint by the
// bootstrap script in the root layout, so there is no flash on load.
//
// The menu holds no state for *which* theme is active: it is already on the
// root element, so CSS reads it directly. That avoids both the hydration
// mismatch of reading the DOM during render and the effect-then-setState dance
// of syncing it into React.

import { useEffect, useRef, useState } from 'react';

const THEMES = [
  { id: 'ink', label: 'Ink', hint: 'Deep neutral' },
  { id: 'paper', label: 'Paper', hint: 'Light neutral' },
  { id: 'warm', label: 'Warm', hint: 'Cream and gold' },
] as const;

export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // Escape closes it and puts focus back where it came from. Without this a
  // keyboard user who opens the menu has no way out of it but to pick a theme.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function apply(next: string) {
    setOpen(false);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('vuno-theme', next);
    } catch {
      // Site data blocked: the viewer simply gets the default again next visit.
    }
  }

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme"
        className="grid size-[34px] place-items-center rounded-lg text-[var(--rail-fg)] transition-colors hover:bg-white/[0.07] hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
        </svg>
        <span className="sr-only">Theme</span>
      </button>

      {open ? (
        <>
          {/* Click-outside only. It is not a focus stop: tabbing into the menu
              used to land on this invisible button before any theme. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute bottom-0 left-full z-50 ml-2 w-40 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--raised)] py-1 shadow-xl"
          >
            {THEMES.map((t) => (
              <button
                key={t.id}
                role="menuitem"
                data-theme-option={t.id}
                onClick={() => apply(t.id)}
                className="theme-option flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--hover)]"
              >
                <span className="theme-dot size-2 shrink-0 rounded-full border border-[var(--line-2)]" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] text-[var(--fg-2)]">{t.label}</span>
                  <span className="text-[10px] text-[var(--fg-4)]">{t.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
