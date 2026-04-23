import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, Store } from '../src/store.js';
import { createCandado } from '../src/candado.js';
import { buildToolHandlers } from '../src/tools.js';

describe('Tools', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
    const candado = createCandado(store);
    candado.apply({
      action: 'start',
      ticket_id: '11820279584',
      source: 'extension',
      timestamp: 1000,
      metadata: { title: 'AI-TESTING BILLING TOKEN', url: 'https://x' },
    });
  });

  it('get_active_ticket returns the active session', async () => {
    const tools = buildToolHandlers(store);
    const result = await tools.get_active_ticket({});
    expect(result).toMatchObject({
      ticket_id: '11820279584',
      title: 'AI-TESTING BILLING TOKEN',
      state: 'active',
    });
  });

  it('get_active_ticket returns null when nothing active', async () => {
    const empty = createStore(':memory:');
    const tools = buildToolHandlers(empty);
    const result = await tools.get_active_ticket({});
    expect(result).toBeNull();
  });

  it('get_session returns session by ticket_id', async () => {
    const tools = buildToolHandlers(store);
    const result = await tools.get_session({ ticket_id: '11820279584' });
    expect(result).toMatchObject({ ticket_id: '11820279584', title: 'AI-TESTING BILLING TOKEN' });
  });

  it('get_session returns null for unknown ticket', async () => {
    const tools = buildToolHandlers(store);
    const result = await tools.get_session({ ticket_id: 'unknown' });
    expect(result).toBeNull();
  });

  it('list_sessions returns array', async () => {
    const tools = buildToolHandlers(store);
    const result = await tools.list_sessions({});
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('get_ignored_stats returns aggregate ignored reasons', async () => {
    const candado = createCandado(store);
    candado.apply({
      action: 'start',
      ticket_id: '11820279584',
      source: 'extension',
      timestamp: 1001,
    });
    const tools = buildToolHandlers(store);
    const result = await tools.get_ignored_stats();
    expect(result).toEqual([{ reason: 'duplicate_start', count: 1 }]);
  });
});
