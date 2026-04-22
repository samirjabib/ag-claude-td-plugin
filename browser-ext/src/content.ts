import { attachObserver } from './observer.js';
import type { ExtensionEvent, RuntimeMessage, AuthCheckMessage, AuthCheckResponse } from './types.js';

const BUTTON_SELECTOR = '[data-testid="timedoctor-button"]';

function findButton(): Element | null {
  return document.querySelector(BUTTON_SELECTOR);
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
  console.log('[TD Bridge] send event:', event.action, event.ticket.ticket_id);
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

function bind(button: Element): void {
  console.log('[TD Bridge] button found, attaching observer');
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

async function init(): Promise<void> {
  const auth = await checkAuth();
  if (!auth.allowed) {
    console.warn('[TD Bridge] inactive: email', auth.email || '(empty)', 'not @arcticgrey.com');
    return;
  }
  console.log('[TD Bridge] authorized:', auth.email);
  watchForButton();
}

init();
