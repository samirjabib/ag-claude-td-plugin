export type TrackingAction = 'start' | 'stop';

export interface TicketContext {
  ticket_id: string;
  board_id: string | null;
  view_id: string | null;
  url: string;
  title: string | null;
}

export interface ExtensionEvent {
  action: TrackingAction;
  ticket: TicketContext;
  timestamp: number;
}

export interface BridgePayload {
  action: TrackingAction;
  ticket_id: string;
  source: 'extension';
  timestamp: number;
  metadata: {
    title: string | null;
    board_id: string | null;
    view_id: string | null;
    url: string;
  };
}

export interface BridgeEventMessage {
  type: 'TD_BRIDGE_EVENT';
  payload: BridgePayload;
}

export interface AuthCheckMessage {
  type: 'TD_BRIDGE_AUTH_CHECK';
}

export interface AuthCheckResponse {
  allowed: boolean;
  email: string | null;
}

export type RuntimeMessage = BridgeEventMessage | AuthCheckMessage;
