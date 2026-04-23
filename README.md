# AG Time Doctor Claude Bridge

A Chrome extension + local MCP server that ties Time Doctor timers on Monday.com to Claude Code / Claude Desktop sessions.

Start a Time Doctor timer on a Monday ticket → the matching Claude session opens with the ticket's context already loaded. Switch tickets → Claude updates itself. Stop the timer → session closes cleanly.

The ticket is the pivot: **one Claude session per ticket**.

Access is gated to `@arcticgrey.com` accounts.

---

## Table of contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Repo layout](#repo-layout)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Usage](#usage)
- [HTTP API](#http-api)
- [MCP surface](#mcp-surface)
- [Data model](#data-model)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## How it works

1. The **Chrome extension** injects a content script into `*.monday.com/*`. It watches the Time Doctor Start/Stop button via a `MutationObserver` and detects state changes through multiple signals (`aria-pressed`, `data-state`, `tracking-active` class).
2. Each click turns into a JSON event — ticket id, board id, URL, title, timestamp — that the extension's service worker forwards to the **MCP server** over HTTP (`POST http://127.0.0.1:47821/event`).
3. The MCP server persists the event, advances the active-ticket state machine (the **candado**), and emits MCP resource + log notifications to any connected Claude client.
4. When a Claude Code or Claude Desktop session starts, a hook queries the bridge for the active ticket and renders a banner with the ticket id, title, elapsed time, and Monday URL. Claude also reads `session://active` as an MCP resource.

Result: whatever you're tracking in Time Doctor is what Claude knows you're working on — automatically.

---

## Architecture

```
┌──────────────────────────┐         HTTP POST /event        ┌───────────────────────┐
│  Chrome extension        │ ──────────────────────────────▶ │  MCP server (local)   │
│  (browser-ext/)          │   {action, ticket_id,            │  arcticgrey-td-bridge │
│                          │    timestamp, metadata}          │                       │
│  content.ts — observer   │                                  │  http-server.ts       │
│  background.ts — bridge  │                                  │    ↓ enqueue          │
│  bridge-client.ts — queue│                                  │  event-queue.ts       │
└──────────────────────────┘                                  │    ↓ serial           │
                                                              │  candado.ts           │
                                                              │    ↓ transaction      │
                                                              │  store.ts (sqlite)    │
                                                              │    ↓ emit             │
                                                              │  notifications.ts     │
                                                              └──────────┬────────────┘
                                                                         │ MCP stdio
                                                                         ▼
                                                              ┌───────────────────────┐
                                                              │  Claude Code /        │
                                                              │  Claude Desktop       │
                                                              │                       │
                                                              │  Resources:           │
                                                              │    session://active   │
                                                              │    session://{id}     │
                                                              │  Tools:               │
                                                              │    get_active_ticket  │
                                                              │    get_session        │
                                                              │    list_sessions      │
                                                              └───────────────────────┘
```

Key invariants the server enforces:

- **Atomic state mutation** — `candado.apply` wraps `recordEvent` + state changes in a single SQLite transaction with `BEGIN IMMEDIATE`, so concurrent HTTP ingests can't race.
- **Monotonic timestamps** — events older than the active session's `since` (minus a configurable tolerance) are rejected with `stale_timestamp`.
- **FIFO processing** — the event queue serializes handler invocations; errors in one handler don't stall the loop.
- **Server-side dedup** — a 5 s window keyed on `source | action | ticket_id | metadata` drops double-clicks without losing legitimate title changes.
- **HTTP only on loopback** — bound to `127.0.0.1:47821`, request bodies capped at 2 KB, validated by Fastify JSON Schema.

---

## Repo layout

```
mcp-server/           # Local MCP server (Node, TypeScript)
  src/
    index.ts          # boot: MCP stdio → HTTP listen → signal wiring
    http-server.ts    # Fastify: /health, /active, /event, /metrics
    candado.ts        # start/stop/switch state machine
    event-queue.ts    # FIFO + dedup + depth/duration callbacks
    store.ts          # SQLite: sessions, active_ticket, tracking_events, schema_version
    tools.ts          # MCP tool definitions + dispatcher
    resources.ts      # MCP resources (session://active, session://{id})
    notifications.ts  # maps CandadoOutcome → MCP notifications
    logger.ts         # structured JSON logger
    metrics.ts        # counters + histograms exposed at /metrics
    setup.ts          # post-install wizard (Desktop/Code config, SessionStart hook)
    hooks/
      session-start.sh # renders the ticket banner via hook JSON systemMessage
  tests/              # vitest unit + integration coverage

browser-ext/          # Chrome MV3 extension
  manifest.json       # host: *.monday.com + 127.0.0.1:47821
  src/
    content.ts        # injects into Monday, finds the TD button
    observer.ts       # MutationObserver + multi-signal state detection
    bridge-client.ts  # service-worker-side HTTP client with retry queue
    background.ts     # auth gate + event forwarding
  tests/              # vitest + jsdom

docs/
  manual-test.md      # end-to-end smoke test script
```

---

## Prerequisites

- Node 20+
- Chrome / Edge / any Chromium with MV3 support
- A Monday.com workspace where Time Doctor is installed
- A Google account on `@arcticgrey.com` (for the extension auth gate)

---

## Install

### 1. Build the MCP server

```bash
cd mcp-server
npm install
npm run build
```

### 2. Install into Claude Desktop / Claude Code

From `mcp-server/`:

```bash
node dist/setup.js
```

The setup script:

- Adds `arcticgrey-td-bridge` to `claude_desktop_config.json` and `~/.claude/settings.json`.
- Installs `~/.claude/hooks/ag-td-session-start.sh` and registers it as a `SessionStart` hook.
- Points at a local binary if found, with `npx -y arcticgrey-td-bridge` as a fallback.

Restart Claude Desktop (`Cmd+Q`, not just close window) so it picks up the new MCP server.

### 3. Load the browser extension

Until the extension is published to the Chrome Web Store:

```bash
cd browser-ext
npm install
npm run build
```

Then in Chrome:

1. `chrome://extensions` → toggle **Developer mode**.
2. Click **Load unpacked** → pick `browser-ext/dist/`.
3. Make sure you're signed into Chrome with your `@arcticgrey.com` Google profile.

---

## Usage

1. Open any ticket in Monday (URL matching `/boards/<id>/(views/<id>/)?pulses/<id>`).
2. Click **Start** on the Time Doctor button that Monday injects.
3. Open a Claude Code session in whatever project you care about. The banner renders at the top of the first response with the ticket id, title, elapsed time, and Monday URL.
4. Work normally — Claude treats that ticket as the active context for the whole session.
5. Click **Stop** in Monday (or **Start** on a different ticket to switch). Claude's `session://active` resource updates; the next prompt carries the new context.

---

## HTTP API

All endpoints served on `http://127.0.0.1:47821`.

| Method | Path       | Purpose |
|--------|------------|---------|
| GET    | `/health`  | Liveness. Returns `{"ok": true}`. |
| GET    | `/active`  | Snapshot of the active session: `{active, since, ticket}`. `ticket` is `null` when nothing is tracked. |
| GET    | `/metrics` | Counters + histograms (events accepted/rejected, queue depth, handler duration, SQLite lock waits). |
| POST   | `/event`   | Ingest a Start/Stop event. Schema-validated. Returns `202 {accepted: true, request_id}`. |

`POST /event` body:

```json
{
  "action": "start" | "stop",
  "ticket_id": "string",
  "source": "extension" | "api",
  "timestamp": 1735869600000,
  "metadata": {
    "title": "string",
    "board_id": "string",
    "view_id": "string",
    "url": "string"
  }
}
```

Every response includes an `x-request-id` (honours the header if the caller set one), and every event is persisted with that id in `tracking_events.meta` for correlation.

---

## MCP surface

**Resources**
- `session://active` — JSON of the currently active `SessionRow`, or `null`.
- `session://{ticket_id}` — JSON of a specific session.

**Tools**
- `get_active_ticket()` — shorthand for reading `session://active`.
- `get_session({ticket_id})` — explicit lookup.
- `list_sessions()` — all sessions, ordered by `last_active_at` desc.

**Notifications**
- `notifications/resources/list_changed` — fires when a new session is created.
- `notifications/resources/updated` — fires with `uri: session://active` and `uri: session://{id}` on every state change.
- `notifications/message` — structured log entries for `tracking_started`, `tracking_stopped`, `tracking_switched`, carrying ticket id, session id, title, and URL.

---

## Data model

SQLite file at `$TD_BRIDGE_DB` (default `~/.td-claude-bridge/state.db`).

```
active_ticket      singleton row pointing at the current active ticket + since timestamp
sessions           one row per ticket — session_id (uuid), title, board_id, url, state, timestamps
tracking_events    append-only log: action, source, timestamp, meta, reason (for ignored events)
schema_version     migration tracking
```

`sessions.state` is one of `active | paused | archived`. `active_ticket.ticket_id` is either `null` or the ticket id of the one session with `state = 'active'` — the candado guarantees at most one active session at any time.

---

## Development

```bash
# terminal 1 — mcp server (requires an MCP peer over stdio)
cd mcp-server
TD_BRIDGE_DB=/tmp/td-bridge-dev.db \
  npx -y @modelcontextprotocol/inspector node dist/index.js

# terminal 2 — browser extension build (watch mode via re-running)
cd browser-ext
npm run build
# then reload the unpacked extension in chrome://extensions

# terminal 3 — manual probing
curl -s http://127.0.0.1:47821/health
curl -s http://127.0.0.1:47821/active | jq
sqlite3 /tmp/td-bridge-dev.db 'SELECT ticket_id, action, timestamp, reason FROM tracking_events ORDER BY id DESC LIMIT 10;'
```

Useful env vars:

| Var              | Default                              | Purpose |
|------------------|--------------------------------------|---------|
| `TD_BRIDGE_PORT` | `47821`                              | HTTP ingest port. |
| `TD_BRIDGE_DB`   | `~/.td-claude-bridge/state.db`       | SQLite file path. |

---

## Testing

```bash
# MCP server: unit + integration
cd mcp-server && npm test

# Browser extension: unit (observer, bridge client)
cd browser-ext && npm test
```

`docs/manual-test.md` contains the end-to-end smoke test you should run any time you touch the candado, the HTTP ingest, the observer, or the session-start hook.

---

## Troubleshooting

**"Extension context invalidated" in the page console**
The content script is orphaned because the extension was reloaded but the tab wasn't. Hard-reload the Monday tab (`Cmd+Shift+R`). The observer guard will then no-op future mutations cleanly.

**Button clicks produce no event**
Open DevTools on the Monday tab, filter the console for `TD Bridge`. You should see `content script loaded`, `authorized as ...`, `observer attached to TD button`, and on each click a `start`/`stop` line. Missing the `attached` line means the observer never bound — the button selector list in `content.ts` no longer matches Monday's DOM.

**Banner doesn't appear in Claude Code**
The SessionStart hook only fires on a brand-new `claude` session. `Ctrl+D` / `exit` and run `claude` again. Verify the hook manually:

```bash
bash ~/.claude/hooks/ag-td-session-start.sh | jq
```

**`Server disconnected` in Claude Desktop developer settings**
The MCP config is pointing at `npx -y arcticgrey-td-bridge` but the package isn't published. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` to point at the local build directly:

```json
{
  "mcpServers": {
    "arcticgrey-td-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"]
    }
  }
}
```

Then `Cmd+Q` Claude Desktop (full quit) and reopen.

**Port 47821 already in use**
A previous server instance didn't shut down cleanly. Identify and kill it:

```bash
lsof -nP -iTCP:47821 -sTCP:LISTEN
kill <pid>
```

---

## Roadmap

1. **Time Doctor desktop parity.** When we have the official Time Doctor API, sync with the desktop app so tracking keeps working even when timers are started from the standalone client rather than the browser button.
2. **Token accounting.** Wire into Victoria's token-counting system so each session carries its Claude token usage alongside the ticket and elapsed time.
3. **Auto-post to Monday bulk hours.** At session close (or on a periodic poll), insert the elapsed + tokens into the ticket's bulk-hours column automatically — no manual entry.
4. **Pilot rollout.** Run a closed pilot with a small slice of the team; once stable, publish the extension to the Chrome Web Store and open access to everyone on `@arcticgrey.com`.
