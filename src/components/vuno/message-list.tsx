'use client';

// The message stream. Consecutive messages from the same member within five
// minutes collapse into one block — the pattern every chat app uses, and the
// reason a dense list still reads as a conversation.

import { Fragment, useState } from 'react';
import { Avatar, MemberName, RelativeTime, StatusPill, type ClaimStatus } from '@/components/vuno/primitives';
import { MessageBody } from '@/components/vuno/message-body';
import { InlineEditor, MessageToolbar, Reactions } from '@/components/vuno/message-actions';
import type { ConversationMessage } from '@/lib/conversations';
import { cn } from '@/lib/utils';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Event types that read as a record rather than as chatter. */
const RECORD_LABEL: Record<string, string> = {
  ProposalOpened: 'Proposal',
  ObjectionRaised: 'Objection',
  EvidenceAttached: 'Evidence',
  BenchmarkReported: 'Benchmark',
  ExperimentRequested: 'Experiment requested',
  ExperimentCompleted: 'Experiment complete',
  RiskFlagged: 'Risk',
  DecisionRecorded: 'Decision',
  ClaimStatusChanged: 'Claim status',
  GateBlocked: 'Gate blocked',
  GatePassed: 'Gate passed',
  GateEvaluated: 'Gate evaluated',
  ObjectiveFiled: 'Objective filed',
  RequirementStated: 'Requirement',
  RoleAssigned: 'Assignment',
  AgentThought: 'Thinking',
};

/** What counts as somebody saying something, rather than a record of an event. */
const SAID = new Set(['MessagePosted', 'ThreadReplyPosted']);

export function MessageList({
  messages,
  conversationId,
  viewerId,
  onReply,
}: {
  messages: ConversationMessage[];
  conversationId: string;
  /** Whose messages carry an edit and a delete. */
  viewerId: string;
  onReply: (m: ConversationMessage) => void;
}) {
  // Day boundaries and grouping are derived up front rather than accumulated
  // while rendering — a render pass that mutates as it goes is the kind of
  // thing that works until it is rendered twice.
  const rows = messages.map((m, i) => {
    const prev = messages[i - 1];
    const showDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
    const grouped =
      !showDay &&
      prev != null &&
      prev.author?.id === m.author?.id &&
      prev.isSystem === m.isSystem &&
      // A restricted event keeps its own header, because the header is where
      // the badge that says so lives. Folded into the group above it, a
      // private thought would render as an ordinary line of the conversation.
      prev.restrictedTo === m.restrictedTo &&
      !m.restrictedTo &&
      !RECORD_LABEL[m.type] &&
      !RECORD_LABEL[prev.type] &&
      // A reply keeps its own header, because the line quoting what it answers
      // is part of the header. Folded in, it would read as a continuation of
      // the message above rather than an answer to one somewhere else.
      !m.replyTo &&
      // Same for a message somebody pinned or deleted: both carry a mark that
      // belongs to that message alone.
      !m.pinned &&
      !prev.pinned &&
      !m.redacted &&
      new Date(m.at).getTime() - new Date(prev.at).getTime() < GROUP_WINDOW_MS;
    return { m, showDay, grouped };
  });

  return (
    <div className="flex flex-col pb-2">
      {rows.map(({ m, showDay, grouped }) => (
        <Fragment key={m.id}>
          {showDay ? <DayDivider date={m.at} /> : null}
          <MessageRow
            message={m}
            grouped={grouped}
            conversationId={conversationId}
            viewerId={viewerId}
            onReply={onReply}
          />
        </Fragment>
      ))}
    </div>
  );
}

function DayDivider({ date }: { date: string }) {
  const d = new Date(date);
  const today = new Date().toDateString() === d.toDateString();
  const label = today
    ? 'Today'
    : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <div className="my-2 flex items-center gap-2.5 px-4">
      <span className="h-px flex-1 bg-[var(--line)]" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--fg-4)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}

