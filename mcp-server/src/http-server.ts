import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { IngressEvent } from './types.js';

export type IngestHandler = (event: IngressEvent) => void;

export function buildHttpServer(onEvent: IngestHandler): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type'],
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/event', async (req, reply) => {
    const body = req.body as Partial<IngressEvent> | undefined;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    if (body.action !== 'start' && body.action !== 'stop') {
      return reply.code(400).send({ error: 'invalid_action' });
    }
    if (typeof body.ticket_id !== 'string' || body.ticket_id.length === 0) {
      return reply.code(400).send({ error: 'invalid_ticket_id' });
    }
    if (body.source !== 'extension') {
      return reply.code(400).send({ error: 'invalid_source' });
    }
    if (typeof body.timestamp !== 'number' || !Number.isFinite(body.timestamp)) {
      return reply.code(400).send({ error: 'invalid_timestamp' });
    }
    const event: IngressEvent = {
      action: body.action,
      ticket_id: body.ticket_id,
      source: body.source,
      timestamp: body.timestamp,
      metadata: body.metadata,
    };
    onEvent(event);
    return reply.code(202).send({ accepted: true });
  });

  return app;
}
