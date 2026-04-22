"use strict";
(() => {
  // src/observer.ts
  var URL_RE = /\/boards\/(\d+)\/views\/(\d+)\/pulses\/(\d+)/;
  function isTracking(button) {
    return button.classList.contains("tracking-active");
  }
  function extractTicketContext(url, doc) {
    const m = url.match(URL_RE);
    if (!m) return null;
    const [, board_id, view_id, ticket_id] = m;
    const heading = doc.querySelector('[data-testid="editable-heading"] h2');
    const title = heading?.textContent?.trim() || null;
    return { ticket_id, board_id, view_id, url, title };
  }
  function attachObserver(button, getUrl, onChange) {
    let lastState = isTracking(button);
    const observer = new MutationObserver(() => {
      const current = isTracking(button);
      console.log("[TD Bridge] class mutation detected, tracking:", current, "lastState:", lastState);
      if (current === lastState) return;
      lastState = current;
      const url = getUrl();
      const ctx = extractTicketContext(url, button.ownerDocument ?? document);
      console.log("[TD Bridge] URL:", url, "context:", ctx);
      if (!ctx) return;
      onChange({
        action: current ? "start" : "stop",
        ticket: ctx,
        timestamp: Date.now()
      });
    });
    observer.observe(button, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }

  // src/content.ts
  var BUTTON_SELECTOR = '[data-testid="timedoctor-button"]';
  function findButton() {
    return document.querySelector(BUTTON_SELECTOR);
  }
  function send(event) {
    console.log("[TD Bridge] send event:", event.action, event.ticket.ticket_id);
    const message = {
      type: "TD_BRIDGE_EVENT",
      payload: {
        action: event.action,
        ticket_id: event.ticket.ticket_id,
        source: "extension",
        timestamp: event.timestamp,
        metadata: {
          title: event.ticket.title,
          board_id: event.ticket.board_id,
          view_id: event.ticket.view_id,
          url: event.ticket.url
        }
      }
    };
    chrome.runtime.sendMessage(message).catch((err) => {
      console.error("[TD Bridge] sendMessage failed:", err);
    });
  }
  var detach = null;
  function bind(button) {
    console.log("[TD Bridge] button found, attaching observer");
    detach?.();
    detach = attachObserver(button, () => location.href, send);
  }
  function watchForButton() {
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
})();
