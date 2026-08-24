'use client';

import { useRef, useState } from 'react';
import { Button, Field, FormError, inputClass } from '@/components/vuno/dialog';

export function SignInForm({
  firstRun,
  hasOrg,
  next,
  ownerEmail,
  ownerName,
}: {
  firstRun: boolean;
  hasOrg: boolean;
  next: string;
  ownerEmail: string | null;
  ownerName: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the busy flag: React state is not updated synchronously, so two
  // handlers firing in the same tick both read `busy === false` and both post.
  // The second claim then fails with "already claimed" and clobbers the first
  // one's redirect.
  const inFlight = useRef(false);

  if (!hasOrg) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-4">
        <p className="text-[13px] font-semibold">No organisation yet</p>
        <p className="mt-1 text-[12px] leading-[1.55] text-[var(--fg-3)]">
          Run <code className="rounded-[3px] bg-[var(--sunken)] px-1 py-px font-mono text-[11.5px]">bun run setup</code>{' '}
          to create one, then reload this page.
        </p>
      </div>
    );
  }

  async function submit() {
    if (inFlight.current) return;
    if (firstRun && password !== confirm) {
      setError('Those two do not match.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          firstRun ? { action: 'claim', password } : { action: 'sign_in', email, password },
        ),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'That did not work.');
      // A full navigation, so the new cookie is on the request that renders the app.
      window.location.href = next.startsWith('/') ? next : '/activity';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h1 className="text-[14px] font-semibold tracking-[-0.012em]">
          {firstRun ? 'Set a password' : 'Sign in'}
        </h1>
        <p className="mt-0.5 text-[11.5px] leading-[1.5] text-[var(--fg-3)]">
          {firstRun
            ? 'Nobody can sign in to this org yet. This claims the owner account — it is the only thing between the org and anyone who can reach this port.'
            : 'Only members of this org can read it.'}
        </p>
      </div>

      <FormError message={error} />

      {firstRun ? (
        // Read-only, and a username field: a password form without one gives a
        // password manager nothing to save the credential against.
        <Field label="Account" hint={ownerName ? `The org owner, ${ownerName}.` : undefined}>
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            readOnly
            value={ownerEmail ?? ''}
          />
        </Field>
      ) : (
        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="kai@acme.storage"
          />
        </Field>
      )}

      <Field label="Password" hint={firstRun ? 'At least 8 characters.' : undefined}>
        <input
          className={inputClass}
          type="password"
          autoComplete={firstRun ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {firstRun ? (
        <Field label="Again">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        className="mt-0.5 w-full py-1.5"
        disabled={busy || !password || (!firstRun && !email) || (firstRun && !confirm)}
      >
        {busy ? 'Just a moment…' : firstRun ? 'Set it and continue' : 'Sign in'}
      </Button>
    </form>
  );
}
