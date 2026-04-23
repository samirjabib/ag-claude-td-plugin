import type { Store } from './store.js';
import type { SessionRow } from './types.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties: boolean;
  };
  handler: ToolHandler;
}

function text(result: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`invalid argument: ${key} must be a non-empty string`);
  }
  return v;
}

export interface Tools {
  definitions: ToolDefinition[];
  dispatch(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  // Kept for test convenience — exposes the bare results without MCP envelope.
  raw: {
    get_active_ticket(): Promise<SessionRow | null>;
    get_session(args: { ticket_id: string }): Promise<SessionRow | null>;
    list_sessions(): Promise<SessionRow[]>;
  };
}

export function buildTools(store: Store): Tools {
  const raw = {
    async get_active_ticket(): Promise<SessionRow | null> {
      const active = store.getActiveTicket();
      if (!active.ticket_id) return null;
      return store.getSession(active.ticket_id);
    },
    async get_session({ ticket_id }: { ticket_id: string }): Promise<SessionRow | null> {
      return store.getSession(ticket_id);
    },
    async list_sessions(): Promise<SessionRow[]> {
      return store.listSessions();
    },
  };

  const definitions: ToolDefinition[] = [
    {
      name: 'get_active_ticket',
      description: 'Returns the currently active tracked session, or null if none.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => text(await raw.get_active_ticket()),
    },
    {
      name: 'get_session',
      description: 'Returns a session by ticket_id, or null if it does not exist.',
      inputSchema: {
        type: 'object',
        properties: { ticket_id: { type: 'string', minLength: 1 } },
        required: ['ticket_id'] as const,
        additionalProperties: false,
      },
      handler: async (args) => text(await raw.get_session({ ticket_id: requireString(args, 'ticket_id') })),
    },
    {
      name: 'list_sessions',
      description: 'Returns all sessions ordered by last activity desc.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => text(await raw.list_sessions()),
    },
  ];

  const byName = new Map(definitions.map((d) => [d.name, d.handler] as const));

  return {
    definitions,
    raw,
    async dispatch(name, args) {
      const handler = byName.get(name);
      if (!handler) throw new Error(`unknown tool: ${name}`);
      return handler(args);
    },
  };
}

// Legacy adapter kept so existing tool tests using the old names keep working.
export const TOOL_DEFINITIONS = (() => {
  // Static shape mirror for anyone listing definitions without a store.
  return [
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
        properties: { ticket_id: { type: 'string', minLength: 1 } },
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
})();

export function buildToolHandlers(store: Store) {
  return buildTools(store).raw;
}
