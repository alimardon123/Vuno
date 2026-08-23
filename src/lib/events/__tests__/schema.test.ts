// The spine is append-only, so these tests are the only thing standing between a
// model's typo and a permanent row. Each case below is something a real model
// has plausibly produced.

import { describe, expect, test } from 'bun:test';
import { parseAgentOutput, type AgentOutputContext } from '../schema';

const ctx: AgentOutputContext = {
  actorMemberId: 'agent-aris',
  defaultScopeType: 'channel',
  defaultScopeId: 'ch-storage-engine',
  defaultClaimScopeType: 'project',
  defaultClaimScopeId: 'proj-storage-engine',
};

describe('parseAgentOutput — accepts what is valid', () => {
  test('a well-formed event keeps its payload and gains actor + scope', () => {
    const out = parseAgentOutput(
      { events: [{ type: 'MessagePosted', payload: { body: 'Benchmark is running.' } }] },
      ctx,
    );

    expect(out.rejections).toEqual([]);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({
      type: 'MessagePosted',
      actorType: 'member',
      actorMemberId: 'agent-aris',
      scopeType: 'channel',
      scopeId: 'ch-storage-engine',
      payload: { body: 'Benchmark is running.' },
    });
  });

  test('an explicit scope from the model wins over the default', () => {
    const out = parseAgentOutput(
      {
        events: [
          { type: 'ObjectionRaised', scopeType: 'decision', scopeId: 'dec-8f2a1c', payload: { body: 'Working set exceeds RAM.' } },
        ],
      },
      ctx,
    );

    expect(out.rejections).toEqual([]);
    expect(out.events[0]).toMatchObject({ scopeType: 'decision', scopeId: 'dec-8f2a1c' });
  });

  test('claims fall back to the claim scope, not the channel scope', () => {
    const out = parseAgentOutput(
      { claims: [{ statement: 'p99 < 50ms at 10k readers', status: 'believed' }] },
      ctx,
    );

    expect(out.rejections).toEqual([]);
    expect(out.claims[0]).toEqual({
      statement: 'p99 < 50ms at 10k readers',
      status: 'believed',
      scopeType: 'project',
      scopeId: 'proj-storage-engine',
    });
  });

  test('a missing events key is not an error — the agent simply said nothing', () => {
    const out = parseAgentOutput({ claims: [] }, ctx);
    expect(out).toEqual({ events: [], claims: [], rejections: [] });
  });
});

describe('parseAgentOutput — rejects what would corrupt the log', () => {
  test('a misspelled event type never reaches the spine', () => {
    const out = parseAgentOutput(
      { events: [{ type: 'ProposalOpend', payload: { title: 'LSM tree' } }] },
      ctx,
    );

    expect(out.events).toEqual([]);
    expect(out.rejections).toHaveLength(1);
    expect(out.rejections[0].at).toBe('events[0]');
    expect(out.rejections[0].received).toContain('ProposalOpend');
  });

  test('an invented claim status is refused', () => {
    const out = parseAgentOutput(
      { claims: [{ statement: 'Redis is faster', status: 'probably true' }] },
      ctx,
    );

    expect(out.claims).toEqual([]);
    expect(out.rejections[0].at).toBe('claims[0]');
  });

  test('an invented scope type is refused rather than defaulted', () => {
    const out = parseAgentOutput(
      { events: [{ type: 'MessagePosted', scopeType: 'workspace', payload: { body: 'hi' } }] },
      ctx,
    );

    expect(out.events).toEqual([]);
    expect(out.rejections[0].reason).toContain('scopeType');
  });

  test('an empty payload is refused', () => {
    const out = parseAgentOutput({ events: [{ type: 'AgentThought', payload: {} }] }, ctx);
    expect(out.events).toEqual([]);
    expect(out.rejections[0].reason).toContain('payload');
  });

  test('a ClaimStatusChanged that does not change status is refused', () => {
    const out = parseAgentOutput(
      {
        events: [
          {
            type: 'ClaimStatusChanged',
            payload: { claimId: 'clm-p99', from: 'believed', to: 'believed', reason: 'no change' },
          },
        ],
      },
      ctx,
    );

    expect(out.events).toEqual([]);
    expect(out.rejections[0].at).toContain('ClaimStatusChanged');
  });

  test('a ClaimStatusChanged missing its reason is refused', () => {
    const out = parseAgentOutput(
      { events: [{ type: 'ClaimStatusChanged', payload: { claimId: 'clm-p99', from: 'believed', to: 'falsified' } }] },
      ctx,
    );

    expect(out.events).toEqual([]);
    expect(out.rejections[0].reason).toContain('reason');
  });

  test('a benchmark reporting a string value is refused', () => {
    const out = parseAgentOutput(
      { events: [{ type: 'BenchmarkReported', payload: { metric: 'p99', value: '91ms', unit: 'ms' } }] },
      ctx,
    );

    expect(out.events).toEqual([]);
    expect(out.rejections[0].at).toContain('BenchmarkReported');
  });

  test('prose instead of JSON yields a rejection, never a throw', () => {
    const out = parseAgentOutput('I think we should use an LSM tree.', ctx);
    expect(out.events).toEqual([]);
    expect(out.rejections).toHaveLength(1);
    expect(out.rejections[0].at).toBe('response');
  });

  test('null and undefined are handled', () => {
    for (const raw of [null, undefined]) {
      const out = parseAgentOutput(raw, ctx);
      expect(out.events).toEqual([]);
      expect(out.rejections).toHaveLength(1);
    }
  });
});

describe('parseAgentOutput — a bad item does not discard the good ones', () => {
  test('two valid events survive alongside one invalid', () => {
    const out = parseAgentOutput(
      {
        events: [
          { type: 'MessagePosted', payload: { body: 'first' } },
          { type: 'NotARealEvent', payload: { body: 'second' } },
          { type: 'MessagePosted', payload: { body: 'third' } },
        ],
      },
      ctx,
    );

    expect(out.events).toHaveLength(2);
    expect(out.events.map((e) => (e.payload as { body: string }).body)).toEqual(['first', 'third']);
    expect(out.rejections).toHaveLength(1);
    expect(out.rejections[0].at).toBe('events[1]');
  });

  test('a rejection names the item and the reason, for a log line worth reading', () => {
    const out = parseAgentOutput({ events: [{ type: 'MessagePosted', payload: { body: '' } }] }, ctx);
    expect(out.rejections[0].at).toContain('MessagePosted');
    expect(out.rejections[0].reason.length).toBeGreaterThan(0);
  });
});
