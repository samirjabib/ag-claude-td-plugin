import { attachObserver } from './observer.js';
import type { ExtensionEvent, RuntimeMessage, AuthCheckMessage, AuthCheckResponse } from './types.js';

console.log('[TD Bridge] content script loaded at', new Date().toISOString(), '— document.readyState:', document.readyState);

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

// When the extension is reloaded, existing content scripts are orphaned:
// `chrome.runtime.id` becomes undefined and any sendMessage call throws
// "Extension context invalidated". Detect the orphan state and bail out
// cleanly so the page isn't spammed with uncaught errors.
function isExtensionAlive(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function checkAuth(): Promise<AuthCheckResponse> {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve({ allowed: false, email: null });
      return;
    }
    const msg: AuthCheckMessage = { type: 'TD_BRIDGE_AUTH_CHECK' };
    try {
      chrome.runtime.sendMessage(msg, (response: AuthCheckResponse) => {
        resolve(response ?? { allowed: false, email: null });
      });
    } catch {
      resolve({ allowed: false, email: null });
    }
  });
}

function send(event: ExtensionEvent): void {
  if (!isExtensionAlive()) {
    // Orphaned content script (extension reloaded). Detach and stop
    // observing so we don't keep throwing on every class mutation.
    detach?.();
    detach = null;
    boundTo = null;
    return;
  }
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
  try {
    console.log('[TD Bridge]', event.action, 'ticket', event.ticket.ticket_id, event.ticket.title);
    chrome.runtime.sendMessage(message).catch((err) => {
      console.warn('[TD Bridge] sendMessage rejected:', err);
    });
  } catch (err) {
    console.warn('[TD Bridge] sendMessage threw:', err);
  }
}

let detach: (() => void) | null = null;
let boundTo: Element | null = null;
let routeHooksInstalled = false;

function bind(button: Element): void {
  if (boundTo === button) return;
  detach?.();
  boundTo = button;
  detach = attachObserver(button, () => location.href, send);
  console.log('[TD Bridge] observer attached to TD button');
}

function rebindForRouteChange(): void {
  detach?.();
  detach = null;
  boundTo = null;
  const button = findButton();
  if (button) bind(button);
}

function installRouteHooks(): void {
  if (routeHooksInstalled) return;
  routeHooksInstalled = true;

  const notify = () => {
    window.dispatchEvent(new Event('td-bridge:navigation'));
  };

  const wrapHistoryMethod = (method: 'pushState' | 'replaceState') => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      notify();
      return result;
    } as typeof history[typeof method];
  };

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  window.addEventListener('td-bridge:navigation', rebindForRouteChange);
}

function watchForButton(): void {
  const existing = findButton();
  if (existing) {
    console.log('[TD Bridge] TD button already in DOM at startup');
    bind(existing);
  } else {
    console.log('[TD Bridge] TD button not in DOM yet, waiting for it to appear');
  }

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
  console.log('[TD Bridge] authorized as', auth.email, '— watching for TD button');
  installRouteHooks();
  watchForButton();
}

init();
