// Vuno — the plugins that ship with this install.
//
// A directory of manifests, not a network registry. Being honest about which
// one this is matters: a "marketplace" that is really three files should say
// three files, and a browse screen that implies a live index nobody is running
// is the same failure as an agent with canned replies.
//
// The shape is the shape a registry would serve, so the day one exists this
// becomes a second source rather than a rewrite.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest, type Manifest } from '@/lib/plugins/manifest';

export interface CatalogueEntry {
  manifest: Manifest;
  /** The file it came from, so a broken one can be found. */
  file: string;
}

/** Where the bundled manifests live, relative to the repo root. */
const DIR = join(process.cwd(), 'catalogue');

let cached: CatalogueEntry[] | null = null;

/**
 * Read the bundled catalogue.
 *
 * Cached after the first read: these are files that ship with the build and do
 * not change while it runs, and re-reading a directory on every page load is
 * work with no question behind it.
 *
 * A manifest that does not parse is skipped and reported, not thrown. One bad
 * file should not take down a screen that lists the other two — but it must not
 * disappear silently either, or nobody finds out it was wrong.
 */
export async function catalogue(): Promise<{ entries: CatalogueEntry[]; broken: string[] }> {
  if (cached) return { entries: cached, broken: [] };

  let files: string[];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    // No catalogue directory is a legitimate install, not an error.
    cached = [];
    return { entries: [], broken: [] };
  }

  const entries: CatalogueEntry[] = [];
  const broken: string[] = [];

  for (const file of files) {
    try {
      const raw = await readFile(join(DIR, file), 'utf8');
      const parsed = parseManifest(JSON.parse(raw) as unknown);
      if (parsed.ok) entries.push({ manifest: parsed.manifest, file });
      else broken.push(`${file}: ${parsed.error}`);
    } catch (e) {
      broken.push(`${file}: ${e instanceof Error ? e.message : 'could not be read'}`);
    }
  }

  if (broken.length === 0) cached = entries;
  return { entries, broken };
}

/** One entry by key, or null. Used by install-from-catalogue. */
export async function catalogueEntry(key: string): Promise<Manifest | null> {
  const { entries } = await catalogue();
  return entries.find((e) => e.manifest.key === key)?.manifest ?? null;
}
