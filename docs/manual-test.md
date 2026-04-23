# TD Claude Bridge — Manual E2E Smoke Test

## Prerequisites

- Node 20+
- Chrome (or Edge)
- An account on a Monday.com workspace with the Time Doctor 2 browser extension installed
- One ticket you can safely start/stop a timer on

## Steps

### 1. Build everything

```bash
cd mcp-server && npm install && npm run build && cd ..
cd browser-ext && npm install && npm run build && cd ..
```

### 2. Start the MCP server

The server speaks MCP over stdio, so `node dist/index.js` standalone has no
peer and may deadlock. For manual testing, drive it through the MCP Inspector
which acts as the stdio peer and keeps the HTTP ingest open:

```bash
cd mcp-server
TD_BRIDGE_DB=/tmp/td-bridge-manual.db npx -y @modelcontextprotocol/inspector node dist/index.js
```

Leave the Inspector running. The HTTP ingest is now listening on
`http://127.0.0.1:47821` unless that port is already taken. On collision the
bridge will scan forward up to `47831`, and the browser extension will follow
that fallback range automatically. (For real Claude Code / Claude Desktop usage
the client itself is the stdio peer.)

### 3. Verify health

In another terminal:

```bash
curl -s http://127.0.0.1:47821/health
curl -s http://127.0.0.1:47821/metrics
```

Expected: `{"ok":true}`
Expected metrics: JSON with `queue.depth`, `lock_wait_ms`, and
`handler_duration_ms`.

### 4. Load the browser extension

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked".
4. Select the `browser-ext/dist` directory.
5. Confirm "TD Claude Bridge" appears with no errors.

### 5. Trigger a `start` event

The actual POST to `/event` is issued by the extension's **service worker**,
not the Monday.com page. The page-level Network tab will NOT show it.
Inspect the SW directly:

1. Open `chrome://inspect/#service-workers`.
2. Find the row for "TD Claude Bridge" → click **inspect**. A new DevTools
   window opens scoped to the SW.
3. In that DevTools, open **Network**. Leave it open.
4. Switch to the Monday.com tab and navigate to a ticket page (URL contains
   `/pulses/<ID>`).
   Note: the content script now runs in all frames, so Time Doctor widgets
   rendered inside iframes are also observed.
5. Click the "Start Timer" button injected by Time Doctor.
6. In the SW DevTools Network tab, you should see a POST to
   `http://127.0.0.1:47821/event` returning 202.
7. In a fresh terminal verify state:

```bash
curl -s http://127.0.0.1:47821/health
# (no dedicated query endpoint — verify via DB)
sqlite3 /tmp/td-bridge-manual.db 'SELECT * FROM active_ticket;'
sqlite3 /tmp/td-bridge-manual.db 'SELECT ticket_id, title, state FROM sessions;'
```

Expected: `active_ticket` row shows the pulse ID; `sessions` shows the ticket with `state=active` and the title from the page header.

### 6. Trigger a `stop` event

1. Click "Stop Timer" in Monday.
2. Verify another 202 POST appears in the **service worker** DevTools Network
   tab (same window as step 5).
3. Re-query the DB:

```bash
sqlite3 /tmp/td-bridge-manual.db 'SELECT * FROM active_ticket;'
sqlite3 /tmp/td-bridge-manual.db 'SELECT ticket_id, state FROM sessions;'
```

Expected: `active_ticket.ticket_id` is NULL; the session row shows `state=paused`.

### 7. Trigger a switch (optional)

1. Click Start on a different ticket without stopping the previous.
2. Re-query the DB:

```bash
sqlite3 /tmp/td-bridge-manual.db 'SELECT ticket_id, state FROM sessions ORDER BY last_active_at DESC;'
sqlite3 /tmp/td-bridge-manual.db 'SELECT * FROM active_ticket;'
```

Expected: the new ticket is `state=active`; the previous is `state=paused`; `active_ticket` points at the new one.

### 8. Cleanup

```bash
# Ctrl-C the MCP server
rm -f /tmp/td-bridge-manual.db
```

## Pass criteria

- All four DB checks above match expectations.
- No errors in the MCP server stderr or in the extension's service worker logs.
- HTTP responses to `/event` are always 202 for valid clicks.
