// Vuno — Memory Detector
// The personal assistant's silent observation layer. When the owner (Kai) posts
// a message in any channel, the detector extracts learned facts:
//   - interests: tech keywords (Rust, Tokio, WebAssembly, ...)
//   - focus_areas: domain areas (distributed systems, ML, security, ...)
//   - sentiment: emotional state (worried, excited, focused, ...)
//   - preferences: stated "I prefer X" / "I hate Y" patterns
//
// Per the design principle "Simple": substring matching, no ML.
// Per "Powerful": the PA visibly learns — every detected fact becomes a
// MemoryUpdated event the user can see + audit in the Memory Evolution view.
// Per "Beautiful": the PA feels like it's paying attention to you, not just
// waiting to be summoned.

export type FactType = 'interest' | 'focus_area' | 'sentiment' | 'preference';

export interface DetectedFact {
  factType: FactType;
  key: string;            // PersonalMemory key, e.g. "interests", "current_sentiment"
  value: string;          // the learned value, e.g. "rust", "worried"
  confidence: number;     // 0-1
  reason: string;         // human-readable explanation for the Memory Evolution view
}

// Tech interests — languages, frameworks, tools. Each has a canonical display name.
const INTEREST_KEYWORDS: Array<{ match: string; canonical: string }> = [
  { match: 'rust', canonical: 'Rust' },
  { match: 'golang', canonical: 'Go' },
  { match: 'go ', canonical: 'Go' },
  { match: 'python', canonical: 'Python' },
  { match: 'typescript', canonical: 'TypeScript' },
  { match: 'javascript', canonical: 'JavaScript' },
  { match: 'kubernetes', canonical: 'Kubernetes' },
  { match: 'k8s', canonical: 'Kubernetes' },
  { match: 'docker', canonical: 'Docker' },
  { match: 'tokio', canonical: 'Tokio' },
  { match: 'webassembly', canonical: 'WebAssembly' },
  { match: 'wasm', canonical: 'WebAssembly' },
  { match: 'react', canonical: 'React' },
  { match: 'next.js', canonical: 'Next.js' },
  { match: 'nextjs', canonical: 'Next.js' },
  { match: 'vue', canonical: 'Vue' },
  { match: 'svelte', canonical: 'Svelte' },
  { match: 'postgres', canonical: 'Postgres' },
  { match: 'postgresql', canonical: 'Postgres' },
  { match: 'mysql', canonical: 'MySQL' },
  { match: 'redis', canonical: 'Redis' },
  { match: 'kafka', canonical: 'Kafka' },
  { match: 'graphql', canonical: 'GraphQL' },
  { match: 'grpc', canonical: 'gRPC' },
  { match: 'terraform', canonical: 'Terraform' },
  { match: 'aws', canonical: 'AWS' },
  { match: 'gcp', canonical: 'GCP' },
  { match: 'azure', canonical: 'Azure' },
  { match: 'elixir', canonical: 'Elixir' },
  { match: 'swift', canonical: 'Swift' },
  { match: 'kotlin', canonical: 'Kotlin' },
  { match: 'zig', canonical: 'Zig' },
  { match: 'nim', canonical: 'Nim' },
];

// Domain focus areas — broader than the attention router's topic matching.
const FOCUS_KEYWORDS: Array<{ match: string; canonical: string }> = [
  { match: 'distributed systems', canonical: 'Distributed Systems' },
  { match: 'machine learning', canonical: 'Machine Learning' },
  { match: 'deep learning', canonical: 'Deep Learning' },
  { match: 'artificial intelligence', canonical: 'AI' },
  { match: 'security', canonical: 'Security' },
  { match: 'performance', canonical: 'Performance' },
  { match: 'observability', canonical: 'Observability' },
  { match: 'database', canonical: 'Databases' },
  { match: 'storage', canonical: 'Storage' },
  { match: 'networking', canonical: 'Networking' },
  { match: 'compiler', canonical: 'Compilers' },
  { match: 'frontend', canonical: 'Frontend' },
  { match: 'backend', canonical: 'Backend' },
  { match: 'devops', canonical: 'DevOps' },
  { match: 'sre', canonical: 'Site Reliability' },
  { match: 'cryptography', canonical: 'Cryptography' },
  { match: 'crypto', canonical: 'Cryptography' },
  { match: 'data engineering', canonical: 'Data Engineering' },
  { match: 'data science', canonical: 'Data Science' },
  { match: 'infrastructure', canonical: 'Infrastructure' },
];

