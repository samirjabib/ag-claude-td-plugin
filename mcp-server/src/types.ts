// Kept in sync manually with browser-ext/src/types.ts.
// TrackingAction and the BridgePayload shape there must satisfy IngressEvent
// below. If you change this union, update both sides.
export type TrackingAction = 'start' | 'stop';
export type SessionState = 'active' | 'paused' | 'archived';
export type EventSource = 'extension' | 'api';

export interface IngressEvent {
  action: TrackingAction;
  ticket_id: string;
  source: EventSource;
  timestamp: number;
  metadata?: {
    title?: string;
    board_id?: string;
    view_id?: string;
    url?: string;
  };
}

export interface SessionRow {
  ticket_id: string;
  session_id: string;
  title: string | null;
  board_id: string | null;
  url: string | null;
  state: SessionState;
  created_at: number;
  last_active_at: number;
}

export interface ActiveTicket {
  ticket_id: string | null;
  since: number | null;
}

export type IgnoredReason =
  | 'duplicate_start'
  | 'stop_with_no_active'
  | 'stop_mismatched_ticket'
  | 'stale_timestamp';

export type CandadoOutcome =
  | { kind: 'started'; ticket_id: string; session: SessionRow }
  | { kind: 'stopped'; ticket_id: string; session: SessionRow }
  | { kind: 'switched'; from: string; to: string; from_session: SessionRow; to_session: SessionRow }
  | { kind: 'ignored'; reason: IgnoredReason };
