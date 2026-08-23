// Vuno — Share dialog
// Per the user's direction: "i can send many things(attachments, urls, files,
// voices, and etc) just like teams or slack."
// A dialog with tabs for URL / File / Code sharing. Posts SharedItem events.
// Per the "Simple" principle: one dialog, three tabs, one POST.

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link as LinkIcon, FileText, Code2, Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/app-store';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

export function ShareDialog({ open, onOpenChange, channelId }: ShareDialogProps) {
  const { bumpChatNonce } = useAppStore();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // URL state
  const [url, setUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [urlDesc, setUrlDesc] = useState('');

  // File state (v1: metadata only — no actual upload)
  const [fileName, setFileName] = useState('');
  const [fileDesc, setFileDesc] = useState('');

  // Code state
  const [code, setCode] = useState('');
  const [codeLang, setCodeLang] = useState('');

  async function postSharedItem(itemType: 'url' | 'file' | 'code', payload: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'SharedItem',
          payload: { itemType, ...payload },
          channelId,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Reset form + close
      setUrl(''); setUrlTitle(''); setUrlDesc('');
      setFileName(''); setFileDesc('');
      setCode(''); setCodeLang('');
      onOpenChange(false);
      bumpChatNonce();
      toast({ title: 'Shared', description: `${itemType} shared to chat` });
    } catch (e) {
      toast({
        title: 'Failed to share',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share to chat</DialogTitle>
          <DialogDescription>
            Share a link, file, or code snippet with the team.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="url" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="url" className="gap-1 text-xs">
              <LinkIcon className="size-3" /> URL
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1 text-xs">
              <FileText className="size-3" /> File
            </TabsTrigger>
            <TabsTrigger value="code" className="gap-1 text-xs">
              <Code2 className="size-3" /> Code
            </TabsTrigger>
          </TabsList>

          {/* URL tab */}
          <TabsContent value="url" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">URL</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Title (optional)</label>
              <Input
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                placeholder="Interesting article on…"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Description (optional)</label>
              <Input
                value={urlDesc}
                onChange={(e) => setUrlDesc(e.target.value)}
                placeholder="Why this is worth reading…"
                className="text-sm"
              />
            </div>
            <Button
              onClick={() => postSharedItem('url', {
                title: urlTitle.trim() || url.trim(),
                description: urlDesc.trim() || undefined,
                url: url.trim(),
              })}
              disabled={submitting || !url.trim()}
              className="ml-auto"
              size="sm"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Share URL
            </Button>
          </TabsContent>

          {/* File tab */}
          <TabsContent value="file" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">File name</label>
              <Input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="benchmark-report.pdf"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Description (optional)</label>
              <Input
                value={fileDesc}
                onChange={(e) => setFileDesc(e.target.value)}
                placeholder="Q3 benchmark results…"
                className="text-sm"
              />
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">
              Note: file upload isn&apos;t available in v1 — enter the file name + description.
              The shared card will reference it.
            </p>
            <Button
              onClick={() => postSharedItem('file', {
                title: fileName.trim(),
                description: fileDesc.trim() || undefined,
                fileName: fileName.trim(),
              })}
              disabled={submitting || !fileName.trim()}
              className="ml-auto"
              size="sm"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Share File
            </Button>
          </TabsContent>

          {/* Code tab */}
          <TabsContent value="code" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Language (optional)</label>
              <Input
                value={codeLang}
                onChange={(e) => setCodeLang(e.target.value)}
                placeholder="typescript, rust, python…"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Code snippet</label>
              <Textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste your code here…"
                className="min-h-[8rem] resize-none font-mono text-xs"
              />
            </div>
            <Button
              onClick={() => postSharedItem('code', {
                title: codeLang.trim() ? `${codeLang.trim()} snippet` : 'Code snippet',
                content: code,
                mimeType: codeLang.trim() ? `text/x-${codeLang.trim()}` : 'text/plain',
              })}
              disabled={submitting || !code.trim()}
              className="ml-auto"
              size="sm"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Share Code
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
