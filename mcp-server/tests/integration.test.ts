import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/store.js';
import { createCandado } from '../src/candado.js';
import { createEventQueue } from '../src/event-queue.js';
import { buildHttpServer } from '../src/http-server.js';
import { buildNotifications } from '../src/notifications.js';
import { createLogger } from '../src/logger.js';
import { createMetrics } from '../src/metrics.js';
import type { IngressEvent } from '../src/types.js';

describe('HTTP → queue → candado integration', () => {
  it('persists concurrent start events in order and emits notifications', async () => {
    const store = createStore(':memory:');
    const candado = createCandado(store);
    const send = vi.fn();
    const notify = buildNotifications(send);
    const queue = createEventQueue(async (event: IngressEvent) => {
      notify(candado.apply(event));
    });
    const app = buildHttpServer(
      (event) => queue.enqueue(event),
      store,
      createLogger({ test: 'integration' }),
      createMetrics(),
    );

    const first = {
      action: 'start',
      ticket_id: 'A',
      source: 'extension',
      timestamp: 1000,
      metadata: { title: 'A' },
    };
    const second = {
      action: 'start',
      ticket_id: 'B',
      source: 'extension',
      timestamp: 2000,
      metadata: { title: 'B' },
    };

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/event', payload: first }),
      app.inject({ method: 'POST', url: '/event', payload: second }),
    ]);

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    await queue.drain();

    expect(store.getActiveTicket()).toEqual({ ticket_id: 'B', since: 2000 });
    expect(store.getSession('A')).toMatchObject({ state: 'paused', last_active_at: 2000 });
    expect(store.getSession('B')).toMatchObject({ state: 'active', last_active_at: 2000 });
    expect(send).toHaveBeenCalledWith(
      'notifications/message',
      expect.objectContaining({
        data: expect.objectContaining({ event: 'tracking_switched', from_ticket: 'A', to_ticket: 'B' }),
      }),
    );

    await app.close();
  });
});
