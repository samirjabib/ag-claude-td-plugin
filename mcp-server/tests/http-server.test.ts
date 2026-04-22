import { describe, it, expect } from 'vitest';
import { buildHttpServer } from '../src/http-server.js';
import type { IngressEvent } from '../src/types.js';

describe('HTTP server', () => {
  it('GET /health returns 200', async () => {
    const seen: IngressEvent[] = [];
    const app = buildHttpServer((e) => seen.push(e));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await app.close();
  });

  it('POST /event with valid body forwards to handler', async () => {
    const seen: IngressEvent[] = [];
    const app = buildHttpServer((e) => seen.push(e));
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
    const app = buildHttpServer(() => {});
    const res = await app.inject({ method: 'POST', url: '/event', payload: { action: 'start' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /event with unknown action → 400', async () => {
    const app = buildHttpServer(() => {});
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: { action: 'pause', ticket_id: 'X', source: 'extension', timestamp: 0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
