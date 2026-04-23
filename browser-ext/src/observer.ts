import type { ExtensionEvent, TicketContext } from './types.js';

const URL_RE = /\/boards\/(\d+)\/views\/(\d+)\/pulses\/(\d+)/;

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

export function extractTicketContext(url: string, doc: Document): TicketContext | null {
  const m = url.match(URL_RE);
  if (!m) return null;
  const [, board_id, view_id, ticket_id] = m;
  const heading = doc.querySelector('[data-testid="editable-heading"] h2');
  const title = heading?.textContent?.trim() || null;
  return { ticket_id, board_id, view_id, url, title };
}

export type ObserverCallback = (event: ExtensionEvent) => void;

export function attachObserver(
  button: Element,
  getUrl: () => string,
  onChange: ObserverCallback,
): () => void {
  let lastState = isTracking(button);

  const observer = new MutationObserver(() => {
    try {
      const current = isTracking(button);
      if (current === lastState) return;
      lastState = current;
      const url = getUrl();
      const ctx = extractTicketContext(url, button.ownerDocument ?? document);
      if (!ctx) return;
      onChange({
        action: current ? 'start' : 'stop',
        ticket: ctx,
        timestamp: Date.now(),
      });
    } catch (err) {
      // Any failure here (orphaned runtime, DOM race) must not propagate;
      // MutationObserver callbacks that throw are silenced by the browser
      // but surface as uncaught errors in the page's console.
      console.warn('[TD Bridge] observer callback error:', err);
    }
  });

  observer.observe(button, {
    attributes: true,
    attributeFilter: ['class', 'aria-pressed', 'data-state', 'data-tracking'],
  });
  return () => observer.disconnect();
}
