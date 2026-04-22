export type TrackingAction = 'start' | 'stop';
export type SessionState = 'active' | 'paused' | 'archived';
export type EventSource = 'extension' | 'api' | 'manual';

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

export type CandadoOutcome =
  | { kind: 'started'; ticket_id: string; session: SessionRow }
  | { kind: 'stopped'; ticket_id: string; session: SessionRow }
  | { kind: 'switched'; from: string; to: string; from_session: SessionRow; to_session: SessionRow }
  | { kind: 'ignored'; reason: string };
