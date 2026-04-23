#!/usr/bin/env node
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
import { buildTools } from './tools.js';
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

const tools = buildTools(store);
const resources = buildResourceHandlers(store);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.definitions.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  // The SDK's ServerResult union is a superset of the CallToolResult shape
  // we return (`{ content: [...] }`); cast is safe per tool-call contract.
  return tools.dispatch(req.params.name, args) as unknown as never;
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

const httpApp = buildHttpServer((event) => queue.enqueue(event), store);
await httpApp.listen({ port: HTTP_PORT, host: '127.0.0.1' });

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await httpApp.close();
    store.close();
  } catch (err) {
    console.error(`[td-bridge] shutdown error on ${signal}`, err);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
