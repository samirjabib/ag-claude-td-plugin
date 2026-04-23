import type { IngressEvent } from './types.js';

export interface EventQueueOptions {
  dedupWindowMs?: number;
  now?: () => number;
  onError?: (err: unknown, event: IngressEvent) => void;
  onDepthChange?: (depth: number) => void;
  onHandled?: (event: IngressEvent, durationMs: number) => void;
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
  const onDepthChange = opts.onDepthChange ?? (() => {});
  const onHandled = opts.onHandled ?? (() => {});

  const recentKeys = new Map<string, number>(); // key -> firstSeenAt (server time)
  const queue: IngressEvent[] = [];
  let running = false;
  let drainResolvers: Array<() => void> = [];

  function dedupKey(e: IngressEvent): string {
    const metadata = e.metadata
      ? JSON.stringify({
          title: e.metadata.title ?? null,
          board_id: e.metadata.board_id ?? null,
          view_id: e.metadata.view_id ?? null,
          url: e.metadata.url ?? null,
        })
      : 'null';
    return `${e.source}|${e.action}|${e.ticket_id}|${metadata}`;
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
        onDepthChange(queue.length);
        const serverNow = now();
        const key = dedupKey(event);
        const lastSeen = recentKeys.get(key);
        if (lastSeen !== undefined && serverNow - lastSeen < dedupWindowMs) continue;
        recentKeys.set(key, serverNow);
        pruneRecent(serverNow);
        try {
          const startedAt = now();
          await handler(event);
          onHandled(event, now() - startedAt);
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
      onDepthChange(queue.length);
      void process();
    },
    drain() {
      if (!running && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => drainResolvers.push(resolve));
    },
  };
}
