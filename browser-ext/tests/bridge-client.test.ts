import { describe, it, expect, vi } from 'vitest';
import { createBridgeClient } from '../src/bridge-client.js';
import type { BridgePayload } from '../src/types.js';

function payload(): BridgePayload {
  return {
    action: 'start',
    ticket_id: 'T1',
    source: 'extension',
    timestamp: 1000,
    metadata: {
      title: 'Task',
      board_id: '1',
      view_id: '2',
      url: 'https://x.monday.com/boards/1/views/2/pulses/3',
    },
  };
}

function makeStorage(initial: unknown[] = []) {
  let state = [...initial];
  return {
    storage: {
      async get() {
        return { td_bridge_retry_queue: state };
      },
      async set(items: Record<string, unknown>) {
        state = (items.td_bridge_retry_queue as unknown[]) ?? [];
      },
    },
    read() {
      return state;
    },
  };
}

describe('bridge client', () => {
  it('scans fallback ports until it reaches the bridge', async () => {
    const { storage } = makeStorage();
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes(':47821/')) throw new Error('connect ECONNREFUSED');
      return new Response(null, { status: 202 });
    });
    const alarms = { create: vi.fn(), clear: vi.fn() };
    const client = createBridgeClient({ fetchFn: fetchFn as typeof fetch, storage, alarms });

    const result = await client.forwardOrQueue(payload());

    expect(result).toMatchObject({ ok: true, port: 47822 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('queues retryable failures in chrome.storage.local', async () => {
    const { storage, read } = makeStorage();
    const fetchFn = vi.fn(async () => new Response(null, { status: 503 }));
    const alarms = { create: vi.fn(), clear: vi.fn() };
    const client = createBridgeClient({
      fetchFn: fetchFn as typeof fetch,
      storage,
      alarms,
      now: () => 1_000,
    });

    const result = await client.forwardOrQueue(payload());

    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(read()).toHaveLength(1);
    expect(read()[0]).toMatchObject({ attempt: 1, nextAttemptAt: 3_000 });
    expect(alarms.create).toHaveBeenCalled();
  });

  it('flushes queued events and clears alarms after success', async () => {
    const queued = [{
      payload: payload(),
      attempt: 1,
      nextAttemptAt: 1_000,
      lastError: 'HTTP 503',
    }];
    const { storage, read } = makeStorage(queued);
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    const alarms = { create: vi.fn(), clear: vi.fn() };
    const client = createBridgeClient({
      fetchFn: fetchFn as typeof fetch,
      storage,
      alarms,
      now: () => 2_000,
    });

    await client.flushQueue();

    expect(read()).toEqual([]);
    expect(alarms.clear).toHaveBeenCalled();
  });
});
