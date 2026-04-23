import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IngressEvent, SessionRow } from './types.js';
import type { Store } from './store.js';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

export type IngestHandler = (event: IngressEvent) => void;

export interface ActiveSnapshot {
  active: boolean;
  since: number | null;
  ticket: SessionRow | null;
}

export function getActiveSnapshot(store: Store): ActiveSnapshot {
  const active = store.getActiveTicket();
  if (!active.ticket_id) return { active: false, since: null, ticket: null };
  return {
    active: true,
    since: active.since,
    ticket: store.getSession(active.ticket_id),
  };
}

const eventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'ticket_id', 'source', 'timestamp'],
  properties: {
    action: { type: 'string', enum: ['start', 'stop'] },
    ticket_id: { type: 'string', minLength: 1 },
    source: { type: 'string', enum: ['extension', 'api'] },
    timestamp: { type: 'number' },
    metadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        board_id: { type: 'string' },
        view_id: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
} as const;

export function buildHttpServer(
  onEvent: IngestHandler,
  store: Store,
  logger: Logger,
  metrics: Metrics,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2048 });

  app.get('/health', async () => ({ ok: true }));

  app.get('/active', async () => getActiveSnapshot(store));

  app.get('/metrics', async () => metrics.snapshot());

  app.post('/event', { schema: { body: eventSchema } }, async (req, reply) => {
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : randomUUID();
    const event = {
      ...(req.body as IngressEvent),
      request_id: requestId,
    };
    logger.info('http_event_accepted', {
      request_id: requestId,
      ticket_id: event.ticket_id,
      action: event.action,
      source: event.source,
    });
    metrics.recordAcceptedRequest();
    onEvent(event);
    return reply.code(202).send({ accepted: true });
  });

  app.setErrorHandler(async (err, req, reply) => {
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : randomUUID();
    const statusCode =
      typeof err === 'object' && err && 'statusCode' in err && typeof err.statusCode === 'number'
        ? err.statusCode
        : 500;
    const message =
      typeof err === 'object' && err && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'unknown error';
    metrics.recordRejectedRequest();
    logger.warn('http_request_rejected', {
      request_id: requestId,
      method: req.method,
      url: req.url,
      status_code: statusCode,
      error: message,
    });
    return reply.status(statusCode).send({
      error: message,
      request_id: requestId,
    });
  });

  return app;
}
