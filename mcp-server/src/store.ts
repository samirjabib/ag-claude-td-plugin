import Database, { Database as DB } from 'better-sqlite3';
import type { ActiveTicket, SessionRow, SessionState } from './types.js';

export interface Store {
  getActiveTicket(): ActiveTicket;
  setActiveTicket(ticket_id: string, since: number): void;
  clearActiveTicket(): void;
  upsertSession(row: SessionRow): void;
  getSession(ticket_id: string): SessionRow | null;
  listSessions(): SessionRow[];
  setSessionState(ticket_id: string, state: SessionState, last_active_at: number): void;
  recordEvent(ticket_id: string, action: string, source: string, timestamp: number, meta: string | null): void;
  listEvents(): Array<{ id: number; ticket_id: string; action: string; source: string; timestamp: number; meta: string | null }>;
  transaction<T>(fn: () => T): T;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS active_ticket (
  singleton  INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
  ticket_id  TEXT,
  since      INTEGER
);
INSERT OR IGNORE INTO active_ticket (singleton, ticket_id, since) VALUES (1, NULL, NULL);

CREATE TABLE IF NOT EXISTS sessions (
  ticket_id       TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL UNIQUE,
  title           TEXT,
  board_id        TEXT,
  url             TEXT,
  state           TEXT NOT NULL CHECK (state IN ('active','paused','archived')),
  created_at      INTEGER NOT NULL,
  last_active_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  source      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  meta        TEXT
);
`;

export function createStore(path: string): Store {
  const db: DB = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const getActive = db.prepare('SELECT ticket_id, since FROM active_ticket WHERE singleton = 1');
  const setActive = db.prepare('UPDATE active_ticket SET ticket_id = ?, since = ? WHERE singleton = 1');
  const upsertSess = db.prepare(`
    INSERT INTO sessions (ticket_id, session_id, title, board_id, url, state, created_at, last_active_at)
    VALUES (@ticket_id, @session_id, @title, @board_id, @url, @state, @created_at, @last_active_at)
    ON CONFLICT(ticket_id) DO UPDATE SET
      title = excluded.title,
      board_id = excluded.board_id,
      url = excluded.url,
      state = excluded.state,
      last_active_at = excluded.last_active_at
  `);
  const getSess = db.prepare('SELECT * FROM sessions WHERE ticket_id = ?');
  const listSess = db.prepare('SELECT * FROM sessions ORDER BY last_active_at DESC');
  const setState = db.prepare('UPDATE sessions SET state = ?, last_active_at = ? WHERE ticket_id = ?');
  const recordEvt = db.prepare('INSERT INTO tracking_events (ticket_id, action, source, timestamp, meta) VALUES (?, ?, ?, ?, ?)');
  const listEvts = db.prepare('SELECT id, ticket_id, action, source, timestamp, meta FROM tracking_events ORDER BY id ASC');

  return {
    getActiveTicket() {
      const row = getActive.get() as { ticket_id: string | null; since: number | null };
      return { ticket_id: row.ticket_id, since: row.since };
    },
    setActiveTicket(ticket_id, since) {
      setActive.run(ticket_id, since);
    },
    clearActiveTicket() {
      setActive.run(null, null);
    },
    upsertSession(row) {
      upsertSess.run(row);
    },
    getSession(ticket_id) {
      return (getSess.get(ticket_id) as SessionRow | undefined) ?? null;
    },
    listSessions() {
      return listSess.all() as SessionRow[];
    },
    setSessionState(ticket_id, state, last_active_at) {
      setState.run(state, last_active_at, ticket_id);
    },
    recordEvent(ticket_id, action, source, timestamp, meta) {
      recordEvt.run(ticket_id, action, source, timestamp, meta);
    },
    listEvents() {
      return listEvts.all() as Array<{ id: number; ticket_id: string; action: string; source: string; timestamp: number; meta: string | null }>;
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
    close() {
      db.close();
    },
  };
}
