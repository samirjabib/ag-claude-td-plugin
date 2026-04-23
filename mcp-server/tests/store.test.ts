import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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

  it('persists ignored reasons and exposes aggregate stats', () => {
    const id = store.recordEvent('T1', 'start', 'extension', 100, '{}');
    store.setEventReason(id, 'duplicate_start');
    expect(store.listEvents()[0]).toMatchObject({ reason: 'duplicate_start' });
    expect(store.getIgnoredStats()).toEqual([{ reason: 'duplicate_start', count: 1 }]);
  });

  it('migrates legacy databases to the latest schema version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'td-bridge-store-'));
    const path = join(dir, 'state.db');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE active_ticket (
        singleton  INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
        ticket_id  TEXT,
        since      INTEGER
      );
      INSERT INTO active_ticket (singleton, ticket_id, since) VALUES (1, NULL, NULL);
      CREATE TABLE sessions (
        ticket_id       TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL UNIQUE,
        title           TEXT,
        board_id        TEXT,
        url             TEXT,
        state           TEXT NOT NULL CHECK (state IN ('active','paused','archived')),
        created_at      INTEGER NOT NULL,
        last_active_at  INTEGER NOT NULL
      );
      CREATE TABLE tracking_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id   TEXT NOT NULL,
        action      TEXT NOT NULL,
        source      TEXT NOT NULL,
        timestamp   INTEGER NOT NULL,
        meta        TEXT
      );
      INSERT INTO tracking_events (ticket_id, action, source, timestamp, meta)
      VALUES ('T1', 'start', 'extension', 100, '{}');
    `);
    legacy.close();

    const reopened = createStore(path);
    expect(reopened.listEvents()[0]).toMatchObject({ reason: null });
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
