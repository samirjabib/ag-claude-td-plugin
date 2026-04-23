import { describe, it, expect } from 'vitest';
import { buildHttpServer } from '../src/http-server.js';
import { createStore } from '../src/store.js';
import type { IngressEvent } from '../src/types.js';

function build(onEvent: (e: IngressEvent) => void = () => {}) {
  const store = createStore(':memory:');
  const app = buildHttpServer(onEvent, store);
  return { app, store };
}

describe('HTTP server', () => {
  it('GET /health returns 200', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await app.close();
  });

  it('GET /active returns active:false when nothing tracked', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/active' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ active: false, since: null, ticket: null });
    await app.close();
  });

  it('GET /active returns session snapshot when tracking', async () => {
    const { app, store } = build();
    store.upsertSession({
      ticket_id: 'T1',
      session_id: 's1',
      title: 'Demo',
      board_id: null,
      url: null,
      state: 'active',
      created_at: 100,
      last_active_at: 100,
    });
    store.setActiveTicket('T1', 100);
    const res = await app.inject({ method: 'GET', url: '/active' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.active).toBe(true);
    expect(body.since).toBe(100);
    expect(body.ticket).toMatchObject({ ticket_id: 'T1', title: 'Demo' });
    await app.close();
  });

  it('POST /event with valid body forwards to handler', async () => {
    const seen: IngressEvent[] = [];
    const { app } = build((e) => seen.push(e));
    const body = {
      action: 'start',
      ticket_id: '11820279584',
      source: 'extension',
      timestamp: 1700000000000,
      metadata: { title: 'AI-TESTING BILLING TOKEN' },
    };
    const res = await app.inject({ method: 'POST', url: '/event', payload: body });
    expect(res.statusCode).toBe(202);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ action: 'start', ticket_id: '11820279584' });
    await app.close();
  });

  it('POST /event with missing fields → 400', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'POST', url: '/event', payload: { action: 'start' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /event with unknown action → 400', async () => {
    const { app } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: { action: 'pause', ticket_id: 'X', source: 'extension', timestamp: 0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /event with empty ticket_id → 400', async () => {
    const { app } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: { action: 'start', ticket_id: '', source: 'extension', timestamp: 0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

});
