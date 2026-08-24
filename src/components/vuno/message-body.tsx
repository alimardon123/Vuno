'use client';

// What a message looks like once it is sent.
//
// Markdown, because it is what people already type and what every chat app has
// converged on — and because the stored text stays readable. The spine holds
// what was typed; this is a rendering of it, and an export or a `sqlite3` query
// shows the same words.
//
// `react-markdown` builds a tree and renders elements. It never sets
// `innerHTML`, so a message containing `<img onerror=…>` renders as those
// characters rather than as an image that runs. That is the whole reason it is
// here rather than a regex and `dangerouslySetInnerHTML`.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import type { StoredAttachment } from '@/lib/attachments';
import { cn } from '@/lib/utils';

/**
 * A theme built from the app's own tokens rather than one of the packaged ones.
 *
 * Every packaged highlighter theme hardcodes a background, so a code block in
 * Paper would sit on a dark slab and a code block in Console would sit on
 * somebody else's dark slab. These read the same variables the rest of the app
 * does, so a block belongs to whichever theme is on.
 */
const CODE_STYLE: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: 'var(--fg-2)', background: 'none', fontFamily: 'var(--font-mono)' },
  'pre[class*="language-"]': { color: 'var(--fg-2)', background: 'none', fontFamily: 'var(--font-mono)' },
  comment: { color: 'var(--fg-4)', fontStyle: 'italic' },
  prolog: { color: 'var(--fg-4)' },
  doctype: { color: 'var(--fg-4)' },
  cdata: { color: 'var(--fg-4)' },
  punctuation: { color: 'var(--fg-3)' },
  property: { color: 'var(--believed)' },
  tag: { color: 'var(--believed)' },
  boolean: { color: 'var(--asserted)' },
  number: { color: 'var(--asserted)' },
  constant: { color: 'var(--asserted)' },
  symbol: { color: 'var(--asserted)' },
  selector: { color: 'var(--tested)' },
  'attr-name': { color: 'var(--tested)' },
  string: { color: 'var(--tested)' },
  char: { color: 'var(--tested)' },
  builtin: { color: 'var(--tested)' },
  operator: { color: 'var(--fg-3)' },
  entity: { color: 'var(--fg-2)' },
  url: { color: 'var(--believed)' },
  atrule: { color: 'var(--believed)' },
  'attr-value': { color: 'var(--tested)' },
  keyword: { color: 'var(--falsified)' },
  function: { color: 'var(--believed)' },
  'class-name': { color: 'var(--asserted)' },
  regex: { color: 'var(--uncertain)' },
  important: { color: 'var(--falsified)', fontWeight: 'bold' },
  variable: { color: 'var(--fg-2)' },
};

export function MessageBody({
  body,
  attachments = [],
  className,
}: {
  body: string;
  attachments?: StoredAttachment[];
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {body ? (
        <div className="vuno-md text-[13px] leading-[1.55] text-[var(--fg-2)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            // No raw-HTML plugin, deliberately. Adding `rehype-raw` here would
            // make every message a place to put a `<script>`.
            components={{
              code({ className: cls, children, ...props }) {
                const match = /language-(\w+)/.exec(cls ?? '');
                const text = String(children).replace(/\n$/, '');
                // A fenced block has a newline or a language; a backtick span
                // does not. `inline` was removed in react-markdown 10, so the
                // shape of the content is what tells them apart.
                if (!match && !text.includes('\n')) {
                  return (
                    <code
                      className="rounded-[3px] border border-[var(--line)] bg-[var(--sunken)] px-1 py-px font-mono text-[11.5px] text-[var(--fg)]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return <CodeBlock code={text} language={match?.[1]} />;
              },
              a({ children, href }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    // `noopener` because a link opened with `target="_blank"`
                    // hands the new page a handle on this one.
                    rel="noopener noreferrer nofollow"
                    className="text-[var(--believed)] underline decoration-[var(--believed)]/40 underline-offset-2 hover:decoration-[var(--believed)]"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      ) : null}

      {attachments.length > 0 ? <Attachments files={attachments} /> : null}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_400);
    } catch {
      // A browser that refuses the clipboard is not worth an error toast; the
      // text is selectable and right there.
    }
  }

  return (
    <div className="group/code relative my-1.5 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--sunken)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-2.5 py-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--fg-4)]">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-auto rounded px-1.5 py-0.5 text-[10.5px] text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Scrolls in its own box: a long line must not push the conversation
          sideways, which is the one thing a message list can never do. */}
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language ?? 'text'}
          style={CODE_STYLE}
          customStyle={{ margin: 0, padding: '0.6rem 0.7rem', background: 'transparent', fontSize: '11.5px', lineHeight: 1.6 }}
          codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function Attachments({ files }: { files: StoredAttachment[] }) {
  const images = files.filter((f) => f.kind === 'image');
  const audio = files.filter((f) => f.kind === 'audio');
  const rest = files.filter((f) => f.kind === 'file');

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {images.map((f) => (
            <a
              key={f.id}
              href={`/api/files/${f.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-md border border-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              {/* Not next/image: these are access-checked and private, and the
                  optimiser would need to fetch them server-side without the
                  viewer's session. Width and height come from the header at
                  upload, so the space is reserved and the list does not reflow
                  as each one arrives. */}
              <img
                src={`/api/files/${f.id}`}
                alt={f.name}
                width={f.width ?? undefined}
                height={f.height ?? undefined}
                loading="lazy"
                className="block max-h-[18rem] w-auto max-w-full object-contain"
                style={f.width && f.height ? { aspectRatio: `${f.width} / ${f.height}` } : undefined}
              />
            </a>
          ))}
        </div>
      ) : null}

      {audio.map((f) => (
        <div
          key={f.id}
          className="flex max-w-[24rem] items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--sunken)] px-2 py-1.5"
        >
          <audio src={`/api/files/${f.id}`} controls preload="metadata" className="h-8 min-w-0 flex-1" />
          {f.durationMs ? (
            <span className="tnum shrink-0 text-[10.5px] text-[var(--fg-4)]">{duration(f.durationMs)}</span>
          ) : null}
        </div>
      ))}

      {rest.map((f) => (
        <a
          key={f.id}
          href={`/api/files/${f.id}`}
          className="flex max-w-[24rem] items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--sunken)] px-2.5 py-1.5 transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          <FileIcon />
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--fg)]">{f.name}</span>
          <span className="tnum shrink-0 text-[10.5px] text-[var(--fg-4)]">{bytes(f.bytes)}</span>
        </a>
      ))}
    </div>
  );
}

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[var(--fg-3)]"
      aria-hidden
    >
      <path d="M14 2.5H7.5A1.5 1.5 0 0 0 6 4v16a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 20V6.5z" />
      <path d="M14 2.5V6.5H18" />
    </svg>
  );
}
