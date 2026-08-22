// Vuno — Attention Router
// Per the design principle "Powerful": agents don't just wait for debates.
// They monitor channel chatter and auto-wake when content matches their domain.
// This is the "magic moment" — a user posts "I'm worried about the auth flow"
// and within ~1s the Security Architect posts a brief observation.
//
// Pattern matching is intentionally simple (substring on lowercased text).
// Real ML-based relevance scoring can drop in later — same interface.
//
// Per the "Simple" principle: one config object, one matcher function.

export interface AttentionPattern {
  role: string;              // agent role, e.g. 'security'
  topic: string;             // label for what they listen for, e.g. 'security'
  keywords: string[];        // substring matches (lowercased)
  weight: number;            // base confidence boost per match (0-1)
  description: string;       // for the settings UI
}

// Configurable patterns — one per agent role. Order matters only for tie-breaking.
export const ATTENTION_PATTERNS: AttentionPattern[] = [
  {
    role: 'security',
    topic: 'security',
    keywords: ['security', 'vulnerab', 'cve', 'exploit', 'auth', 'injection', 'xss', 'csrf', 'token', 'credential', 'tls', 'crypto', 'encrypt', 'decrypt', 'rbac', 'permission'],
    weight: 0.7,
    description: 'Listens for security, auth, crypto, and vulnerability-related discussion.',
  },
  {
    role: 'perf',
    topic: 'performance',
    keywords: ['perf', 'latency', 'p99', 'p95', 'throughput', 'benchmark', 'slow', 'fast', 'qps', 'rps', 'memory', 'cpu', 'cache', 'ram', 'heap'],
    weight: 0.7,
    description: 'Listens for performance, latency, throughput, and resource talk.',
  },
  {
    role: 'verifier',
    topic: 'quality',
    keywords: ['test', 'qa', 'regression', 'coverage', 'unit test', 'integration', 'bug', 'flaky', 'ci', 'cd', 'pipeline'],
    weight: 0.65,
    description: 'Listens for testing, CI, and quality-assurance discussion.',
  },
  {
    role: 'hr',
    topic: 'org',
    keywords: ['objective', 'okr', 'goal', 'team', 'hiring', 'onboard', 'performance review', 'retro', 'retrospective', 'headcount'],
    weight: 0.65,
    description: 'Listens for org, OKR, hiring, and retrospective discussion.',
  },
  {
    role: 'architect',
    topic: 'architecture',
    keywords: ['architecture', 'design', 'system', 'structure', 'refactor', 'scale', 'scalab', 'distributed', 'consensus', 'partition'],
    weight: 0.6,
    description: 'Listens for architecture, design, and scaling discussion.',
  },
  {
    role: 'devils_advocate',
    topic: 'risk',
    keywords: ['risk', 'concern', 'alternative', 'downside', 'drawback', 'problem with', 'issue with', 'worried', 'unsure', 'uncertain'],
    weight: 0.55,
    description: 'Listens for risk, concern, and doubt — quick to object.',
  },
];

export interface AttentionMatch {
  pattern: AttentionPattern;
  matchedKeywords: string[];
  confidence: number;
}

// Score a message body against all patterns. Returns matches with confidence > threshold.
// Confidence = base weight × min(1, matches × 0.4) — diminishing returns on more matches.
// Caps at 2 matches per agent (so multiple keywords don't inflate).
export function matchAttention(body: string, threshold = 0.3): AttentionMatch[] {
  const lower = body.toLowerCase();
  const matches: AttentionMatch[] = [];
  for (const pattern of ATTENTION_PATTERNS) {
    const matched: string[] = [];
    for (const kw of pattern.keywords) {
      if (lower.includes(kw) && !matched.includes(kw)) {
        matched.push(kw);
        if (matched.length >= 3) break; // cap matches per pattern
      }
    }
    if (matched.length === 0) continue;
    const confidence = Math.min(1, pattern.weight * (0.6 + matched.length * 0.2));
    if (confidence >= threshold) {
      matches.push({ pattern, matchedKeywords: matched, confidence });
    }
  }
  // Sort by confidence desc — highest-relevance agents wake first
  matches.sort((a, b) => b.confidence - a.confidence);
  // Limit to top 2 — don't wake the whole org on a single message (Simple principle)
  return matches.slice(0, 2);
}

// Get the patterns for a given role (used by the settings UI)
export function patternsForRole(role: string): AttentionPattern | undefined {
  return ATTENTION_PATTERNS.find((p) => p.role === role);
}
