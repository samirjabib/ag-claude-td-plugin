import { describe, it, expect } from 'vitest';
import { createEventQueue } from '../src/event-queue.js';
import type { IngressEvent } from '../src/types.js';

const evt = (overrides: Partial<IngressEvent>): IngressEvent => ({
  action: 'start',
  ticket_id: 'T1',
  source: 'extension',
  timestamp: 1000,
  ...overrides,
});

describe('EventQueue', () => {
  it('processes events in FIFO order', async () => {
    const seen: string[] = [];
    const queue = createEventQueue(async (e) => {
      seen.push(`${e.action}:${e.ticket_id}`);
    });

    queue.enqueue(evt({ action: 'start', ticket_id: 'A' }));
    queue.enqueue(evt({ action: 'start', ticket_id: 'B' }));
    queue.enqueue(evt({ action: 'stop', ticket_id: 'B' }));

    await queue.drain();
    expect(seen).toEqual(['start:A', 'start:B', 'stop:B']);
  });

  it('processes one event at a time even when handler is async', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const queue = createEventQueue(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });

    for (let i = 0; i < 5; i++) queue.enqueue(evt({ ticket_id: `T${i}` }));
    await queue.drain();
    expect(maxInFlight).toBe(1);
  });

  it('dedups events with same key within TTL using server-side clock', async () => {
    const seen: string[] = [];
    let serverTime = 10_000;
    const queue = createEventQueue(
      async (e) => {
        seen.push(`${e.action}:${e.ticket_id}:${e.timestamp}`);
      },
      { dedupWindowMs: 5000, now: () => serverTime },
    );

    // First admitted.
    queue.enqueue(evt({ action: 'start', ticket_id: 'T1', timestamp: 1000 }));
    await queue.drain();

    // Server clock advances 2s -> inside window -> dropped.
    serverTime = 12_000;
    queue.enqueue(evt({ action: 'start', ticket_id: 'T1', timestamp: 999_999 }));
    await queue.drain();

    // Server clock advances past window -> admitted.
    serverTime = 16_000;
    queue.enqueue(evt({ action: 'start', ticket_id: 'T1', timestamp: 42 }));
    await queue.drain();

    expect(seen).toEqual(['start:T1:1000', 'start:T1:42']);
  });

  it('keeps distinct metadata variants inside the dedup window', async () => {
    const seen: string[] = [];
    const queue = createEventQueue(async (e) => {
      seen.push(`${e.ticket_id}:${e.metadata?.title ?? 'untitled'}`);
    });

    queue.enqueue(evt({ ticket_id: 'T1', metadata: { title: 'First' } }));
    queue.enqueue(evt({ ticket_id: 'T1', metadata: { title: 'Second' } }));
    await queue.drain();

    expect(seen).toEqual(['T1:First', 'T1:Second']);
  });

  it('keeps the loop alive when a handler throws', async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const queue = createEventQueue(
      async (e) => {
        if (e.ticket_id === 'BOOM') throw new Error('bang');
        seen.push(e.ticket_id);
      },
      { onError: (err) => errors.push(err) },
    );

    queue.enqueue(evt({ ticket_id: 'A' }));
    queue.enqueue(evt({ ticket_id: 'BOOM' }));
    queue.enqueue(evt({ ticket_id: 'B' }));
    await queue.drain();

    expect(seen).toEqual(['A', 'B']);
    expect(errors).toHaveLength(1);
  });
});