function MessageRow({
  message: m,
  grouped,
  conversationId,
  viewerId,
  onReply,
}: {
  message: ConversationMessage;
  grouped: boolean;
  conversationId: string;
  viewerId: string;
  onReply: (m: ConversationMessage) => void;
}) {
  const [editing, setEditing] = useState(false);
  const label = RECORD_LABEL[m.type];
  const name = m.isSystem ? 'Vuno' : (m.author?.displayName ?? 'Unknown');
  const kind = m.author?.kind === 'agent' ? 'agent' : 'human';
  // Only what somebody actually said can be acted on. A gate verdict is a
  // record of something that happened; reacting to it is not a thing.
  const actionable = !m.isSystem && !m.redacted && (m.type === 'MessagePosted' || m.type === 'ThreadReplyPosted');

  return (
    <article
      id={`m-${m.id}`}
      className={cn(
        'group relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-2.5 px-4 transition-colors hover:bg-[var(--hover)]',
        grouped ? 'py-px' : 'pb-0.5 pt-1.5',
        m.pinned && 'bg-[var(--asserted-bg)]/25',
      )}
    >
      {actionable ? (
        <MessageToolbar
          on={{
            channelId: conversationId,
            targetEventId: m.id,
            mine: m.author?.id === viewerId,
            pinned: m.pinned,
            body: m.body,
          }}
          onReply={() => onReply(m)}
          onEdit={() => setEditing(true)}
        />
      ) : null}
      <div className="pt-[3px]">
        {grouped ? (
          <span className="block text-[9px] leading-[18px] text-transparent group-hover:text-[var(--fg-4)] tnum">
            {new Date(m.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <Avatar name={name} kind={m.isSystem ? 'agent' : kind} size="md" />
        )}
      </div>

      <div className="min-w-0">
        {!grouped ? (
          <div className="mb-px flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <MemberName
              name={name}
              kind={kind}
              chip={
                m.isSystem
                  ? 'system'
                  : m.author?.ownerName
                    ? `${m.author.ownerName}'s assistant`
                    : (m.author?.role ?? null)
              }
            />
            {/* Authority marks the action, not the name — the assistant still
                renders as itself (ADR-0009 §1). */}
            {m.onBehalfOf ? (
              <span className="rounded-[4px] bg-[var(--asserted-bg)] px-1 py-px text-[10px] font-semibold text-[var(--asserted)]">
                with {m.onBehalfOf.displayName}&rsquo;s authority
              </span>
            ) : null}
            {label ? (
              <span className="rounded-[3px] bg-[var(--sunken)] px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.05em] text-[var(--fg-3)]">
                {label}
              </span>
            ) : null}
            {/* You are reading something the rest of the room is not. Without
                saying so, a private thought looks like a thing that was said
                out loud, and you would reply to it as though it had been. */}
            {m.restrictedTo ? (
              <span
                className="rounded-[3px] border border-dashed border-line-2 px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.05em] text-[var(--fg-4)]"
                title={
                  m.restrictedTo === 'private'
                    ? 'Only you and its author can see this'
                    : 'Only this team can see this'
                }
              >
                {m.restrictedTo === 'private' ? 'Not shared' : 'Team only'}
              </span>
            ) : null}
            <time className="tnum text-[10.5px] text-[var(--fg-4)]" dateTime={m.at}>
              <RelativeTime value={m.at} />
            </time>
          </div>
        ) : null}

        {/* What a reply is answering, quoted and clickable. A reply with no
            context is a sentence about something three screens up. */}
        {m.replyTo ? (
          <a
            href={`#m-${m.replyTo.id}`}
            className="mb-0.5 flex max-w-[62ch] items-baseline gap-1.5 rounded-[3px] border-l-2 border-line-2 py-px pl-2 text-[11px] text-[var(--fg-4)] transition-colors hover:border-[var(--accent)] hover:text-[var(--fg-3)]"
          >
            <span className="shrink-0 font-semibold text-[var(--fg-3)]">{m.replyTo.author}</span>
            <span className="truncate">{m.replyTo.body || 'a message'}</span>
          </a>
        ) : null}

        {m.pinned ? (
          <span className="mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--asserted)]">
            Pinned
          </span>
        ) : null}

        {m.redacted ? (
          // The row keeps its place so replies still make sense, and says
          // plainly that something was here rather than leaving a gap.
          <p className="text-[12.5px] italic text-[var(--fg-4)]">This message was deleted.</p>
        ) : editing ? (
          <InlineEditor
            channelId={conversationId}
            targetEventId={m.id}
            initial={m.body}
            onDone={() => setEditing(false)}
          />
        ) : m.body || m.attachments.length > 0 ? (
          <>
            <MessageBody body={m.body} attachments={m.attachments} className="max-w-[78ch] break-words" />
            {m.editedAt ? (
              <span className="ml-1 align-baseline text-[10px] text-[var(--fg-4)]" title={`Edited ${new Date(m.editedAt).toLocaleString()}`}>
                (edited)
              </span>
            ) : null}
          </>
        ) : null}

        <Reactions reactions={m.reactions} channelId={conversationId} targetEventId={m.id} />

        <RecordCard message={m} />
      </div>
    </article>
  );
}

/** Typed events render the record inline, where the conversation is. */
function RecordCard({ message: m }: { message: ConversationMessage }) {
  const p = m.payload;

  if (m.type === 'ClaimStatusChanged' && typeof p.to === 'string') {
    return (
      <Card id={typeof p.claimId === 'string' ? p.claimId : undefined} kicker="Claim status">
        <div className="flex flex-wrap items-center gap-1.5">
          {typeof p.from === 'string' ? (
            <span className="rounded-[3px] bg-[var(--sunken)] px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[var(--fg-4)]">
              {p.from}
            </span>
          ) : null}
          <span className="text-[10px] text-[var(--fg-4)]" aria-hidden>→</span>
          <StatusPill status={p.to as ClaimStatus} />
        </div>
        {typeof p.reason === 'string' ? (
          <p className="text-[12px] leading-[1.5] text-[var(--fg-2)]">{p.reason}</p>
        ) : null}
      </Card>
    );
  }

  if (m.type === 'BenchmarkReported') {
    const value = typeof p.value === 'number' ? p.value : null;
    const target = typeof p.target === 'number' ? p.target : null;
    const missed = value !== null && target !== null && value > target;
    return (
      <Card kicker="Benchmark">
        <div className="flex items-baseline gap-2 font-mono">
          <span className={cn('text-[17px] font-semibold tracking-[-0.02em]', missed ? 'text-[var(--falsified)]' : 'text-[var(--tested)]')}>
            {value ?? '—'}
            {typeof p.unit === 'string' ? p.unit : ''}
          </span>
          {target !== null ? (
            <span className="text-[11px] text-[var(--fg-3)]">
              {typeof p.metric === 'string' ? `${p.metric} · ` : ''}target {target}
              {typeof p.unit === 'string' ? p.unit : ''}
            </span>
          ) : null}
        </div>
      </Card>
    );
  }

  if (m.type === 'GateBlocked' || m.type === 'GatePassed') {
    const blocked = m.type === 'GateBlocked';
    return (
      <Card kicker={`${typeof p.name === 'string' ? p.name : 'gate'} gate`} tone={blocked ? 'blocked' : 'passed'}>
        {typeof p.reason === 'string' ? (
          <p className="text-[12px] leading-[1.5] text-[var(--fg-2)]">{p.reason}</p>
        ) : (
          <p className="text-[12px] text-[var(--tested)]">Passed.</p>
        )}
      </Card>
    );
  }

  if (m.type === 'ObjectiveFiled' && typeof p.title === 'string') {
    return (
      <Card kicker="Objective">
        <p className="text-[13px] font-semibold text-[var(--fg)]">{p.title}</p>
        {typeof p.successCriteria === 'string' ? (
          <p className="font-mono text-[11px] text-[var(--fg-2)]">{p.successCriteria}</p>
        ) : null}
      </Card>
    );
  }

  // Reasoning an agent kept to itself. It renders at all only because
  // `Event.visibility` is enforced now — before, a thought was either posted to
  // the whole channel or, since nothing drew it, silently blank.
  if (m.type === 'AgentThought' && typeof p.content === 'string') {
    return (
      <Card kicker={typeof p.topic === 'string' ? p.topic : 'thought'}>
        {typeof p.thoughtType === 'string' ? (
          <span className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-[var(--fg-4)]">{p.thoughtType}</span>
        ) : null}
        <p className="text-[12px] leading-[1.5] text-[var(--fg-2)]">{p.content}</p>
      </Card>
    );
  }

  if (m.type === 'ProposalOpened' && typeof p.title === 'string') {
    return (
      <Card kicker="Proposal">
        <p className="text-[13px] font-semibold text-[var(--fg)]">{p.title}</p>
        {typeof p.body === 'string' ? <p className="text-[12px] leading-[1.5] text-[var(--fg-2)]">{p.body}</p> : null}
      </Card>
    );
  }

  return null;
}

function Card({
  kicker,
  id,
  tone,
  children,
}: {
  kicker: string;
  id?: string;
  tone?: 'blocked' | 'passed';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-1.5 max-w-[34rem] overflow-hidden rounded-lg border bg-[var(--surface)]',
        tone === 'blocked' ? 'border-l-2 border-l-[var(--falsified)] border-[var(--line)]'
          : tone === 'passed' ? 'border-l-2 border-l-[var(--tested)] border-[var(--line)]'
            : 'border-[var(--line)]',
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--fg-3)]">{kicker}</span>
        {id ? <span className="ml-auto font-mono text-[9.5px] text-[var(--fg-4)]">{id.slice(0, 14)}</span> : null}
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 py-2">{children}</div>
    </div>
  );
}
