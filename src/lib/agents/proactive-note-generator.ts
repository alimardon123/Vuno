// Vuno — Proactive Note Generator
// The PA's "voice" — weaves learned facts into a natural proactive message.
// Per the design principle "Powerful": the PA doesn't just learn (MemoryUpdated
// badges) — it ACTS on what it learned, posting a brief proactive note that
// references the learned facts. This closes the learn→reference loop.
//
// Per the "Beautiful" principle: the note should feel like a real PA — warm,
// brief, references specific facts, offers a next action. NOT a robotic
// "I have learned: interest=Rust. sentiment=excited."
//
// Per the "Simple" principle: pure function, no state, no ML. Template-based
// generation with deterministic variation.

import type { DetectedFact } from './memory-detector';

export interface MemoryReference {
  factType: 'interest' | 'focus_area' | 'sentiment' | 'preference';
  key: string;
  value: string;
  memoryEventId: string;  // the MemoryUpdated event this references
}

export interface ProactiveNote {
  body: string;
  memoryReferences: MemoryReference[];
}

// Deterministic hash for picking variations
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Per-fact-type proactive note fragments.
// Each takes the fact + context and returns a sentence fragment.
function fragmentForFact(
  fact: DetectedFact,
  ownerName: string,
  isUpdate: boolean,
): string {
  switch (fact.factType) {
    case 'interest': {
      const variants = [
        `noting your interest in ${fact.value}`,
        `seeing ${fact.value} come up for you`,
        `${fact.value} is clearly on your radar`,
      ];
      return variants[hashString(fact.value) % variants.length]!;
    }
    case 'focus_area': {
      const variants = [
        `${fact.value} is now on my radar for you`,
        `I'll route ${fact.value.toLowerCase()}-related debates your way`,
        `flagging ${fact.value.toLowerCase()} as a focus area for you`,
      ];
      return variants[hashString(fact.value) % variants.length]!;
    }
    case 'sentiment': {
      if (isUpdate) {
        // Sentiment update — the emotional shift is worth noting
        const variants = [
          `your sentiment shifted — I'll factor that into how I prioritize proposals for you`,
          `noting the emotional context shift — I'll keep it in mind for future suggestions`,
          `I can see your mood changed — adjusting my recommendations accordingly`,
        ];
        return variants[hashString(fact.value) % variants.length]!;
      }
      // New sentiment
      if (fact.value === 'worried' || fact.value === 'anxious' || fact.value === 'frustrated' || fact.value === 'stressed') {
        const variants = [
          `I can see you're ${fact.value} about this — I'll keep an eye on related discussions and surface anything concerning`,
          `noting you're ${fact.value} — I'll flag related risks proactively`,
          `sensing you're ${fact.value} — want me to set up a watch on this topic?`,
        ];
        return variants[hashString(fact.value) % variants.length]!;
      }
      if (fact.value === 'excited') {
        const variants = [
          `love the excitement — I'll surface ${ownerName}-relevant opportunities as they come up`,
          `noting the energy — I'll prioritize surfacing relevant work`,
          `picking up the excitement — I'll keep relevant proposals on your radar`,
        ];
        return variants[hashString(fact.value) % variants.length]!;
      }
      if (fact.value === 'focused') {
        const variants = [
          `noting you're heads-down — I'll batch non-urgent notifications`,
          `sensing focus mode — I'll minimize interruptions`,
          `seeing you're in deep work — I'll hold non-critical pings`,
        ];
        return variants[hashString(fact.value) % variants.length]!;
      }
      return `noting your current state: ${fact.value}`;
    }
    case 'preference': {
      const variants = [
        `noting your preference for ${fact.value}`,
        `I'll remember you reach for ${fact.value}`,
        `saved: you prefer ${fact.value}`,
      ];
      return variants[hashString(fact.value) % variants.length]!;
    }
    default:
      return `noted: ${fact.key} → ${fact.value}`;
  }
}

// Opening line — warm, addresses the owner by name, sets the proactive tone.
function openingLine(ownerName: string): string {
  const variants = [
    `${ownerName} — `,
    `Hey ${ownerName}, `,
    `${ownerName}, `,
    ``,
  ];
  return variants[hashString(ownerName + Date.now().toString()) % variants.length]!;
}

// Closing line — offers a next action (the "proactive" part).
function closingLine(): string {
  const variants = [
    `Want me to set up a daily digest?`,
    `Ping me if you want me to adjust anything.`,
    `I'll keep this in mind for future proposals.`,
    `Let me know if you'd rather I not track this.`,
    `Happy to refine — just say the word.`,
  ];
  return variants[hashString(Date.now().toString()) % variants.length]!;
}

// Generate a proactive note from the learned facts.
// Input: the facts that were JUST learned (with their MemoryUpdated event IDs),
//        the owner's name, and whether each fact was new or an update.
// Output: a natural proactive note body + memory references for the 🧠 pills.
//
// The note structure:
//   [opening] [fact fragment 1][, fact fragment 2][, and fact fragment 3]. [closing]
//
// Caps at 3 fact fragments to keep the note brief (Simple principle).
export function generateProactiveNote(
  learnedFacts: Array<{ fact: DetectedFact; isUpdate: boolean; memoryEventId: string }>,
  ownerName: string,
): ProactiveNote {
  if (learnedFacts.length === 0) {
    return { body: '', memoryReferences: [] };
  }

  // Cap at 3 facts for the body (but include all in memoryReferences)
  const factsForBody = learnedFacts.slice(0, 3);
  const fragments = factsForBody.map((f) => fragmentForFact(f.fact, ownerName, f.isUpdate));

  // Build the body: opening + fragments joined + closing
  const opening = openingLine(ownerName);
  let body: string;
  if (fragments.length === 1) {
    body = `${opening}${fragments[0]}. ${closingLine()}`;
  } else if (fragments.length === 2) {
    body = `${opening}${fragments[0]}, and ${fragments[1]}. ${closingLine()}`;
  } else {
    body = `${opening}${fragments[0]}, ${fragments[1]}, and ${fragments[2]}. ${closingLine()}`;
  }

  // All learned facts become memory references (for the 🧠 pills)
  const memoryReferences: MemoryReference[] = learnedFacts.map((f) => ({
    factType: f.fact.factType,
    key: f.fact.key,
    value: f.fact.value,
    memoryEventId: f.memoryEventId,
  }));

  return { body, memoryReferences };
}
