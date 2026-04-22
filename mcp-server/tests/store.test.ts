import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, Store } from '../src/store.js';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  it('initializes with no active ticket', () => {
    expect(store.getActiveTicket()).toEqual({ ticket_id: null, since: null });
  });

  it('sets and reads active ticket', () => {
    store.setActiveTicket('11820279584', 1000);
    expect(store.getActiveTicket()).toEqual({ ticket_id: '11820279584', since: 1000 });
  });

  it('clears active ticket', () => {
    store.setActiveTicket('11820279584', 1000);
    store.clearActiveTicket();
    expect(store.getActiveTicket()).toEqual({ ticket_id: null, since: null });
  });

  it('enforces single row in active_ticket via singleton check', () => {
    store.setActiveTicket('A', 100);
    store.setActiveTicket('B', 200);
    expect(store.getActiveTicket()).toEqual({ ticket_id: 'B', since: 200 });
  });
});

describe('Store sessions', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  it('upserts and reads a session', () => {
    const row = {
      ticket_id: '11820279584',
      session_id: 'sess-uuid-1',
      title: 'AI-TESTING BILLING TOKEN',
      board_id: '9515259371',
      url: 'https://arcticgrey.monday.com/boards/9515259371/views/202104545/pulses/11820279584',
      state: 'active' as const,
      created_at: 1000,
      last_active_at: 1000,
    };
    store.upsertSession(row);
    expect(store.getSession('11820279584')).toEqual(row);
  });

  it('returns null for unknown ticket', () => {
    expect(store.getSession('does-not-exist')).toBeNull();
  });

  it('updates state and last_active_at', () => {
    const row = {
      ticket_id: 'T1',
      session_id: 's1',
      title: null,
      board_id: null,
      url: null,
      state: 'active' as const,
      created_at: 100,
      last_active_at: 100,
    };
    store.upsertSession(row);
    store.setSessionState('T1', 'paused', 500);
    expect(store.getSession('T1')).toMatchObject({ state: 'paused', last_active_at: 500 });
  });

  it('lists sessions ordered by last_active_at desc', () => {
    store.upsertSession({ ticket_id: 'A', session_id: 'sa', title: null, board_id: null, url: null, state: 'paused', created_at: 1, last_active_at: 1 });
    store.upsertSession({ ticket_id: 'B', session_id: 'sb', title: null, board_id: null, url: null, state: 'paused', created_at: 2, last_active_at: 5 });
    expect(store.listSessions().map((s) => s.ticket_id)).toEqual(['B', 'A']);
  });

  it('records events', () => {
    expect(() => store.recordEvent('T1', 'start', 'extension', 100, '{}')).not.toThrow();
  });
});
