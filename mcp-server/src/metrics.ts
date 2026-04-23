import type { IgnoredReason } from './types.js';

interface DurationSummary {
  count: number;
  last_ms: number;
  max_ms: number;
  total_ms: number;
}

function makeSummary(): DurationSummary {
  return { count: 0, last_ms: 0, max_ms: 0, total_ms: 0 };
}

function record(summary: DurationSummary, durationMs: number): void {
  summary.count += 1;
  summary.last_ms = durationMs;
  summary.max_ms = Math.max(summary.max_ms, durationMs);
  summary.total_ms += durationMs;
}

function snapshot(summary: DurationSummary) {
  return {
    count: summary.count,
    last_ms: Number(summary.last_ms.toFixed(3)),
    max_ms: Number(summary.max_ms.toFixed(3)),
    avg_ms: summary.count === 0 ? 0 : Number((summary.total_ms / summary.count).toFixed(3)),
  };
}

export interface Metrics {
  recordAcceptedRequest(): void;
  recordRejectedRequest(): void;
  recordQueueDepth(depth: number): void;
  recordHandlerDuration(durationMs: number): void;
  recordLockWait(durationMs: number): void;
  recordIgnored(reason: IgnoredReason): void;
  recordHandlerFailure(): void;
  snapshot(): Record<string, unknown>;
}

export function createMetrics(): Metrics {
  const handler = makeSummary();
  const lockWait = makeSummary();
  let acceptedRequests = 0;
  let rejectedRequests = 0;
  let handlerFailures = 0;
  let queueDepth = 0;
  const ignored: Record<IgnoredReason, number> = {
    duplicate_start: 0,
    stop_with_no_active: 0,
    stop_mismatched_ticket: 0,
    stale_timestamp: 0,
  };

  return {
    recordAcceptedRequest() {
      acceptedRequests += 1;
    },
    recordRejectedRequest() {
      rejectedRequests += 1;
    },
    recordQueueDepth(depth) {
      queueDepth = depth;
    },
    recordHandlerDuration(durationMs) {
      record(handler, durationMs);
    },
    recordLockWait(durationMs) {
      record(lockWait, durationMs);
    },
    recordIgnored(reason) {
      ignored[reason] += 1;
    },
    recordHandlerFailure() {
      handlerFailures += 1;
    },
    snapshot() {
      return {
        http: {
          accepted_requests: acceptedRequests,
          rejected_requests: rejectedRequests,
        },
        queue: {
          depth: queueDepth,
        },
        handler_duration_ms: snapshot(handler),
        lock_wait_ms: snapshot(lockWait),
        ignored,
        handler_failures: handlerFailures,
      };
    },
  };
}
