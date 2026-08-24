// Vuno — the two facts about a call that the browser also needs.
//
// Deliberately a module of its own, importing nothing. `@/lib/calls` reaches
// for the database on its first line, so a client component that asked it for
// the seat cap bundled Prisma into the browser and the whole conversation view
// stopped rendering. A constant and a pure function do not need a database, and
// keeping them where they cannot acquire one is the fix that stays fixed.

/** How many people may be in one call. Mesh topology: every pair connects. */
export const MAX_PARTICIPANTS = 6;

/**
 * A call in a DM rings; a call in a channel does not.
 *
 * They are not the same thing, and treating them alike gets one of them wrong.
 * Two people in a DM expect the phone to go — that is what a call *is* between
 * two people. A channel can have two hundred members, and ringing all of them
 * because somebody wanted to talk to three is indefensible; there a call is a
 * room that is open, and you join it if it concerns you.
 */
export type CallStyle = 'ring' | 'room';

export function styleFor(kind: string): CallStyle {
  return kind === 'dm' || kind === 'group' ? 'ring' : 'room';
}
