import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { IngressEvent, SessionRow } from './types.js';
import type { Store } from './store.js';

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

export function buildHttpServer(onEvent: IngestHandler, store: Store): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2048 });

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type'],
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/active', async () => getActiveSnapshot(store));

  app.post('/event', { schema: { body: eventSchema } }, async (req, reply) => {
    const event = req.body as IngressEvent;
    onEvent(event);
    return reply.code(202).send({ accepted: true });
  });

  return app;
}
