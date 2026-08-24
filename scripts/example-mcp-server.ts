// An MCP server to point Vuno at, for anyone who has not got one yet.
//
//   bun run mcp:example        # http://127.0.0.1:4501/mcp
//
// Add it in Extensions → Connectors, give it to an agent, and the agent can
// call it. Three tools, chosen to exercise the three outcomes that matter: one
// that answers, one that answers with bad news, and one that refuses — an
// agent has to handle all three, and a server where everything succeeds proves
// nothing about the two that do not.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const build = () => {
  const s = new McpServer({ name: 'acme-observability', version: '1.4.0' });
  s.registerTool('p99_latency',
    { description: 'Read the p99 read latency for a service over a window.',
      inputSchema: { service: z.string(), windowHours: z.number().optional() } },
    async ({ service, windowHours }) => ({
      content: [{ type: 'text', text: `${service}: p99 142ms over ${windowHours ?? 24}h (10k concurrent readers, shared box)` }],
    }));
  s.registerTool('error_rate',
    { description: 'Read the 5xx rate for a service.', inputSchema: { service: z.string() } },
    async ({ service }) => ({ content: [{ type: 'text', text: `${service}: 0.04% 5xx over 24h` }] }));
  s.registerTool('deploy',
    { description: 'Deploy a service to staging.', inputSchema: { service: z.string() } },
    async ({ service }) => ({ content: [{ type: 'text', text: `refused: ${service} is behind a blocked release gate` }], isError: true }));
  return s;
};

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
Bun.serve({
  port: 4501,
  idleTimeout: 60,
  async fetch(req) {
    const sid = req.headers.get('mcp-session-id');
    const existing = sid ? sessions.get(sid) : undefined;
    if (existing) return existing.handleRequest(req);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });
    await build().connect(transport);
    return transport.handleRequest(req);
  },
});
console.log('acme-observability MCP on http://127.0.0.1:4501/mcp');