// Sentiment — current emotional state. Replaces the previous value (not append).
const SENTIMENT_KEYWORDS: Array<{ match: string; canonical: string; confidence: number }> = [
  { match: 'worried', canonical: 'worried', confidence: 0.8 },
  { match: 'concerned', canonical: 'concerned', confidence: 0.8 },
  { match: 'anxious', canonical: 'anxious', confidence: 0.85 },
  { match: 'frustrated', canonical: 'frustrated', confidence: 0.8 },
  { match: 'stressed', canonical: 'stressed', confidence: 0.8 },
  { match: 'excited', canonical: 'excited', confidence: 0.85 },
  { match: 'pumped', canonical: 'excited', confidence: 0.75 },
  { match: 'thrilled', canonical: 'excited', confidence: 0.85 },
  { match: 'stoked', canonical: 'excited', confidence: 0.75 },
  { match: 'deep dive', canonical: 'focused', confidence: 0.7 },
  { match: 'digging into', canonical: 'focused', confidence: 0.7 },
  { match: 'focused on', canonical: 'focused', confidence: 0.7 },
  { match: 'heads down', canonical: 'focused', confidence: 0.65 },
];

// Stated preferences — explicit "I prefer X" / "I hate Y" patterns.
const PREFERENCE_PATTERNS: Array<{ regex: RegExp; extractGroup: number; confidence: number }> = [
  { regex: /i (?:really )?prefer (\w[\w\s-]{1,30}?)(?:[.,!?]|$)/i, extractGroup: 1, confidence: 0.9 },
  { regex: /i (?:really )?(?:like|love|enjoy) (?:using |working with )?(\w[\w\s-]{1,30}?)(?:[.,!?]|$)/i, extractGroup: 1, confidence: 0.75 },
  { regex: /i (?:really )?hate (?:using |working with )?(\w[\w\s-]{1,30}?)(?:[.,!?]|$)/i, extractGroup: 1, confidence: 0.8 },
  { regex: /i always (?:use|reach for) (\w[\w\s-]{1,30}?)(?:[.,!?]|$)/i, extractGroup: 1, confidence: 0.85 },
];

// Detect all facts in a message body. Returns deduplicated facts.
// Per the "Simple" principle: one function, one pass, no state.
export function detectMemoryFacts(body: string): DetectedFact[] {
  const lower = body.toLowerCase();
  const facts: DetectedFact[] = [];
  const seenInterest = new Set<string>();
  const seenFocus = new Set<string>();

  // Interests — append to list (multiple tech mentions per message are fine)
  for (const kw of INTEREST_KEYWORDS) {
    if (lower.includes(kw.match) && !seenInterest.has(kw.canonical)) {
      seenInterest.add(kw.canonical);
      facts.push({
        factType: 'interest',
        key: 'interests',
        value: kw.canonical,
        confidence: 0.8,
        reason: `mentioned "${kw.match}"`,
      });
    }
  }

  // Focus areas — append to list
  for (const kw of FOCUS_KEYWORDS) {
    if (lower.includes(kw.match) && !seenFocus.has(kw.canonical)) {
      seenFocus.add(kw.canonical);
      facts.push({
        factType: 'focus_area',
        key: 'focus_areas',
        value: kw.canonical,
        confidence: 0.75,
        reason: `discussed "${kw.match}"`,
      });
    }
  }

  // Sentiment — take the FIRST match (don't pile on multiple sentiments)
  for (const kw of SENTIMENT_KEYWORDS) {
    if (lower.includes(kw.match)) {
      facts.push({
        factType: 'sentiment',
        key: 'current_sentiment',
        value: kw.canonical,
        confidence: kw.confidence,
        reason: `expressed feeling: "${kw.match}"`,
      });
      break; // only one sentiment per message
    }
  }

  // Stated preferences — regex extract
  for (const pat of PREFERENCE_PATTERNS) {
    const m = body.match(pat.regex);
    if (m && m[pat.extractGroup]) {
      const pref = m[pat.extractGroup].trim().toLowerCase();
      if (pref.length >= 2 && pref.length <= 40) {
        facts.push({
          factType: 'preference',
          key: 'stated_preferences',
          value: pref,
          confidence: pat.confidence,
          reason: `stated preference: "${m[0].trim()}"`,
        });
        break; // only one preference per message to avoid spam
      }
    }
  }

  // Cap at 4 facts per message — don't extract everything (Simple principle)
  return facts.slice(0, 4);
}

// Compute the new aggregate value for a list-type key (interests, focus_areas, etc.)
// Reads the existing JSON array, appends new values (deduped), caps at 20 entries.
export function appendToListValue(existingJson: string | null, newValue: string): string {
  let arr: string[] = [];
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (Array.isArray(parsed)) arr = parsed.filter((x) => typeof x === 'string');
    } catch {
      arr = [];
    }
  }
  if (!arr.includes(newValue)) {
    arr.push(newValue);
    if (arr.length > 20) arr = arr.slice(arr.length - 20); // cap — keep most recent
  }
  return JSON.stringify(arr);
}

// Check if a value is already present in a JSON array value
export function valueInList(existingJson: string | null, value: string): boolean {
  if (!existingJson) return false;
  try {
    const parsed = JSON.parse(existingJson);
    if (Array.isArray(parsed)) return parsed.includes(value);
  } catch {
    return false;
  }
  return false;
}
