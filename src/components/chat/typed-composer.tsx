// Vuno — Typed composer
// Per SCREENS.md §2: composer with a type dropdown
// (Message / Proposal / Objection / Evidence / Benchmark / Decision).
// v1: only Message is fully wired; the others render the structured form
// but are UI-only (no actual submit yet).

'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/app-store';
import { Send, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type ComposerType =
  | 'Message'
  | 'Proposal'
  | 'Objection'
  | 'Evidence'
  | 'Benchmark'
  | 'Decision';

const TYPES: ComposerType[] = [
  'Message',
  'Proposal',
  'Objection',
  'Evidence',
  'Benchmark',
  'Decision',
];

export function TypedComposer({ channelId }: { channelId: string }) {
  const [type, setType] = useState<ComposerType>('Message');
  const [submitting, setSubmitting] = useState(false);
  const [useRealLLM, setUseRealLLM] = useState(false);
  const { toast } = useToast();
  const bumpChatNonce = useAppStore((s) => s.bumpChatNonce);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Composer form state
  const [body, setBody] = useState('');
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalBody, setProposalBody] = useState('');
  const [claimText, setClaimText] = useState('');
  const [objSeverity, setObjSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState('');
  const [decisionChosen, setDecisionChosen] = useState('');
  const [decisionRationale, setDecisionRationale] = useState('');

  // Reset non-Message fields when type changes
  useEffect(() => {
    if (type !== 'Message') {
      // gentle reset for the relevant form's fields per type
      setProposalTitle('');
      setProposalBody('');
      setClaimText('');
      setObjSeverity('medium');
      setEvidenceLabel('');
      setEvidenceSummary('');
      setMetric('');
      setValue('');
      setUnit('');
      setTarget('');
      setDecisionChosen('');
      setDecisionRationale('');
    }
  }, [type]);

  async function postMessage(text: string) {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/messages?XTransformPort=3000&channelId=${encodeURIComponent(channelId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text, useRealLLM }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBody('');
      bumpChatNonce();
      toast({
        title: 'Message posted',
        description: 'Appended to the event spine as a MessagePosted event.',
      });
    } catch (e) {
      toast({
        title: 'Failed to post message',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function postTypedEvent(
    typedType: string,
    payload: Record<string, unknown>,
  ) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: typedType, payload, channelId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bumpChatNonce();
      toast({
        title: `${typedType} appended`,
        description: 'Added to the event spine. The chat projection will update shortly.',
      });
    } catch (e) {
      toast({
        title: `Failed to append ${typedType}`,
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function postDebate(title: string) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || undefined, useRealLLM: useRealLLM }),
      });
      const data = (await res.json()) as { ok: boolean; decisionId?: string; eventsAppended?: number; message?: string; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Debate failed');
      // Close any dialog/composer state first, then defer the chat refresh
      // to avoid the React 19 Dialog close race.
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (type === 'Message') {
      if (!body.trim()) return;
      void postMessage(body.trim());
      return;
    }
    // Proposal — triggers the full agent debate chain via /api/debate.
    // Per the user's direction: no separate "Run debate" button.
    // Filing a proposal IS how you start a debate — agents respond naturally.
    if (type === 'Proposal') {
      if (!proposalTitle.trim() || !proposalBody.trim()) return;
      // v1: the debate endpoint uses its own proposal title; the body field is
      // ignored by the simulated architect (it picks from a rotation). In v2
      // with real LLMs, the body will be passed through.
      void postDebate(`${proposalTitle.trim()} — ${proposalBody.trim().slice(0, 80)}`);
      setProposalTitle('');
      setProposalBody('');
      return;
    }
    // Non-Proposal typed events — POST to /api/events with the structured payload.
    if (type === 'Objection') {
      if (!claimText.trim()) return;
      void postTypedEvent('ObjectionRaised', {
        decisionId: 'dec-17',
        claimText: claimText.trim(),
        severity: objSeverity,
      });
      setClaimText('');
      return;
    }
    if (type === 'Evidence') {
      if (!evidenceLabel.trim() || !evidenceSummary.trim()) return;
      void postTypedEvent('EvidenceAttached', {
        decisionId: 'dec-17',
        evidenceType: 'paper',
        label: evidenceLabel.trim(),
        summary: evidenceSummary.trim(),
        supportsOrRefutes: 'neutral',
      });
      setEvidenceLabel('');
      setEvidenceSummary('');
      return;
    }
    if (type === 'Benchmark') {
      if (!metric.trim() || !value.trim() || !unit.trim() || !target.trim()) return;
      void postTypedEvent('BenchmarkReported', {
        experimentId: `exp-${Date.now().toString(36)}`,
        metric: metric.trim(),
        value: value.trim(),
        unit: unit.trim(),
        target: target.trim(),
        passed: Number(value) <= Number(target),
      });
      setMetric('');
      setValue('');
      setUnit('');
      setTarget('');
      return;
    }
    if (type === 'Decision') {
      if (!decisionChosen.trim() || !decisionRationale.trim()) return;
      void postTypedEvent('DecisionRecorded', {
        decisionId: 'dec-17',
        outcome: 'accepted',
        chosen: decisionChosen.trim(),
        rationale: decisionRationale.trim(),
        rejectedAlternatives: [],
      });
      setDecisionChosen('');
      setDecisionRationale('');
      return;
    }
  }

  const isMessage = type === 'Message';

  // Compute whether the current form has enough content to submit
  const hasContent = isMessage
    ? body.trim().length > 0
    : type === 'Proposal'
      ? proposalTitle.trim().length > 0 && proposalBody.trim().length > 0
      : type === 'Objection'
        ? claimText.trim().length > 0
        : type === 'Evidence'
          ? evidenceLabel.trim().length > 0 && evidenceSummary.trim().length > 0
          : type === 'Benchmark'
            ? metric.trim().length > 0 && value.trim().length > 0 && unit.trim().length > 0 && target.trim().length > 0
            : type === 'Decision'
              ? decisionChosen.trim().length > 0 && decisionRationale.trim().length > 0
              : false;

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-border/70 bg-background/95 supports-[backdrop-filter]:bg-background/60 backdrop-blur p-3"
      aria-label="Compose a message"
    >
      <div className="flex flex-col gap-2">
        {/* Textarea / typed form — full width on top */}
        {isMessage ? (
          <Textarea
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…  (⌘/Ctrl+Enter to send)"
            className="min-h-[3rem] resize-none leading-snug"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
          />
        ) : (
          <TypedForm
            type={type}
            proposalTitle={proposalTitle}
            setProposalTitle={setProposalTitle}
            proposalBody={proposalBody}
            setProposalBody={setProposalBody}
            claimText={claimText}
            setClaimText={setClaimText}
            objSeverity={objSeverity}
            setObjSeverity={setObjSeverity}
            evidenceLabel={evidenceLabel}
            setEvidenceLabel={setEvidenceLabel}
            evidenceSummary={evidenceSummary}
            setEvidenceSummary={setEvidenceSummary}
            metric={metric}
            setMetric={setMetric}
            value={value}
            setValue={setValue}
            unit={unit}
            setUnit={setUnit}
            target={target}
            setTarget={setTarget}
            decisionChosen={decisionChosen}
            setDecisionChosen={setDecisionChosen}
            decisionRationale={decisionRationale}
            setDecisionRationale={setDecisionRationale}
            useRealLLM={useRealLLM}
            setUseRealLLM={setUseRealLLM}
          />
        )}

        {/* Toolbar — type selector (left) + submit button (right) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Select
              value={type}
              onValueChange={(v) => setType(v as ComposerType)}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  'w-32 shrink-0 gap-1 font-medium',
                  !isMessage && 'bg-primary/10 text-primary border-primary/30',
                )}
                aria-label="Message type"
              >
                <SelectValue />
                <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Real LLM toggle — for Message (collaboration loop) + Proposal (debate) */}
            {(isMessage || type === 'Proposal') ? (
              <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={useRealLLM}
                  onChange={(e) => setUseRealLLM(e.target.checked)}
                  className="size-3 rounded border-border"
                />
                <span className="hidden sm:inline">Real LLM</span>
              </label>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !hasContent}
            className="shrink-0 shadow-sm transition-all hover:shadow-md hover:shadow-primary/20"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="size-3.5" aria-hidden />
            )}
            {isMessage ? 'Post' : type === 'Proposal' ? 'File proposal' : `Append ${type}`}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Per-type structured forms (UI-only for now) ──────────────────────────
interface TypedFormProps {
  type: Exclude<ComposerType, 'Message'>;
  proposalTitle: string;
  setProposalTitle: (v: string) => void;
  proposalBody: string;
  setProposalBody: (v: string) => void;
  claimText: string;
  setClaimText: (v: string) => void;
  objSeverity: 'low' | 'medium' | 'high';
  setObjSeverity: (v: 'low' | 'medium' | 'high') => void;
  evidenceLabel: string;
  setEvidenceLabel: (v: string) => void;
  evidenceSummary: string;
  setEvidenceSummary: (v: string) => void;
  metric: string;
  setMetric: (v: string) => void;
  value: string;
  setValue: (v: string) => void;
  unit: string;
  setUnit: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  decisionChosen: string;
  setDecisionChosen: (v: string) => void;
  decisionRationale: string;
  setDecisionRationale: (v: string) => void;
  useRealLLM?: boolean;
  setUseRealLLM?: (v: boolean) => void;
}

function TypedForm(props: TypedFormProps) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[0.625rem] uppercase tracking-widest text-muted-foreground">
        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary">{props.type}</span>
        {props.type === 'Proposal' ? (
          <span>· filing a proposal triggers the agent debate chain</span>
        ) : (
          <span>· appends to spine</span>
        )}
      </div>
      {/* Note: the useRealLLM toggle is now in the toolbar below the form */}
      <div className="grid gap-2">
        {props.type === 'Proposal' ? (
          <>
            <Field label="Title">
              <Input
                value={props.proposalTitle}
                onChange={(e) => props.setProposalTitle(e.target.value)}
                placeholder="Architecture: …"
              />
            </Field>
            <Field label="Proposal body">
              <Textarea
                value={props.proposalBody}
                onChange={(e) => props.setProposalBody(e.target.value)}
                placeholder="Describe the proposal…"
                className="min-h-[5rem] resize-none"
              />
            </Field>
          </>
        ) : null}

        {props.type === 'Objection' ? (
          <>
            <Field label="Claim text">
              <Textarea
                value={props.claimText}
                onChange={(e) => props.setClaimText(e.target.value)}
                placeholder="State the claim you object to…"
                className="min-h-[4rem] resize-none"
              />
            </Field>
            <Field label="Severity">
              <Select
                value={props.objSeverity}
                onValueChange={(v) =>
                  props.setObjSeverity(v as 'low' | 'medium' | 'high')
                }
              >
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : null}

        {props.type === 'Evidence' ? (
          <>
            <Field label="Label">
              <Input
                value={props.evidenceLabel}
                onChange={(e) => props.setEvidenceLabel(e.target.value)}
                placeholder="e.g. 'RocksDB p99 benchmark'"
              />
            </Field>
            <Field label="Summary">
              <Textarea
                value={props.evidenceSummary}
                onChange={(e) => props.setEvidenceSummary(e.target.value)}
                placeholder="What does this evidence say?"
                className="min-h-[4rem] resize-none"
              />
            </Field>
          </>
        ) : null}

        {props.type === 'Benchmark' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Metric">
              <Input
                value={props.metric}
                onChange={(e) => props.setMetric(e.target.value)}
                placeholder="p99 read latency"
              />
            </Field>
            <Field label="Value">
              <Input
                value={props.value}
                onChange={(e) => props.setValue(e.target.value)}
                placeholder="142"
              />
            </Field>
            <Field label="Unit">
              <Input
                value={props.unit}
                onChange={(e) => props.setUnit(e.target.value)}
                placeholder="ms"
              />
            </Field>
            <Field label="Target">
              <Input
                value={props.target}
                onChange={(e) => props.setTarget(e.target.value)}
                placeholder="50"
              />
            </Field>
          </div>
        ) : null}

        {props.type === 'Decision' ? (
          <>
            <Field label="Chosen">
              <Input
                value={props.decisionChosen}
                onChange={(e) => props.setDecisionChosen(e.target.value)}
                placeholder="Mmap-based LSM with bloom filters"
              />
            </Field>
            <Field label="Rationale">
              <Textarea
                value={props.decisionRationale}
                onChange={(e) => props.setDecisionRationale(e.target.value)}
                placeholder="Why this option…"
                className="min-h-[4rem] resize-none"
              />
            </Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
