import type { IngressEvent } from './types.js';

export interface EventQueueOptions {
  dedupWindowMs?: number;
  now?: () => number;
  onError?: (err: unknown, event: IngressEvent) => void;
}

export interface EventQueue {
  enqueue(event: IngressEvent): void;
  drain(): Promise<void>;
}

export function createEventQueue(
  handler: (event: IngressEvent) => Promise<void>,
  opts: EventQueueOptions = {},
): EventQueue {
  const dedupWindowMs = opts.dedupWindowMs ?? 5000;
  const now = opts.now ?? Date.now;
  const onError = opts.onError ?? ((err, event) => {
    // Keep the loop alive; surface the failure for ops visibility.
    console.error('[td-bridge] event handler failed', { event, err });
  });

  const recentKeys = new Map<string, number>(); // key -> firstSeenAt (server time)
  const queue: IngressEvent[] = [];
  let running = false;
  let drainResolvers: Array<() => void> = [];

  function dedupKey(e: IngressEvent): string {
    return `${e.source}|${e.action}|${e.ticket_id}`;
  }

  function pruneRecent(currentTs: number) {
    for (const [key, ts] of recentKeys) {
      if (currentTs - ts > dedupWindowMs * 2) recentKeys.delete(key);
    }
  }

  async function process() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const event = queue.shift()!;
        const serverNow = now();
        const key = dedupKey(event);
        const lastSeen = recentKeys.get(key);
        if (lastSeen !== undefined && serverNow - lastSeen < dedupWindowMs) continue;
        recentKeys.set(key, serverNow);
        pruneRecent(serverNow);
        try {
          await handler(event);
        } catch (err) {
          onError(err, event);
        }
      }
    } finally {
      running = false;
      const resolvers = drainResolvers;
      drainResolvers = [];
      resolvers.forEach((r) => r());
    }
  }

  return {
    enqueue(event) {
      queue.push(event);
      void process();
    },
    drain() {
      if (!running && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => drainResolvers.push(resolve));
    },
  };
}
