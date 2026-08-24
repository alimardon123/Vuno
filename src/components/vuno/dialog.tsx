'use client';

// A modal, kept small on purpose: a form and its errors.
//
// It closes on Escape and on a click outside, it puts focus in the first field
// and returns it where it came from, and it traps Tab — a dialog you can Tab
// out of leaves you editing the page behind it.

import { cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';

export function Dialog({
  title,
  hint,
  onClose,
  children,
  footer,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-dismiss])',
    );
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;

      const stops = [...panel.current.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute('disabled'));
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/45"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-[26rem] rounded-xl border border-[var(--line)] bg-[var(--raised)] shadow-2xl"
      >
        <header className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-[13.5px] font-semibold tracking-[-0.012em]">{title}</h2>
          {hint ? <p className="mt-0.5 text-[11.5px] leading-[1.5] text-[var(--fg-3)]">{hint}</p> : null}
        </header>
        <div className="flex flex-col gap-3 px-4 py-3.5">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A labelled field.
 *
 * The hint sits outside the label and is attached with `aria-describedby`. It
 * used to be nested inside it, which made the field's accessible name "Password
 * At least 8 characters" — a screen reader read the hint as part of the name,
 * and nothing could address the field by what it is called.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  // The control is cloned so the label and hint can point at it, rather than
  // every caller having to remember to pass an id and an aria-describedby.
  const control =
    isValidElement(children) && hint
      ? cloneElement(children as React.ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
          id,
          'aria-describedby': hintId,
        })
      : isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] font-medium text-[var(--fg-2)]">
        {label}
      </label>
      {control}
      {hint ? (
        <span id={hintId} className="text-[10.5px] leading-[1.45] text-[var(--fg-4)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export const inputClass = cn(
  'w-full rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-[6px]',
  'text-[12.5px] text-[var(--fg)] placeholder:text-[var(--fg-4)]',
  'focus:border-[var(--line-2)] focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
);

export function Button({
  variant = 'ghost',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        variant === 'primary' && 'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90',
        variant === 'ghost' &&
          'border border-[var(--line)] text-[var(--fg-2)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
        variant === 'danger' && 'border border-[var(--falsified)] text-[var(--falsified)] hover:bg-[var(--falsified-bg)]',
        props.disabled && 'cursor-not-allowed opacity-40',
        props.className,
      )}
    />
  );
}

/** What went wrong, where you can see it while fixing it. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-[var(--falsified)] bg-[var(--falsified-bg)] px-2.5 py-1.5 text-[11.5px] leading-[1.5] text-[var(--falsified)]"
    >
      {message}
    </p>
  );
}
