// Vuno — who a message called on.
//
// `@bob` in a conversation brings Bob into it. Deterministic: it matches the
// handles of members who exist, and nothing else. What this replaces matched
// substrings anywhere in the body — the word "security" in a sentence about
// being worried woke two agents who then replied with hand-written text.
//
// The rule the vision doc states, and the reason this is a lookup rather than a
// classifier: a DM stays a DM. Summoning an assistant into a conversation does
// not add it to the membership, rename the conversation, or move it in the
// sidebar. It answers, in the open, as itself.

/** Handles are `@` followed by letters, digits, dot, dash or underscore. */
const MENTION = /(^|[^\w@/])@([a-z0-9][a-z0-9._-]{0,38})\b/gi;

/**
 * Every distinct handle a message calls on, lowercased, in the order they
 * appear. An email address does not count as a mention of its domain.
 */
export function extractHandles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(MENTION)) {
    const handle = match[2].toLowerCase().replace(/[._-]+$/, '');
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}
