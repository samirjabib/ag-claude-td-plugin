import type { Store } from './store.js';

export type ResourceUri =
  | { kind: 'active' }
  | { kind: 'by-ticket'; ticket_id: string };

export interface ResourceListing {
  uri: string;
  name: string;
  description: string;
}

export interface ResourceHandlers {
  list(): Promise<ResourceListing[]>;
  read(uri: string): Promise<string | null>;
}

export function parseResourceUri(uri: string): ResourceUri | null {
  if (uri === 'session://active') return { kind: 'active' };
  const m = uri.match(/^session:\/\/(.+)$/);
  if (m && m[1] !== 'active') return { kind: 'by-ticket', ticket_id: m[1] };
  return null;
}

export function buildResourceHandlers(store: Store): ResourceHandlers {
  return {
    async list() {
      const items: ResourceListing[] = [
        {
          uri: 'session://active',
          name: 'Active session',
          description: 'JSON of the currently active tracked session, or null',
        },
      ];
      for (const s of store.listSessions()) {
        items.push({
          uri: `session://${s.ticket_id}`,
          name: s.title ?? s.ticket_id,
          description: `Session for ticket ${s.ticket_id} (state: ${s.state})`,
        });
      }
      return items;
    },
    async read(uri) {
      const parsed = parseResourceUri(uri);
      if (!parsed) return null;
      if (parsed.kind === 'active') {
        const active = store.getActiveTicket();
        if (!active.ticket_id) return JSON.stringify(null);
        const session = store.getSession(active.ticket_id);
        return JSON.stringify(session);
      }
      const session = store.getSession(parsed.ticket_id);
      if (!session) return null;
      return JSON.stringify(session);
    },
  };
}
