#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { FastifyInstance } from 'fastify';
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
import { buildNotifications, sendBridgeMessage } from './notifications.js';
import { buildTools } from './tools.js';
import { buildResourceHandlers } from './resources.js';
import { createLogger } from './logger.js';
import { createMetrics } from './metrics.js';

const HTTP_PORT = Number(process.env.TD_BRIDGE_PORT ?? 47821);
const PORT_SCAN_LIMIT = Number(process.env.TD_BRIDGE_PORT_SCAN_LIMIT ?? 10);
const DB_DIR = join(homedir(), '.td-claude-bridge');
const DB_PATH = process.env.TD_BRIDGE_DB ?? join(DB_DIR, 'state.db');
const STALE_TOLERANCE_MS = Number(process.env.TD_BRIDGE_STALE_TOLERANCE_MS ?? 0);

mkdirSync(DB_DIR, { recursive: true });

const store = createStore(DB_PATH);
const logger = createLogger({ service: 'td-bridge' });
const metrics = createMetrics();
const candado = createCandado(store, {
  staleToleranceMs: STALE_TOLERANCE_MS,
  onLockWait(waitMs) {
    metrics.recordLockWait(waitMs);
  },
});

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
  const startedAt = performance.now();
  if (event.metadata?.url && !/\/pulses\/\d+/.test(event.metadata.url)) {
    logger.warn('partial_ticket_context', {
      request_id: event.request_id ?? null,
      ticket_id: event.ticket_id,
      action: event.action,
      board_id: event.metadata?.board_id ?? null,
      view_id: event.metadata?.view_id ?? null,
      url: event.metadata?.url ?? null,
    });
    sendBridgeMessage(
      (method, params) => {
        void mcp.notification({ method, params } as Parameters<typeof mcp.notification>[0]);
      },
      'warning',
      {
        event: 'tracking_partial_context',
        ticket_id: event.ticket_id,
        board_id: event.metadata?.board_id ?? null,
        view_id: event.metadata?.view_id ?? null,
        url: event.metadata?.url ?? null,
      },
    );
  }
  const outcome = candado.apply(event);
  if (outcome.kind === 'ignored') {
    metrics.recordIgnored(outcome.reason);
    logger.warn('event_ignored', {
      request_id: event.request_id ?? null,
      ticket_id: event.ticket_id,
      action: event.action,
      reason: outcome.reason,
      active_tolerance_ms: STALE_TOLERANCE_MS,
    });
  } else {
    logger.info('event_applied', {
      request_id: event.request_id ?? null,
      ticket_id: event.ticket_id,
      action: event.action,
      outcome: outcome.kind,
    });
  }
  emitNotification(outcome);
  metrics.recordHandlerDuration(performance.now() - startedAt);
}, {
  onDepthChange(depth) {
    metrics.recordQueueDepth(depth);
  },
  onError(err, event) {
    metrics.recordHandlerFailure();
    logger.error('event_handler_failed', {
      request_id: event.request_id ?? null,
      ticket_id: event.ticket_id,
      action: event.action,
      error: err instanceof Error ? err.message : String(err),
    });
  },
});

async function listenWithFallback(app: FastifyInstance, preferredPort: number, host: string): Promise<number> {
  let lastError: unknown = null;
  for (let offset = 0; offset <= PORT_SCAN_LIMIT; offset += 1) {
    const port = preferredPort + offset;
    try {
      await app.listen({ port, host });
      if (offset > 0) {
        logger.warn('http_port_fallback', {
          preferred_port: preferredPort,
          bound_port: port,
          host,
        });
      }
      return port;
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: string }).code : undefined;
      lastError = err;
      if (code !== 'EADDRINUSE') throw err;
    }
  }
  logger.error('http_listen_failed', {
    preferred_port: preferredPort,
    host,
    scan_limit: PORT_SCAN_LIMIT,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new Error(`could not bind td-bridge after scanning ${PORT_SCAN_LIMIT + 1} ports from ${preferredPort}`);
}

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

const httpApp = buildHttpServer((event) => queue.enqueue(event), store, logger, metrics);
const boundPort = await listenWithFallback(httpApp, HTTP_PORT, '127.0.0.1');
logger.info('http_server_listening', {
  host: '127.0.0.1',
  port: boundPort,
  db_path: DB_PATH,
  stale_tolerance_ms: STALE_TOLERANCE_MS,
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await queue.drain();
    await httpApp.close();
    store.close();
  } catch (err) {
    logger.error('shutdown_error', {
      signal,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
