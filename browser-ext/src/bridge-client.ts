import type { BridgePayload } from './types.js';

const DEFAULT_PORT = 47821;
const PORT_SCAN_LIMIT = 10;
const RETRY_QUEUE_KEY = 'td_bridge_retry_queue';
const RETRY_ALARM = 'td_bridge_retry_queue';
const MAX_QUEUE_SIZE = 100;

export interface RetryEntry {
  payload: BridgePayload;
  attempt: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export interface BridgeResult {
  ok: boolean;
  status?: number;
  error?: string;
  port?: number;
}

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface AlarmApiLike {
  create(name: string, info: { when: number }): void;
  clear(name: string): void;
}

export interface BridgeClient {
  forwardOrQueue(payload: BridgePayload): Promise<BridgeResult>;
  flushQueue(): Promise<void>;
}

export interface BridgeClientDeps {
  fetchFn?: typeof fetch;
  storage: StorageAreaLike;
  alarms: AlarmApiLike;
  now?: () => number;
  log?: Pick<Console, 'log' | 'warn'>;
}

function bridgeUrl(port: number): string {
  return `http://127.0.0.1:${port}/event`;
}

function shouldRetry(result: BridgeResult): boolean {
  return !result.ok && (result.status === undefined || result.status >= 500);
}

function backoffMs(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
}

function parseQueue(raw: unknown): RetryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is RetryEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<RetryEntry>;
    return !!item.payload && typeof item.attempt === 'number' && typeof item.nextAttemptAt === 'number';
  });
}

function candidatePorts(lastKnownPort: number | null): number[] {
  const ports = new Set<number>();
  if (lastKnownPort !== null) ports.add(lastKnownPort);
  for (let offset = 0; offset <= PORT_SCAN_LIMIT; offset += 1) {
    ports.add(DEFAULT_PORT + offset);
  }
  return [...ports];
}

export function createBridgeClient(deps: BridgeClientDeps): BridgeClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  let lastKnownPort: number | null = null;

  async function readQueue(): Promise<RetryEntry[]> {
    const stored = await deps.storage.get(RETRY_QUEUE_KEY);
    return parseQueue(stored[RETRY_QUEUE_KEY]);
  }

  async function writeQueue(queue: RetryEntry[]): Promise<void> {
    const trimmed = queue
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(-MAX_QUEUE_SIZE);
    await deps.storage.set({ [RETRY_QUEUE_KEY]: trimmed });
    const next = trimmed[0];
    deps.alarms.clear(RETRY_ALARM);
    if (next) deps.alarms.create(RETRY_ALARM, { when: next.nextAttemptAt });
  }

  async function forward(payload: BridgePayload): Promise<BridgeResult> {
    let lastFailure: BridgeResult = { ok: false, error: 'bridge unavailable' };

    for (const port of candidatePorts(lastKnownPort)) {
      try {
        const res = await fetchFn(bridgeUrl(port), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          lastKnownPort = port;
          log.log('[td-bridge] forwarded event →', res.status, 'port', port);
          return { ok: true, status: res.status, port };
        }
        if (res.status === 404 || res.status === 405) {
          lastFailure = { ok: false, status: res.status, error: `unexpected service on port ${port}` };
          continue;
        }
        log.warn('[td-bridge] bridge replied', res.status, 'port', port);
        return { ok: false, status: res.status, port };
      } catch (err) {
        lastFailure = { ok: false, error: String(err), port };
      }
    }

    log.warn('[td-bridge] could not reach bridge:', lastFailure.error ?? '(unknown)');
    return lastFailure;
  }

  async function enqueueRetry(payload: BridgePayload, result: BridgeResult): Promise<void> {
    const queue = await readQueue();
    const attempt = 1;
    queue.push({
      payload,
      attempt,
      nextAttemptAt: now() + backoffMs(attempt),
      lastError: result.error ?? (result.status ? `HTTP ${result.status}` : 'unknown'),
    });
    await writeQueue(queue);
  }

  async function forwardOrQueue(payload: BridgePayload): Promise<BridgeResult> {
    const result = await forward(payload);
    if (shouldRetry(result)) {
      await enqueueRetry(payload, result);
    } else if (result.ok) {
      await flushQueue();
    }
    return result;
  }

  async function flushQueue(): Promise<void> {
    const queue = await readQueue();
    if (queue.length === 0) return;

    const currentTime = now();
    const remaining: RetryEntry[] = [];

    for (const entry of queue.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)) {
      if (entry.nextAttemptAt > currentTime) {
        remaining.push(entry);
        continue;
      }

      const result = await forward(entry.payload);
      if (result.ok) continue;

      if (!shouldRetry(result)) {
        log.warn('[td-bridge] dropping queued event after terminal response', result);
        continue;
      }

      const attempt = entry.attempt + 1;
      remaining.push({
        ...entry,
        attempt,
        nextAttemptAt: currentTime + backoffMs(attempt),
        lastError: result.error ?? (result.status ? `HTTP ${result.status}` : 'unknown'),
      });
    }

    await writeQueue(remaining);
  }

  return {
    forwardOrQueue,
    flushQueue,
  };
}
