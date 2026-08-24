// Vuno — talking to an MCP server.
//
// Deliberately the reference client rather than a JSON-RPC client written here.
// The wire format is not the hard part; the session id handed back on
// initialize, the SSE-framed responses a server may answer with instead of
// JSON, and protocol-version negotiation are, and all three are places where a
// hand-rolled client works against the two servers it was tested on and fails
// against the third.
//
// What this file adds on top is the part that is ours: a call is made on behalf
// of a member who holds the connection, it is bounded in time, and the failure
// says which of the three things went wrong — the server was unreachable, the
// tool does not exist, or the tool ran and reported an error. An agent handed
// "call failed" cannot correct itself; an agent told "the argument `since` must
// be an ISO date" can.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** What a connection needs to be dialled. Not a database row — the caller resolves that. */
export interface Dialable {
  key: string;
  name: string;
  url: string;
  /** The env var holding a bearer token, or null when the server needs none. */
  authEnvVar?: string | null;
}

export interface DiscoveredTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments, as the server published it. */
  inputSchema: Record<string, unknown>;
}

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'unauthorised' | 'protocol',
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/** How long any one exchange with a server may take. */
export const CALL_TIMEOUT_MS = 30_000;

const CLIENT_INFO = { name: 'vuno', version: '1.0.0' };

/**
 * Resolve the bearer token, or explain what to set.
 *
 * The variable name is configuration and lives in the database; the value is a
 * secret and lives in the process. Nothing here ever writes the value back.
 */
function authHeaders(conn: Dialable): Record<string, string> {
  if (!conn.authEnvVar) return {};
  const token = process.env[conn.authEnvVar];
  if (!token) {
    throw new ConnectionError(
      `${conn.name} needs a token in ${conn.authEnvVar}, and that variable is not set in this process. ` +
        `Add ${conn.authEnvVar}=… to .env and restart.`,
      'unauthorised',
    );
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * An open conversation with one server.
 *
 * A session rather than a call, because a turn that reads a metric and then
 * reads another should not initialize twice: the handshake is a round trip and
 * some servers refuse a second one on the same connection. The turn opens one,
 * uses it, and closes it in a `finally`.
 */
export interface Session {
  listTools(): Promise<DiscoveredTool[]>;
  call(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

/** The HTTP status the SDK attaches to a transport error, when there is one. */
function statusOf(e: unknown): number | undefined {
  const code = (e as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

export async function openSession(conn: Dialable): Promise<Session> {
  const headers = authHeaders(conn);

  let url: URL;
  try {
    url = new URL(conn.url);
  } catch {
    throw new ConnectionError(`${conn.name} has "${conn.url}" as its address, which is not a URL.`, 'protocol');
  }
  // A URL parses far more than it should: `localhost:9000` is a valid URL with
  // the scheme `localhost:`, and dialling it fails much later with something
  // that reads like the server is down. This is the transport, so say so here.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectionError(
      `${conn.name} points at "${conn.url}". An MCP connection is dialled over http or https — ` +
        `"${url.protocol.replace(':', '')}" is not a transport this can use. Did you mean https://${conn.url}?`,
      'protocol',
    );
  }

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
  });
  const client = new Client(CLIENT_INFO, { capabilities: {} });

  try {
    await client.connect(transport);
  } catch (e) {
    const said = e instanceof Error ? e.message : String(e);
    // The status is a property on the error, not a word in its message — the
    // message for a 401 here is "Error POSTing to endpoint: no", which is the
    // server's body. Reading the code is the difference between "your token is
    // wrong" and "that server is not there", and those have different fixes.
    const status = statusOf(e);
    const unauthorised = status === 401 || status === 403;
    throw new ConnectionError(
      unauthorised
        ? `${conn.name} refused the credentials${conn.authEnvVar ? ` in ${conn.authEnvVar}` : ' (none were sent)'} with HTTP ${status}.`
        : `Could not reach ${conn.name} at ${conn.url}: ${said}`,
      unauthorised ? 'unauthorised' : 'unreachable',
    );
  }

  return {
    async listTools() {
      const listed = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS });
      return listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
      }));
    },

    async call(tool, args) {
      let result;
      try {
        result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
      } catch (e) {
        // Most of what goes wrong inside a call — an unknown tool, arguments
        // the schema rejects — comes back as a *result* with `failed`, because
        // the server reports it that way and a model can read it and correct
        // itself. This is the rest: the exchange itself did not complete.
        const said = e instanceof Error ? e.message : String(e);
        throw new ConnectionError(`${conn.name} failed while running "${tool}": ${said}`, 'unreachable');
      }

      const blocks = Array.isArray(result.content) ? result.content : [];
      const text = blocks
        .map((b) => {
          const block = b as { type?: string; text?: string };
          if (block.type === 'text' && typeof block.text === 'string') return block.text;
          // A tool that returns an image or a resource still has to say
          // something to a model that only reads text.
          return `[${block.type ?? 'content'}]`;
        })
        .join('\n')
        .trim();

      return {
        failed: result.isError === true,
        text,
        ...(result.structuredContent ? { structured: result.structuredContent as Record<string, unknown> } : {}),
      };
    },

    async close() {
      await client.close().catch(() => {
        // The exchange already happened; a server that will not say goodbye
        // cleanly is not a reason to fail the calls that succeeded.
      });
    },
  };
}

async function once<T>(conn: Dialable, fn: (s: Session) => Promise<T>): Promise<T> {
  const session = await openSession(conn);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/** What tools does this server offer? One session, for the Library's check. */
export async function discoverTools(conn: Dialable): Promise<DiscoveredTool[]> {
  return once(conn, (s) => s.listTools());
}

export interface ToolResult {
  /** The server ran the tool and it reported a failure — not a transport problem. */
  failed: boolean;
  /** The text the tool returned, flattened. What actually reaches the model. */
  text: string;
  /** The structured result, when the server sent one. */
  structured?: Record<string, unknown>;
}

/**
 * Call one tool in a session of its own.
 *
 * A tool that fails comes back as a result with `failed`, not as a throw. That
 * is the protocol's own distinction and it is the useful one: an error the tool
 * reported is something a model can read and correct, while a server that is
 * not there is not.
 */
export async function callTool(
  conn: Dialable,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return once(conn, (s) => s.call(tool, args));
}
