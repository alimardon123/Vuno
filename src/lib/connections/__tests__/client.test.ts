// The client, against the reference server over real HTTP.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { callTool, ConnectionError, discoverTools } from '@/lib/connections/client';
import { startMcpServer, type Fixture } from './server';

let open: Fixture;
let guarded: Fixture;

beforeAll(async () => {
  open = await startMcpServer();
  guarded = await startMcpServer({ token: 'sekret' });
});

afterAll(async () => {
  await open.stop();
  await guarded.stop();
});

describe('discovering what a server offers', () => {
  test('the tools come back with their schemas', async () => {
    const tools = await discoverTools({ key: 'obs', name: 'Observability', url: open.url });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['deploy', 'p99_latency']);

    const p99 = tools.find((t) => t.name === 'p99_latency')!;
    expect(p99.description).toContain('p99 read latency');
    // The schema is what tells a model how to call it. Without it the model is
    // guessing at argument names.
    expect((p99.inputSchema.properties as Record<string, unknown>).service).toBeDefined();
    expect(p99.inputSchema.required).toEqual(['service']);
  });

  test('a server that is not there says so, and says where it looked', async () => {
    const err = await discoverTools({ key: 'gone', name: 'Nowhere', url: 'http://127.0.0.1:1/mcp' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as ConnectionError).kind).toBe('unreachable');
    expect((err as ConnectionError).message).toContain('127.0.0.1:1');
  });

  test('an address that is not a URL is refused before anything is dialled', async () => {
    const err = await discoverTools({ key: 'bad', name: 'Bad', url: 'not a url at all' }).catch((e) => e);
    expect((err as ConnectionError).kind).toBe('protocol');
    expect((err as ConnectionError).message).toContain('not a URL');
  });

  test('a host with no scheme is refused with the correction', async () => {
    // `localhost:9999` parses: the scheme is `localhost:` and the path is
    // `9999`. Dialling it fails much later, reading like a server that is down.
    const err = await discoverTools({ key: 'bad', name: 'Bad', url: 'localhost:9999' }).catch((e) => e);
    expect((err as ConnectionError).kind).toBe('protocol');
    expect((err as ConnectionError).message).toContain('https://localhost:9999');
  });
});

describe('calling a tool', () => {
  test('the result comes back as text a model can read', async () => {
    const out = await callTool(
      { key: 'obs', name: 'Observability', url: open.url },
      'p99_latency',
      { service: 'storage-engine', windowHours: 6 },
    );
    expect(out.failed).toBe(false);
    expect(out.text).toBe('storage-engine: p99 142ms over 6h');
    // And the server really ran it, with the arguments as sent.
    expect(open.calls.at(-1)).toEqual({ tool: 'p99_latency', args: { service: 'storage-engine', windowHours: 6 } });
  });

  test('a tool that fails is a result, not a throw', async () => {
    // The protocol's own distinction, and the useful one: a model can read a
    // reported failure and correct itself. A thrown transport error just ends
    // the turn.
    const out = await callTool({ key: 'obs', name: 'Observability', url: open.url }, 'deploy', { service: 'api' });
    expect(out.failed).toBe(true);
    expect(out.text).toContain('blocked release gate');
  });

  test('a tool that does not exist comes back readable, not as a throw', async () => {
    // The server answers an unknown tool the same way it answers a tool that
    // failed, and that is the useful shape: the name it could not find is in
    // the text, so a model that guessed a tool name can read that and pick a
    // real one instead of the turn ending.
    const out = await callTool({ key: 'obs', name: 'Observability', url: open.url }, 'nonesuch', {});
    expect(out.failed).toBe(true);
    expect(out.text).toContain('nonesuch');
  });

  test('arguments the schema rejects come back readable too', async () => {
    const out = await callTool({ key: 'obs', name: 'Observability', url: open.url }, 'p99_latency', {});
    expect(out.failed).toBe(true);
    // Naming the field is the whole point — "invalid arguments" is not
    // something an agent can act on.
    expect(out.text).toContain('service');
  });
});

describe('a server behind a token', () => {
  const conn = { key: 'g', name: 'Guarded', url: '', authEnvVar: 'VUNO_TEST_MCP_TOKEN' };

  test('the token comes from the process, never from the row', async () => {
    process.env.VUNO_TEST_MCP_TOKEN = 'sekret';
    const tools = await discoverTools({ ...conn, url: guarded.url });
    expect(tools.map((t) => t.name)).toContain('p99_latency');
  });

  test('a missing variable is refused by naming the variable', async () => {
    delete process.env.VUNO_TEST_MCP_TOKEN;
    const err = await discoverTools({ ...conn, url: guarded.url }).catch((e) => e);
    expect((err as ConnectionError).kind).toBe('unauthorised');
    // The whole value of the message: it says what to set and where.
    expect((err as ConnectionError).message).toContain('VUNO_TEST_MCP_TOKEN');
    expect((err as ConnectionError).message).toContain('.env');
  });

  test('a wrong token is told apart from an unreachable server', async () => {
    process.env.VUNO_TEST_MCP_TOKEN = 'wrong';
    const err = await discoverTools({ ...conn, url: guarded.url }).catch((e) => e);
    expect((err as ConnectionError).kind).toBe('unauthorised');
    delete process.env.VUNO_TEST_MCP_TOKEN;
  });
});
