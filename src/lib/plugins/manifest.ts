// Vuno — what a plugin declares.
//
// The format is deliberately close to the one an agent package would use, and
// deliberately smaller than the one it will eventually need. Every field here
// does something the moment it is installed: a skill becomes text an agent is
// told, a connector becomes a server the org can call, an agent becomes a
// member on the roster. A field that only described an intention would be a row
// claiming a capability the org does not have, which is the failure this
// codebase already removed once (docs/REVIEW-2026-08-23.md).

import { z } from 'zod';

/** Lowercase, dashed. The same shape a skill key and a connector key take. */
const KEY = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'a key is lowercase letters, digits and dashes, starting with a letter or digit');

const HANDLE = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'a handle is what people type after @ — lowercase, no spaces');

export const skillDecl = z.object({
  key: KEY,
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(240),
  /** The SKILL.md body, verbatim. This is what an agent holding it is told. */
  content: z.string().min(1).max(40_000),
});

export const connectorDecl = z.object({
  key: KEY,
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(240),
  url: z.string().url('a connector needs the URL of an MCP server'),
  /** The name of an env var holding a bearer token — never the token. */
  authEnvVar: z.string().max(64).nullish(),
});

export const agentDecl = z.object({
  handle: HANDLE,
  displayName: z.string().min(1).max(120),
  roleLabel: z.string().max(60).nullish(),
  harnessName: z.string().min(1).max(40),
  modelName: z.string().min(1).max(80),
  /** Keys of skills this plugin declares, given to the agent on install. */
  skills: z.array(KEY).max(40).default([]),
  /** Keys of connectors this plugin declares, given to the agent on install. */
  connectors: z.array(KEY).max(40).default([]),
});

export const manifestSchema = z
  .object({
    key: KEY,
    name: z.string().min(1).max(120),
    summary: z.string().min(1).max(240),
    version: z
      .string()
      .min(1)
      .max(32)
      .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'a version looks like 1.2.0'),
    author: z.string().max(120).nullish(),
    skills: z.array(skillDecl).max(60).default([]),
    connectors: z.array(connectorDecl).max(20).default([]),
    agents: z.array(agentDecl).max(20).default([]),
  })
  // A package that installs nothing is a description, and descriptions belong
  // in the summary.
  .refine((m) => m.skills.length + m.connectors.length + m.agents.length > 0, {
    message: 'a plugin has to install at least one skill, connector or agent',
  })
  // An agent asking for a skill this plugin does not carry would install
  // holding nothing, silently. Caught here, where the manifest can be fixed,
  // rather than three rows later.
  .superRefine((m, ctx) => {
    const skills = new Set(m.skills.map((s) => s.key));
    const connectors = new Set(m.connectors.map((c) => c.key));
    for (const a of m.agents) {
      for (const k of a.skills) {
        if (!skills.has(k)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['agents'],
            message: `@${a.handle} asks for the skill "${k}", which this plugin does not carry.`,
          });
        }
      }
      for (const k of a.connectors) {
        if (!connectors.has(k)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['agents'],
            message: `@${a.handle} asks for the connector "${k}", which this plugin does not carry.`,
          });
        }
      }
    }
  });

export type Manifest = z.infer<typeof manifestSchema>;
export type SkillDecl = z.infer<typeof skillDecl>;
export type ConnectorDecl = z.infer<typeof connectorDecl>;
export type AgentDecl = z.infer<typeof agentDecl>;

/**
 * Read a manifest, saying what is wrong in words rather than a Zod dump.
 *
 * The person reading this pasted a JSON file and got it wrong somewhere. The
 * path matters as much as the message — "agents.0.handle" is the difference
 * between fixing it and hunting for it.
 */
export function parseManifest(input: unknown): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  const parsed = manifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const error = parsed.error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
  return { ok: false, error };
}
