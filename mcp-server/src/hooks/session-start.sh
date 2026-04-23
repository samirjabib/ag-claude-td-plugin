#!/usr/bin/env bash
# SessionStart hook — checks if TD Bridge has an active ticket
# Outputs context for Claude to pick up automatically

RESPONSE=$(curl -s --connect-timeout 1 --max-time 2 http://127.0.0.1:47821/active 2>/dev/null)

if [ -z "$RESPONSE" ]; then
  exit 0  # bridge not running, silent
fi

ACTIVE=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('active',False))" 2>/dev/null)

if [ "$ACTIVE" = "True" ]; then
  TICKET_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['ticket']['ticket_id'])" 2>/dev/null)
  TITLE=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['ticket'].get('title','') or 'untitled')" 2>/dev/null)
  URL=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['ticket'].get('url',''))" 2>/dev/null)
  BOARD=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['ticket'].get('board_id',''))" 2>/dev/null)

  echo "AG Time Tracking active — Ticket #${TICKET_ID}: ${TITLE}"
  if [ -n "$URL" ]; then
    echo "Monday URL: ${URL}"
  fi
  if [ -n "$BOARD" ]; then
    echo "Board: ${BOARD}"
  fi
fi
