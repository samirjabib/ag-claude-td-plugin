import type { IngressEvent } from './types.js';

export interface EventQueueOptions {
  dedupWindowMs?: number;
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
  const recentKeys = new Map<string, number>(); // key -> firstSeenAt
  const queue: IngressEvent[] = [];
  let running = false;
  let drainResolvers: Array<() => void> = [];

  function dedupKey(e: IngressEvent): string {
    return `${e.source}|${e.action}|${e.ticket_id}`;
  }

  function pruneRecent(now: number) {
    for (const [key, ts] of recentKeys) {
      if (now - ts > dedupWindowMs * 2) recentKeys.delete(key);
    }
  }

  async function process() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const event = queue.shift()!;
        const key = dedupKey(event);
        const lastSeen = recentKeys.get(key);
        if (lastSeen !== undefined && event.timestamp - lastSeen < dedupWindowMs) continue;
        recentKeys.set(key, event.timestamp);
        pruneRecent(event.timestamp);
        await handler(event);
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
