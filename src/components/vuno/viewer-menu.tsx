'use client';

import Link from 'next/link';

// Who you are signed in as, and the way out.
//
// It sits where the avatar used to, which showed the org owner's initial to
// everyone because there was only ever one viewer.

import { useEffect, useRef, useState } from 'react';
import { initialsOf } from '@/components/vuno/primitives';

export function ViewerMenu({ viewer }: { viewer: { displayName: string; handle: string } }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

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

  async function signOut() {
    setBusy(true);
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign_out' }),
    }).catch(() => null);
    // A full navigation, so the cleared cookie is on the next request.
    window.location.href = '/sign-in';
  }

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${viewer.displayName} — @${viewer.handle}`}
        className="grid size-[26px] place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-white transition-colors hover:bg-white/20"
      >
        {initialsOf(viewer.displayName)}
        <span className="sr-only">{viewer.displayName}</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute bottom-0 left-full z-50 ml-2 w-48 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--raised)] py-1 shadow-xl"
          >
            <div className="border-b border-[var(--line)] px-2.5 pb-1.5 pt-1">
              <p className="truncate text-[12px] font-medium text-[var(--fg)]">{viewer.displayName}</p>
              <p className="truncate text-[10.5px] text-[var(--fg-4)]">@{viewer.handle}</p>
            </div>
            {/* Settings hangs here rather than on the rail: skills, plugins and
                connectors configure the members the org already has, which is
                administrative and rare. Extensions — a whole feature added to
                the org — is the one that earned a destination. */}
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block w-full px-2.5 py-1.5 text-left text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
            >
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void signOut()}
              className="w-full px-2.5 py-1.5 text-left text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-50"
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
