// A real MCP server, for the tests to talk to.
//
// Not a mock of one. The point of these tests is that the client speaks the
// protocol correctly, and a mock written from the same understanding as the
// client would agree with the client whether or not either was right. This
// runs the reference server implementation over real HTTP, so a wrong header,
// a mishandled session id or an SSE-framed response the client cannot read
// shows up as a failure rather than as a passing test.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

export interface Fixture {
  url: string;
  /** Every tool call the server actually received, in order. */
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  stop(): Promise<void>;
}

/**
 * @param token when set, the server refuses any request without this bearer.
 */
export async function startMcpServer(opts: { token?: string } = {}): Promise<Fixture> {
  const calls: Fixture['calls'] = [];

  const build = () => {
  const server = new McpServer({ name: 'vuno-test-server', version: '1.0.0' });

  server.registerTool(
    'p99_latency',
    {
      description: 'Read the p99 read latency for a service over a window.',
      inputSchema: { service: z.string(), windowHours: z.number().optional() },
    },
    async ({ service, windowHours }) => {
      calls.push({ tool: 'p99_latency', args: { service, windowHours } });
      return { content: [{ type: 'text', text: `${service}: p99 142ms over ${windowHours ?? 24}h` }] };
    },
  );

  server.registerTool(
    'deploy',
    { description: 'Deploy a service. Always refuses here.', inputSchema: { service: z.string() } },
    async ({ service }) => {
      calls.push({ tool: 'deploy', args: { service } });
      // A tool that fails reports it in the result, not as a protocol error —
      // that is what lets a model read the reason and correct itself.
      return { content: [{ type: 'text', text: `refused: ${service} is behind a blocked release gate` }], isError: true };
    },
  );

    return server;
  };

  // A server and a transport per session, routed by `mcp-session-id` — the
  // pattern the SDK's own examples use. Sharing one transport answers the
  // second initialize with "Server already initialized"; sharing one server
  // answers it with "Already connected to a transport". Both were found by
  // running these tests rather than by reading about them.
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const servers: McpServer[] = [];

  const http = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(req) {
      if (opts.token && req.headers.get('authorization') !== `Bearer ${opts.token}`) {
        return new Response('no', { status: 401 });
      }

      const sid = req.headers.get('mcp-session-id');
      const existing = sid ? sessions.get(sid) : undefined;
      if (existing) return existing.handleRequest(req);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      const server = build();
      servers.push(server);
      await server.connect(transport);
      return transport.handleRequest(req);
    },
  });

  return {
    url: `http://127.0.0.1:${http.port}/mcp`,
    calls,
    async stop() {
      for (const t of sessions.values()) await t.close().catch(() => {});
      for (const s of servers) await s.close().catch(() => {});
      await http.stop(true);
    },
  };
}
