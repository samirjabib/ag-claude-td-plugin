import type { ExtensionEvent, TicketContext } from './types.js';

const URL_RE = /\/boards\/(\d+)\/views\/(\d+)\/pulses\/(\d+)/;

export function isTracking(button: Element): boolean {
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
    const current = isTracking(button);
    if (current === lastState) return;
    lastState = current;
    const ctx = extractTicketContext(getUrl(), button.ownerDocument ?? document);
    if (!ctx) return;
    onChange({
      action: current ? 'start' : 'stop',
      ticket: ctx,
      timestamp: Date.now(),
    });
  });

  observer.observe(button, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
