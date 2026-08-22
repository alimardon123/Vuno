// Vuno — Channel details sheet (shared things)
// Per the user's direction: the central top bar should be clickable and show
// shared things (links, files, audio, video) for each chat/channel.
// Opens as a right-side sheet (desktop) or bottom sheet (mobile).

'use client';

import { useFetch } from '@/hooks/use-fetch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Hash,
  FileText,
  Link as LinkIcon,
  Image as ImageIcon,
  Video,
  Music,
  Paperclip,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface EventsResponse {
  events: Array<{
    id: string;
    type: string;
    payload: Record<string, unknown> & { body?: string };
    actorAgentId?: string | null;
    createdAt: string;
  }>;
}

interface SharedItem {
  id: string;
  type: 'link' | 'file' | 'image' | 'video' | 'audio' | 'text';
  title: string;
  summary: string;
  postedBy: string;
  postedAt: string;
  icon: LucideIcon;
}

// Heuristic: scan messages for URLs, file references, and structured content.
// In a real app, this would be a proper search/index query.
function extractSharedItems(events: EventsResponse['events']): SharedItem[] {
  const items: SharedItem[] = [];
  for (const e of events) {
    const body = e.payload?.body;
    if (typeof body !== 'string' || !body) continue;
    // URL detection
    const urlMatch = body.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      items.push({
        id: e.id,
        type: 'link',
        title: urlMatch[0],
        summary: body.slice(0, 120),
        postedBy: e.actorAgentId ?? 'system',
        postedAt: e.createdAt,
        icon: LinkIcon,
      });
    }
    // File references (e.g. "report.pdf", "image.png")
    const fileMatch = body.match(/\b([\w-]+\.(pdf|docx?|xlsx?|png|jpg|jpeg|gif|webp|mp4|mov|mp3|wav|zip))\b/i);
    if (fileMatch) {
      const ext = fileMatch[2]?.toLowerCase() ?? '';
      const type: SharedItem['type'] =
        /^(png|jpe?g|gif|webp)$/.test(ext) ? 'image' :
        /^(mp4|mov|webm)$/.test(ext) ? 'video' :
        /^(mp3|wav|flac)$/.test(ext) ? 'audio' : 'file';
      const icon: LucideIcon =
        type === 'image' ? ImageIcon :
        type === 'video' ? Video :
        type === 'audio' ? Music : Paperclip;
      items.push({
        id: e.id + '-file',
        type,
        title: fileMatch[1] ?? 'file',
        summary: body.slice(0, 120),
        postedBy: e.actorAgentId ?? 'system',
        postedAt: e.createdAt,
        icon,
      });
    }
  }
  return items;
}

interface ChannelDetailsSheetProps {
  channelId: string;
  channelName: string;
  channelTopic?: string | null;
}

export function ChannelDetailsContent({
  channelId,
  channelName,
  channelTopic,
}: ChannelDetailsSheetProps) {
  const eventsRes = useFetch<EventsResponse>(
    `/api/events?scopeType=channel&scopeId=${channelId}`,
    { intervalMs: 30000 },
  );

  const events = eventsRes.data?.events ?? [];
  const sharedItems = extractSharedItems(events);
  const links = sharedItems.filter((i) => i.type === 'link');
  const files = sharedItems.filter((i) => i.type === 'file');
  const images = sharedItems.filter((i) => i.type === 'image');
  const videos = sharedItems.filter((i) => i.type === 'video');
  const audios = sharedItems.filter((i) => i.type === 'audio');

  return (
    <div className="flex h-full flex-col">
      {/* Channel header */}
      <div className="border-b border-border/40 p-4">
        <div className="flex items-center gap-2">
          <Hash className="size-5 text-primary" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight">{channelName}</h2>
        </div>
        {channelTopic ? (
          <p className="mt-1 text-sm text-muted-foreground">{channelTopic}</p>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-4 p-4">
          {eventsRes.loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null}

          {/* Shared links */}
          <SharedSection title="Links" items={links} icon={LinkIcon} />

          {/* Shared files */}
          <SharedSection title="Files" items={files} icon={Paperclip} />

          {/* Shared images */}
          <SharedSection title="Images" items={images} icon={ImageIcon} />

          {/* Shared videos */}
          <SharedSection title="Videos" items={videos} icon={Video} />

          {/* Shared audio */}
          <SharedSection title="Audio" items={audios} icon={Music} />

          {/* Empty state */}
          {sharedItems.length === 0 && !eventsRes.loading ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
              <Paperclip className="size-6 opacity-40" aria-hidden />
              <span className="font-medium text-foreground">No shared items yet</span>
              <span>Links, files, and media shared in this channel will appear here.</span>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function SharedSection({
  title,
  items,
  icon: Icon,
}: {
  title: string;
  items: SharedItem[];
  icon: LucideIcon;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        <span className="text-[0.625rem] text-muted-foreground">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-md border border-border/40 bg-card/40 px-3 py-2 transition-colors hover:bg-card/70"
          >
            <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{item.summary}</span>
              <span className="text-[0.6875rem] text-muted-foreground/70">
                by {item.postedBy}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
