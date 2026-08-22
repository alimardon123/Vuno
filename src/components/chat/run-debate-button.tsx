// Vuno — Run debate button
// Triggers a fresh simulated falsification arc via POST /api/debate.
// Per the live-debate-slice goal: makes the killer demo interactive.

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/app-store';
import { Play, Loader2, Sparkles } from 'lucide-react';

interface DebateResponse {
  ok: boolean;
  decisionId?: string;
  eventsAppended?: number;
  message?: string;
  error?: string;
}

export function RunDebateButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { bumpChatNonce } = useAppStore();

  async function handleRun() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || undefined,
        }),
      });
      const data = (await res.json()) as DebateResponse;
      if (!data.ok) {
        throw new Error(data.error ?? 'Debate failed');
      }
      // Close the dialog FIRST, then bump the nonce on the next tick.
      // This avoids a React 19 race where Dialog unmount + state update happen
      // in the same commit and can cause a client-side exception.
      setOpen(false);
      setTitle('');
      // Defer the chat refresh so the Dialog unmount completes first.
      setTimeout(() => {
        bumpChatNonce();
        toast({
          title: 'Debate completed',
          description: data.message,
        });
      }, 0);
    } catch (e) {
      toast({
        title: 'Debate failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="default"
        size="sm"
        className="gap-1.5 shadow-sm transition-all hover:shadow-md hover:shadow-primary/20"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5" aria-hidden />
        Run debate
      </Button>

      <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run a simulated debate</DialogTitle>
            <DialogDescription>
              Triggers a fresh falsification arc end-to-end. The simulated
              agents will: file a proposal, raise an objection, run a
              benchmark, falsify the claim, and block the release gate. All
              events append to the spine and appear in the chat in real time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="debate-title" className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              Proposal title (optional)
            </Label>
            <Input
              id="debate-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Architecture: …"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to let the architect pick from a rotation of
              proposals.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRun}
              disabled={submitting}
              className="gap-1.5"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
              {submitting ? 'Running…' : 'Run debate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
