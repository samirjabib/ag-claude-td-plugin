import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { IngressEvent, CandadoOutcome, SessionRow } from './types.js';

export interface Candado {
  apply(event: IngressEvent): CandadoOutcome;
}

export function createCandado(store: Store): Candado {
  return {
    apply(event) {
      // Atomic: record event + state mutation must commit or roll back together.
      return store.transaction(() => {
        store.recordEvent(
          event.ticket_id,
          event.action,
          event.source,
          event.timestamp,
          event.metadata ? JSON.stringify(event.metadata) : null,
        );

        const active = store.getActiveTicket();

        if (event.action === 'start') {
          if (active.ticket_id === event.ticket_id) {
            return { kind: 'ignored', reason: 'duplicate_start' };
          }
          if (active.ticket_id !== null) {
            const fromSession = pauseSession(store, active.ticket_id, event.timestamp);
            const toSession = activateSession(store, event);
            store.setActiveTicket(event.ticket_id, event.timestamp);
            return {
              kind: 'switched',
              from: active.ticket_id,
              to: event.ticket_id,
              from_session: fromSession,
              to_session: toSession,
            };
          }
          const session = activateSession(store, event);
          store.setActiveTicket(event.ticket_id, event.timestamp);
          return { kind: 'started', ticket_id: event.ticket_id, session };
        }

        // action === 'stop'
        if (active.ticket_id === null) {
          return { kind: 'ignored', reason: 'stop_with_no_active' };
        }
        if (active.ticket_id !== event.ticket_id) {
          return { kind: 'ignored', reason: 'stop_mismatched_ticket' };
        }
        const session = pauseSession(store, active.ticket_id, event.timestamp);
        store.clearActiveTicket();
        return { kind: 'stopped', ticket_id: event.ticket_id, session };
      });
    },
  };
}

function activateSession(store: Store, event: IngressEvent): SessionRow {
  const existing = store.getSession(event.ticket_id);
  const now = event.timestamp;
  const row: SessionRow = existing
    ? {
        ...existing,
        title: event.metadata?.title ?? existing.title,
        board_id: event.metadata?.board_id ?? existing.board_id,
        url: event.metadata?.url ?? existing.url,
        state: 'active',
        last_active_at: now,
      }
    : {
        ticket_id: event.ticket_id,
        session_id: randomUUID(),
        title: event.metadata?.title ?? null,
        board_id: event.metadata?.board_id ?? null,
        url: event.metadata?.url ?? null,
        state: 'active',
        created_at: now,
        last_active_at: now,
      };
  store.upsertSession(row);
  return row;
}

function pauseSession(store: Store, ticket_id: string, timestamp: number): SessionRow {
  store.setSessionState(ticket_id, 'paused', timestamp);
  const row = store.getSession(ticket_id);
  if (!row) throw new Error(`session ${ticket_id} disappeared during pause`);
  return row;
}
