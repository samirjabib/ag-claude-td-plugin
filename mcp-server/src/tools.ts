import type { Store } from './store.js';
import type { SessionRow } from './types.js';

export interface ToolHandlers {
  get_active_ticket(args: Record<string, unknown>): Promise<SessionRow | null>;
  get_session(args: { ticket_id: string }): Promise<SessionRow | null>;
  list_sessions(args: Record<string, unknown>): Promise<SessionRow[]>;
}

export const TOOL_DEFINITIONS = [
  {
    name: 'get_active_ticket',
    description: 'Returns the currently active tracked session, or null if none.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_session',
    description: 'Returns a session by ticket_id, or null if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'string' } },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sessions',
    description: 'Returns all sessions ordered by last activity desc.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;

export function buildToolHandlers(store: Store): ToolHandlers {
  return {
    async get_active_ticket() {
      const active = store.getActiveTicket();
      if (!active.ticket_id) return null;
      return store.getSession(active.ticket_id);
    },
    async get_session({ ticket_id }) {
      return store.getSession(ticket_id);
    },
    async list_sessions() {
      return store.listSessions();
    },
  };
}
