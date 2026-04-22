import { attachObserver } from './observer.js';
import type { ExtensionEvent, RuntimeMessage } from './types.js';

const BUTTON_SELECTOR = '[data-testid="timedoctor-button"]';

function findButton(): Element | null {
  return document.querySelector(BUTTON_SELECTOR);
}

function send(event: ExtensionEvent): void {
  const message: RuntimeMessage = {
    type: 'TD_BRIDGE_EVENT',
    payload: {
      action: event.action,
      ticket_id: event.ticket.ticket_id,
      source: 'extension',
      timestamp: event.timestamp,
      metadata: {
        title: event.ticket.title,
        board_id: event.ticket.board_id,
        view_id: event.ticket.view_id,
        url: event.ticket.url,
      },
    },
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // service worker may be asleep; first send wakes it
  });
}

let detach: (() => void) | null = null;

function bind(button: Element): void {
  detach?.();
  detach = attachObserver(button, () => location.href, send);
}

function watchForButton(): void {
  const existing = findButton();
  if (existing) {
    bind(existing);
    return;
  }
  const docObserver = new MutationObserver(() => {
    const btn = findButton();
    if (btn) {
      docObserver.disconnect();
      bind(btn);
    }
  });
  docObserver.observe(document.body, { childList: true, subtree: true });
}

watchForButton();
