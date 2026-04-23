import { attachObserver } from './observer.js';
import type { ExtensionEvent, RuntimeMessage, AuthCheckMessage, AuthCheckResponse } from './types.js';

// Ordered from most-specific to least. The first match wins; the observer
// itself is resilient to label/class renames, so the extra candidates only
// have to locate the button, not decode its state.
const BUTTON_SELECTORS = [
  '[data-testid="timedoctor-button"]',
  'button.timedoctor2',
  'button[aria-label*="time doctor" i]',
  'button[title*="time doctor" i]',
];

function findButton(): Element | null {
  for (const sel of BUTTON_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function checkAuth(): Promise<AuthCheckResponse> {
  return new Promise((resolve) => {
    const msg: AuthCheckMessage = { type: 'TD_BRIDGE_AUTH_CHECK' };
    chrome.runtime.sendMessage(msg, (response: AuthCheckResponse) => {
      resolve(response);
    });
  });
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
  chrome.runtime.sendMessage(message).catch((err) => {
    console.error('[TD Bridge] sendMessage failed:', err);
  });
}

let detach: (() => void) | null = null;
let boundTo: Element | null = null;

function bind(button: Element): void {
  if (boundTo === button) return;
  detach?.();
  boundTo = button;
  detach = attachObserver(button, () => location.href, send);
}

function watchForButton(): void {
  const existing = findButton();
  if (existing) bind(existing);

  const docObserver = new MutationObserver(() => {
    const btn = findButton();
    if (btn && btn !== boundTo) bind(btn);
  });
  docObserver.observe(document.body, { childList: true, subtree: true });
}

async function init(): Promise<void> {
  const auth = await checkAuth();
  if (!auth.allowed) {
    console.warn('[TD Bridge] inactive: email', auth.email || '(empty)', 'not @arcticgrey.com');
    return;
  }
  watchForButton();
}

init();
