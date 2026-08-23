// `@bob` brings Bob in. What this replaced matched substrings anywhere in a
// message — the word "security" in "I am worried about the security of the new
// read path" woke two agents, who replied with hand-written text. A summons is
// a lookup against handles that exist, and nothing else.

import { describe, expect, test } from 'bun:test';
import { extractHandles } from '@/lib/mentions';

describe('a mention is a handle, not a topic', () => {
  test('the handle is picked out of a sentence', () => {
    expect(extractHandles('@bob has the current state — give Mira the honest version'))
      .toEqual(['bob']);
  });

  test('several mentions come back in the order they were written', () => {
    expect(extractHandles('@peri and @sid — can one of you look?')).toEqual(['peri', 'sid']);
  });

  test('the same handle twice is one summons', () => {
    expect(extractHandles('@bob, and again @bob')).toEqual(['bob']);
  });

  test('mentions are case-insensitive but resolve to one handle', () => {
    expect(extractHandles('@Bob and @BOB')).toEqual(['bob']);
  });

  test('a topic is not a mention — the keyword-matching bug cannot recur', () => {
    expect(extractHandles('I am worried about the security of the new read path')).toEqual([]);
    expect(extractHandles('perf is bad and the architecture needs review')).toEqual([]);
  });

  test('an email address does not summon its domain', () => {
    expect(extractHandles('mail kai@acme.storage about it')).toEqual([]);
  });

  test('trailing punctuation is not part of the handle', () => {
    expect(extractHandles('thanks @bob.')).toEqual(['bob']);
    expect(extractHandles('@sid, @peri: thoughts?')).toEqual(['sid', 'peri']);
  });

  test('a bare @ summons nobody', () => {
    expect(extractHandles('email me @ the usual address')).toEqual([]);
    expect(extractHandles('@')).toEqual([]);
  });

  test('handles inside words are not mentions', () => {
    expect(extractHandles('see docs/api@v2 for the shape')).toEqual([]);
  });
});
