import Database, { Database as DB } from 'better-sqlite3';
import type { ActiveTicket, IgnoredReason, SessionRow, SessionState } from './types.js';

export interface TransactionOptions {
  mode?: 'deferred' | 'immediate' | 'exclusive';
  onLockAcquired?: (waitMs: number) => void;
}

export interface StoreOptions {
  busyTimeoutMs?: number;
}

export interface Store {
  getActiveTicket(): ActiveTicket;
  setActiveTicket(ticket_id: string, since: number): void;
  clearActiveTicket(): void;
  upsertSession(row: SessionRow): void;
  getSession(ticket_id: string): SessionRow | null;
  listSessions(): SessionRow[];
  setSessionState(ticket_id: string, state: SessionState, last_active_at: number): void;
  recordEvent(ticket_id: string, action: string, source: string, timestamp: number, meta: string | null): number;
  setEventReason(id: number, reason: IgnoredReason | null): void;
  listEvents(): Array<{ id: number; ticket_id: string; action: string; source: string; timestamp: number; meta: string | null; reason: IgnoredReason | null }>;
  getIgnoredStats(): Array<{ reason: IgnoredReason; count: number }>;
  transaction<T>(fn: () => T, options?: TransactionOptions): T;
  close(): void;
}

const LATEST_SCHEMA_VERSION = 2;

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, 0);
  `);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  const hasLegacyTables = tables.some((row) => ['active_ticket', 'sessions', 'tracking_events'].includes(row.name));
  const versionRow = db.prepare('SELECT version FROM schema_version WHERE singleton = 1').get() as { version: number };
  let version = versionRow.version;

  if (version === 0 && hasLegacyTables) {
    version = 1;
    db.prepare('UPDATE schema_version SET version = 1 WHERE singleton = 1').run();
  }

  if (version < 1) {
    db.exec(`
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
    `);
    version = 1;
    db.prepare('UPDATE schema_version SET version = 1 WHERE singleton = 1').run();
  }

  if (version < 2) {
    const columns = db.prepare('PRAGMA table_info(tracking_events)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'reason')) {
      db.exec('ALTER TABLE tracking_events ADD COLUMN reason TEXT');
    }
    version = 2;
    db.prepare('UPDATE schema_version SET version = 2 WHERE singleton = 1').run();
  }

  if (version !== LATEST_SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version ${version}`);
  }
}

export function createStore(path: string, options: StoreOptions = {}): Store {
  const db: DB = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  migrate(db);

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
  const setEvtReason = db.prepare('UPDATE tracking_events SET reason = ? WHERE id = ?');
  const listEvts = db.prepare('SELECT id, ticket_id, action, source, timestamp, meta, reason FROM tracking_events ORDER BY id ASC');
  const ignoredStats = db.prepare(`
    SELECT reason, COUNT(*) AS count
    FROM tracking_events
    WHERE reason IS NOT NULL
    GROUP BY reason
    ORDER BY count DESC, reason ASC
  `);

  function runTransaction<T>(fn: () => T, mode: 'deferred' | 'immediate' | 'exclusive', onLockAcquired?: (waitMs: number) => void): T {
    const beginSql =
      mode === 'immediate'
        ? 'BEGIN IMMEDIATE'
        : mode === 'exclusive'
          ? 'BEGIN EXCLUSIVE'
          : 'BEGIN';
    const lockStart = performance.now();
    db.exec(beginSql);
    onLockAcquired?.(performance.now() - lockStart);
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw err;
    }
  }

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
      const result = recordEvt.run(ticket_id, action, source, timestamp, meta);
      return Number(result.lastInsertRowid);
    },
    setEventReason(id, reason) {
      setEvtReason.run(reason, id);
    },
    listEvents() {
      return listEvts.all() as Array<{ id: number; ticket_id: string; action: string; source: string; timestamp: number; meta: string | null; reason: IgnoredReason | null }>;
    },
    getIgnoredStats() {
      return ignoredStats.all() as Array<{ reason: IgnoredReason; count: number }>;
    },
    transaction(fn, txOptions = {}) {
      return runTransaction(fn, txOptions.mode ?? 'deferred', txOptions.onLockAcquired);
    },
    close() {
      db.close();
    },
  };
}
