#!/usr/bin/env bash
# SessionStart hook — renders an ArcticGrey ticket banner BEFORE the user's
# first prompt using the Claude Code hook JSON `systemMessage` field, which
# displays the text directly in the UI instead of silently injecting it as
# context. Also emits `hookSpecificOutput.additionalContext` so Claude is
# aware of the active ticket.
DB="$HOME/.td-claude-bridge/state.db"
[ ! -f "$DB" ] && exit 0

python3 <<'PY'
import sqlite3, time, os, json, sys

db_path = os.path.expanduser('~/.td-claude-bridge/state.db')
try:
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        'SELECT ticket_id, since FROM active_ticket WHERE singleton=1'
    ).fetchone()
    if not row or not row[0]:
        sys.exit(0)
    ticket_id, since = row[0], row[1]
    sess = conn.execute(
        'SELECT title, url, created_at FROM sessions WHERE ticket_id=?',
        (ticket_id,),
    ).fetchone()
    conn.close()
except Exception:
    sys.exit(0)

title = (sess[0] if sess else '') or 'untitled'
url = (sess[1] if sess else '') or ''
ts = since or (sess[2] if sess else 0) or 0
if ts > 1e12:
    ts = ts / 1000

elapsed = max(0, int(time.time()) - int(ts)) if ts else 0
h, rem = divmod(elapsed, 3600)
m, _ = divmod(rem, 60)
parts = []
if h:
    parts.append(f'{h}h')
if m:
    parts.append(f'{m}m')
elapsed_str = ' '.join(parts) if parts else '<1m'

label_lines = [
    f'  Ticket:   #{ticket_id}',
    f'  Task:     {title}',
    f'  Elapsed:  {elapsed_str}',
]
if url:
    label_lines.append(f'  Monday:   {url}')

header = '  ArcticGrey Time Tracking \u2014 ACTIVE'
inner = max(len(l) for l in label_lines + [header]) + 2
bar = '\u2500' * inner

body = [
    f'\u250c{bar}\u2510',
    f'\u2502{header.ljust(inner)}\u2502',
    f'\u2502{" " * inner}\u2502',
]
for line in label_lines:
    body.append(f'\u2502{line.ljust(inner)}\u2502')
body.append(f'\u2514{bar}\u2518')

banner = '\n'.join(body)

payload = {
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': (
            f'Active Monday ticket: #{ticket_id} - {title}. '
            f'Elapsed {elapsed_str}. URL: {url}'
        ),
    },
    'systemMessage': banner,
}
print(json.dumps(payload))
PY
