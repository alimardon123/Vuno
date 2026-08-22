// Vuno — File Objective dialog
// Per SCREENS.md §6: Title, Success Criteria, Constraints, Budget,
// Autonomy Level (L1-L4), Routing (owningDepartment).
// On submit POSTs to /api/objective.

'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { useAppStore } from '@/store/app-store';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Target } from 'lucide-react';

const schema = z.object({
  title: z.string().min(1).max(200),
  successCriteria: z.string().min(1).max(500),
  constraints: z.string().max(500).optional().nullable(),
  budget: z.string().max(120).optional().nullable(),
  autonomyLevel: z.enum(['L1', 'L2', 'L3', 'L4']),
  owningDepartment: z.string().max(120).optional().nullable(),
});
type FormValues = z.infer<typeof schema>;

const DEPARTMENT_OPTIONS = [
  'Product',
  'Engineering',
  'Security',
  'Performance',
  'QA',
  'HR / Meta',
];

const AUTONOMY_OPTIONS = [
  { value: 'L1', label: 'L1 — Suggest (review required)' },
  { value: 'L2', label: 'L2 — Act with approval (default)' },
  { value: 'L3', label: 'L3 — Act, report after (in bounded scope)' },
  { value: 'L4', label: 'L4 — Full autonomy (v2; not in v1)', locked: true },
];

interface FileObjectiveDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FileObjectiveDialog({
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: FileObjectiveDialogProps = {}) {
  const store = useAppStore();
  const open = openProp ?? store.fileObjectiveOpen;
  const setOpen = onOpenChangeProp ?? store.setFileObjectiveOpen;
  const bumpChatNonce = useAppStore((s) => s.bumpChatNonce);
  const { toast } = useToast();

  const { control, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      title: '',
      successCriteria: '',
      constraints: '',
      budget: '',
      autonomyLevel: 'L2',
      owningDepartment: 'Product',
    },
  });

  const [submitting, setSubmitting] = useState(false);

  // Reset when closed
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      toast({
        title: 'Invalid form',
        description: parsed.error.message,
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/objective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        objective: { id: string; title: string };
      };
      toast({
        title: 'Objective filed',
        description: `${json.objective.title} was filed and an ObjectiveFiled event was appended to the channel.`,
      });
      bumpChatNonce();
      setOpen(false);
    } catch (e) {
      toast({
        title: 'File failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-4" aria-hidden />
            File New Objective
          </DialogTitle>
          <DialogDescription>
            Define what the org should achieve, the success criteria, and the
            autonomy level. Filing appends an ObjectiveFiled event to the
            channel — the routed team sees it immediately.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          aria-label="File objective form"
        >
          <Field label="Title">
            <Controller
              control={control}
              name="title"
              render={({ field }) => (
                <Input
                  {...field}
                  placeholder="e.g. Build a storage engine with sub-50ms p99 reads"
                />
              )}
            />
          </Field>

          <Field label="Success criteria">
            <Controller
              control={control}
              name="successCriteria"
              render={({ field }) => (
                <Textarea
                  {...field}
                  placeholder="e.g. p99 < 50ms at 10k concurrent readers"
                  className="min-h-[3rem] resize-none"
                />
              )}
            />
          </Field>

          <Field label="Constraints (optional)">
            <Controller
              control={control}
              name="constraints"
              render={({ field }) => (
                <Textarea
                  {...field}
                  placeholder="single-node first; open-source dependencies only"
                  className="min-h-[3rem] resize-none"
                />
              )}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Budget">
              <Controller
                control={control}
                name="budget"
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder="$400 / 3 weeks"
                  />
                )}
              />
            </Field>

            <Field label="Autonomy">
              <Controller
                control={control}
                name="autonomyLevel"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTONOMY_OPTIONS.map((a) => (
                        <SelectItem
                          key={a.value}
                          value={a.value}
                          disabled={a.locked}
                        >
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Routing (department)">
              <Controller
                control={control}
                name="owningDepartment"
                render={({ field }) => (
                  <Select
                    value={field.value ?? '__none__'}
                    onValueChange={(v) =>
                      field.onChange(v === '__none__' ? null : v)
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(none)</SelectItem>
                      {DEPARTMENT_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Target className="size-3.5" aria-hidden />
              )}
              File Objective
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <Label className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
