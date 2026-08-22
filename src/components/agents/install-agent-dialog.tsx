// Vuno — Install Agent dialog
// Per ADR-0006: Name, Kind, Role, Model (simulated/echo-1 only in v1),
// Harness (simulated only in v1), Tools checkboxes, Permissions checkboxes,
// Team dropdown. On submit POSTs to /api/install.

'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { useAppStore } from '@/store/app-store';
import { useToast } from '@/hooks/use-toast';
import { useFetch } from '@/hooks/use-fetch';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Lock } from 'lucide-react';

// zod schema
const schema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['independent', 'personal_assistant']),
  role: z.string().min(1),
  modelName: z.string().min(1),
  harnessName: z.string().min(1),
  tools: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  teamId: z.string().optional().nullable(),
});
type FormValues = z.infer<typeof schema>;

const ROLE_OPTIONS = [
  { value: 'architect', label: 'Distributed Systems Architect' },
  { value: 'engineer', label: 'Software Engineer' },
  { value: 'security', label: 'Security Architect' },
  { value: 'perf', label: 'Performance Engineer' },
  { value: 'qa', label: 'QA Engineer' },
  { value: 'devils_advocate', label: "Devil's Advocate" },
  { value: 'verifier', label: 'Verifier' },
  { value: 'product', label: 'Product Lead' },
  { value: 'research', label: 'Researcher' },
  { value: 'hr', label: 'HR / Meta' },
];

const TOOL_OPTIONS = [
  'web.search',
  'github.read',
  'benchmark.run',
  'load.test',
  'scan.security',
  'test.run',
  'papers.read',
];

const PERMISSION_OPTIONS = [
  'repo.read',
  'repo.write',
  'sandbox.run',
  'deploy.staging',
  'deploy.prod',
  'org.read',
  'org.write',
];

const MODEL_OPTIONS = [
  { value: 'simulated/echo-1', label: 'simulated/echo-1 (v1 only)' },
  { value: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet (v2)', locked: true },
  { value: 'gpt-4o', label: 'gpt-4o (v2)', locked: true },
];

const HARNESS_OPTIONS = [
  { value: 'simulated', label: 'simulated (v1 only)' },
  { value: 'claude-code', label: 'claude-code (v2)', locked: true },
  { value: 'codex', label: 'codex (v2)', locked: true },
];

interface TeamsResponse {
  teams: { id: string; name: string; slug: string }[];
}

interface InstallAgentDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function InstallAgentDialog({
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: InstallAgentDialogProps = {}) {
  const store = useAppStore();
  const open = openProp ?? store.installAgentOpen;
  const setOpen = onOpenChangeProp ?? store.setInstallAgentOpen;

  const { toast } = useToast();
  const teamsRes = useFetch<TeamsResponse>('/api/channels');
  const teams = teamsRes.data?.teams ?? [];

  const { control, handleSubmit, reset, watch } = useForm<FormValues>({
    defaultValues: {
      name: '',
      kind: 'independent',
      role: 'architect',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: [],
      permissions: [],
      teamId: null,
    },
  });

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch('/api/install', {
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
        agent: { id: string; name: string; role: string };
      };
      toast({
        title: 'Agent installed',
        description: `${json.agent.name} (${json.agent.role}) was added to the org. AgentInstalled event appended to the spine.`,
      });
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Install failed',
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
            <Plus className="size-4" aria-hidden />
            Install Agent
          </DialogTitle>
          <DialogDescription>
            Add a specialized agent to the org. v1 ships simulated harnesses;
            the same form unlocks real models in v2.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          aria-label="Install agent form"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {/* Name */}
            <Field label="Name">
              <Controller
                control={control}
                name="name"
                render={({ field }) => (
                  <Input
                    {...field}
                    placeholder="e.g. Distributed Systems Architect"
                  />
                )}
              />
            </Field>

            {/* Kind */}
            <Field label="Kind">
              <Controller
                control={control}
                name="kind"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="independent">Independent</SelectItem>
                      <SelectItem value="personal_assistant">
                        Personal Assistant
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            {/* Role */}
            <Field label="Role">
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            {/* Team */}
            <Field label="Team">
              <Controller
                control={control}
                name="teamId"
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
                      <SelectItem value="__none__">(unassigned)</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            {/* Model (v1 = simulated only) */}
            <Field label="Model">
              <Controller
                control={control}
                name="modelName"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map((m) => (
                        <SelectItem
                          key={m.value}
                          value={m.value}
                          disabled={m.locked}
                        >
                          {m.label}
                          {m.locked ? (
                            <Lock className="ml-1 inline size-3 opacity-60" />
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            {/* Harness (v1 = simulated only) */}
            <Field label="Harness">
              <Controller
                control={control}
                name="harnessName"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HARNESS_OPTIONS.map((h) => (
                        <SelectItem
                          key={h.value}
                          value={h.value}
                          disabled={h.locked}
                        >
                          {h.label}
                          {h.locked ? (
                            <Lock className="ml-1 inline size-3 opacity-60" />
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          {/* Tools */}
          <Field label="Tools">
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              <Controller
                control={control}
                name="tools"
                render={({ field }) => (
                  <>
                    {TOOL_OPTIONS.map((t) => {
                      const checked = field.value.includes(t);
                      return (
                        <label
                          key={t}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-xs hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => {
                              if (checked) {
                                field.onChange(
                                  field.value.filter((x) => x !== t),
                                );
                              } else {
                                field.onChange([...field.value, t]);
                              }
                            }}
                          />
                          <span className="font-mono">{t}</span>
                        </label>
                      );
                    })}
                  </>
                )}
              />
            </div>
          </Field>

          {/* Permissions */}
          <Field label="Permissions">
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              <Controller
                control={control}
                name="permissions"
                render={({ field }) => (
                  <>
                    {PERMISSION_OPTIONS.map((p) => {
                      const checked = field.value.includes(p);
                      return (
                        <label
                          key={p}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-xs hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => {
                              if (checked) {
                                field.onChange(
                                  field.value.filter((x) => x !== p),
                                );
                              } else {
                                field.onChange([...field.value, p]);
                              }
                            }}
                          />
                          <span className="font-mono">{p}</span>
                        </label>
                      );
                    })}
                  </>
                )}
              />
            </div>
          </Field>

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
                <Plus className="size-3.5" aria-hidden />
              )}
              Install Agent
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
