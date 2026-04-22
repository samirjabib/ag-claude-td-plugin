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

  it('dedups events with same key within TTL', async () => {
    const seen: string[] = [];
    const queue = createEventQueue(async (e) => {
      seen.push(`${e.action}:${e.ticket_id}:${e.timestamp}`);
    }, { dedupWindowMs: 5000 });

    queue.enqueue(evt({ action: 'start', ticket_id: 'T1', timestamp: 1000 }));
    queue.enqueue(evt({ action: 'start', ticket_id: 'T1', timestamp: 1002 })); // dup (within 5s of first-seen)
    queue.enqueue(evt({ action: 'start', ticket_id: 'T1', timestamp: 7000 })); // not dup (>= 5s after last-seen)

    await queue.drain();
    expect(seen).toEqual(['start:T1:1000', 'start:T1:7000']);
  });
});
