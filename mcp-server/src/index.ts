import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from './store.js';
import { createCandado } from './candado.js';
import { createEventQueue } from './event-queue.js';
import { buildHttpServer } from './http-server.js';
import { buildNotifications } from './notifications.js';
import { buildToolHandlers, TOOL_DEFINITIONS } from './tools.js';
import { buildResourceHandlers } from './resources.js';

const HTTP_PORT = Number(process.env.TD_BRIDGE_PORT ?? 47821);
const DB_DIR = join(homedir(), '.td-claude-bridge');
const DB_PATH = process.env.TD_BRIDGE_DB ?? join(DB_DIR, 'state.db');

mkdirSync(DB_DIR, { recursive: true });

const store = createStore(DB_PATH);
const candado = createCandado(store);

const mcp = new Server(
  { name: 'td-claude-bridge', version: '0.0.1' },
  {
    capabilities: {
      tools: {},
      resources: { subscribe: true, listChanged: true },
      logging: {},
    },
  },
);

const emitNotification = buildNotifications((method, params) => {
  void mcp.notification({ method, params } as Parameters<typeof mcp.notification>[0]);
});

const queue = createEventQueue(async (event) => {
  const outcome = candado.apply(event);
  emitNotification(outcome);
});

const tools = buildToolHandlers(store);
const resources = buildResourceHandlers(store);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS.map((t) => ({ ...t })),
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  let result: unknown;
  if (name === 'get_active_ticket') result = await tools.get_active_ticket(args);
  else if (name === 'get_session') result = await tools.get_session(args as { ticket_id: string });
  else if (name === 'list_sessions') result = await tools.list_sessions(args);
  else throw new Error(`unknown tool: ${name}`);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

mcp.setRequestHandler(ListResourcesRequestSchema, async () => {
  const items = await resources.list();
  return {
    resources: items.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: 'application/json',
    })),
  };
});

mcp.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const text = await resources.read(req.params.uri);
  if (text === null) throw new Error(`unknown resource: ${req.params.uri}`);
  return {
    contents: [{ uri: req.params.uri, mimeType: 'application/json', text }],
  };
});

// Order matters: connect MCP transport BEFORE binding HTTP port.
const transport = new StdioServerTransport();
await mcp.connect(transport);

const httpApp = buildHttpServer((event) => queue.enqueue(event));
await httpApp.listen({ port: HTTP_PORT, host: '127.0.0.1' });

process.on('SIGINT', async () => {
  await httpApp.close();
  store.close();
  process.exit(0);
});
