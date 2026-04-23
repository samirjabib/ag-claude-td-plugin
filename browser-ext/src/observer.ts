import type { ExtensionEvent, TicketContext } from './types.js';

// Monday routes the same pulse under either shape:
//   /boards/<board>/views/<view>/pulses/<ticket>
//   /boards/<board>/pulses/<ticket>
// The view segment is optional; capture it when present so we can still
// link back to the exact view the user was in.
const URL_RE = /\/boards\/(\d+)(?:\/views\/(\d+))?\/pulses\/(\d+)/;
const BOARD_RE = /\/boards\/(\d+)(?:\/views\/(\d+))?/;

function attrNumber(el: Element, names: string[]): string | null {
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value && /^\d+$/.test(value)) return value;
  }
  return null;
}

function findTicketId(button: Element, doc: Document): string | null {
  const selectors = [
    '[data-pulse-id]',
    '[data-item-id]',
    '[data-itemid]',
  ];

  let cursor: Element | null = button;
  while (cursor) {
    const value = attrNumber(cursor, ['data-pulse-id', 'data-item-id', 'data-itemid']);
    if (value) return value;
    cursor = cursor.parentElement;
  }

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (!el) continue;
    const value = attrNumber(el, ['data-pulse-id', 'data-item-id', 'data-itemid']);
    if (value) return value;
  }

  return null;
}

// Detection with multiple fallbacks so a TD UI refresh doesn't silently
// disable us. Priority: explicit state attributes first, then the legacy
// CSS class, then label inspection as a last resort.
export function isTracking(button: Element): boolean {
  const aria = button.getAttribute('aria-pressed');
  if (aria === 'true') return true;
  if (aria === 'false') return false;

  const data = button.getAttribute('data-state') ?? button.getAttribute('data-tracking');
  if (data) {
    const v = data.toLowerCase();
    if (v === 'active' || v === 'running' || v === 'on' || v === 'true') return true;
    if (v === 'paused' || v === 'idle' || v === 'stopped' || v === 'off' || v === 'false') return false;
  }

  return button.classList.contains('tracking-active');
}

export function extractTicketContext(url: string, doc: Document, button?: Element): TicketContext | null {
  const m = url.match(URL_RE);
  const boardMatch = url.match(BOARD_RE);
  const heading = doc.querySelector('[data-testid="editable-heading"] h2');
  const title = heading?.textContent?.trim() || null;
  if (m) {
    const [, board_id, view_id, ticket_id] = m;
    return { ticket_id, board_id, view_id: view_id ?? null, url, title };
  }

  const ticketId = button ? findTicketId(button, doc) : null;
  if (!ticketId) return null;

  return {
    ticket_id: ticketId,
    board_id: boardMatch?.[1] ?? null,
    view_id: boardMatch?.[2] ?? null,
    url,
    title,
  };
}

export type ObserverCallback = (event: ExtensionEvent) => void;

export function attachObserver(
  button: Element,
  getUrl: () => string,
  onChange: ObserverCallback,
): () => void {
  let lastState = isTracking(button);
  console.log(
    '[TD Bridge] attached observer, initial state=', lastState,
    'class=', button.className,
    'aria-pressed=', button.getAttribute('aria-pressed'),
    'data-state=', button.getAttribute('data-state'),
  );

  const observer = new MutationObserver((mutations) => {
    try {
      const current = isTracking(button);
      const changedAttrs = mutations.map((m) => m.attributeName).filter(Boolean);
      console.log(
        '[TD Bridge] mutation — attrs changed:', changedAttrs,
        'isTracking:', current,
        'lastState:', lastState,
        'class:', button.className,
        'aria-pressed:', button.getAttribute('aria-pressed'),
      );
      if (current === lastState) return;
      lastState = current;
      const url = getUrl();
      const ctx = extractTicketContext(url, button.ownerDocument ?? document, button);
      if (!ctx) {
        console.warn('[TD Bridge] could not resolve ticket context from URL or DOM:', url);
        return;
      }
      if (!URL_RE.test(url)) {
        console.warn('[TD Bridge] emitting partial ticket context', ctx);
      }
      onChange({
        action: current ? 'start' : 'stop',
        ticket: ctx,
        timestamp: Date.now(),
      });
    } catch (err) {
      // MutationObserver callbacks that throw get silenced by the browser
      // but surface as uncaught errors in the page console.
      console.warn('[TD Bridge] observer callback error:', err);
    }
  });

  observer.observe(button, {
    attributes: true,
    attributeFilter: ['class', 'aria-pressed', 'data-state', 'data-tracking'],
  });
  return () => observer.disconnect();
}
