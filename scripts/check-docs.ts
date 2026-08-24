// Vuno — do the documents point at things that exist?
//
// A README with a dead link is worse than one without the link: it tells the
// reader the thing is there. This walks every markdown file in the repo and
// resolves every relative link and every image, so a renamed file or a deleted
// screenshot fails here rather than in front of somebody.
//
//   bun run docs:check
//
// External links are not fetched — that would make the check depend on the
// network and on somebody else's uptime.

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const ROOTS = ['.', 'docs', 'docs/adr', 'docs/design'];
const broken: string[] = [];
let checked = 0;

/** `[text](target)` and `![alt](target)` — the target is what matters. */
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Markdown lowercases a heading, drops punctuation and hyphenates spaces. */
function anchorsOf(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    out.add(
      heading[1]
        .toLowerCase()
        .replace(/`|\*|_/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-'),
    );
  }
  return out;
}

const anchorCache = new Map<string, Set<string>>();
async function anchorsIn(file: string): Promise<Set<string>> {
  const hit = anchorCache.get(file);
  if (hit) return hit;
  const set = anchorsOf(await readFile(file, 'utf8'));
  anchorCache.set(file, set);
  return set;
}

for (const dir of ROOTS) {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    continue;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const file = normalize(join(dir, entry));
    const body = await readFile(file, 'utf8');

    for (const [, target] of body.matchAll(LINK)) {
      // Not ours to verify: another host, a mail link, or an in-page anchor
      // that the heading scan below covers.
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      checked++;

      const [path, anchor] = target.split('#');
      const resolved = normalize(join(dirname(file), path));

      if (!(await exists(resolved))) {
        broken.push(`${file} → ${target} (no such file)`);
        continue;
      }
      if (anchor && resolved.endsWith('.md') && !(await anchorsIn(resolved)).has(anchor)) {
        broken.push(`${file} → ${target} (no such heading)`);
      }
    }
  }
}

console.log(`${checked} links checked`);
for (const b of broken) console.log(`  BROKEN  ${b}`);
process.exit(broken.length === 0 ? 0 : 1);
