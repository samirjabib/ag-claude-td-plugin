"use strict";
(() => {
  // src/observer.ts
  var URL_RE = /\/boards\/(\d+)\/views\/(\d+)\/pulses\/(\d+)/;
  function isTracking(button) {
    const aria = button.getAttribute("aria-pressed");
    if (aria === "true") return true;
    if (aria === "false") return false;
    const data = button.getAttribute("data-state") ?? button.getAttribute("data-tracking");
    if (data) {
      const v = data.toLowerCase();
      if (v === "active" || v === "running" || v === "on" || v === "true") return true;
      if (v === "paused" || v === "idle" || v === "stopped" || v === "off" || v === "false") return false;
    }
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
    console.log(
      "[TD Bridge] attached observer, initial state=",
      lastState,
      "class=",
      button.className,
      "aria-pressed=",
      button.getAttribute("aria-pressed"),
      "data-state=",
      button.getAttribute("data-state")
    );
    const observer = new MutationObserver((mutations) => {
      try {
        const current = isTracking(button);
        const changedAttrs = mutations.map((m) => m.attributeName).filter(Boolean);
        console.log(
          "[TD Bridge] mutation \u2014 attrs changed:",
          changedAttrs,
          "isTracking:",
          current,
          "lastState:",
          lastState,
          "class:",
          button.className,
          "aria-pressed:",
          button.getAttribute("aria-pressed")
        );
        if (current === lastState) return;
        lastState = current;
        const url = getUrl();
        const ctx = extractTicketContext(url, button.ownerDocument ?? document);
        if (!ctx) {
          console.warn("[TD Bridge] URL did not match /pulses/ regex:", url);
          return;
        }
        onChange({
          action: current ? "start" : "stop",
          ticket: ctx,
          timestamp: Date.now()
        });
      } catch (err) {
        console.warn("[TD Bridge] observer callback error:", err);
      }
    });
    observer.observe(button, {
      attributes: true,
      attributeFilter: ["class", "aria-pressed", "data-state", "data-tracking"]
    });
    return () => observer.disconnect();
  }

  // src/content.ts
  console.log("[TD Bridge] content script loaded at", (/* @__PURE__ */ new Date()).toISOString(), "\u2014 document.readyState:", document.readyState);
  var BUTTON_SELECTORS = [
    '[data-testid="timedoctor-button"]',
    "button.timedoctor2",
    'button[aria-label*="time doctor" i]',
    'button[title*="time doctor" i]'
  ];
  function findButton() {
    for (const sel of BUTTON_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  function isExtensionAlive() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  }
  function checkAuth() {
    return new Promise((resolve) => {
      if (!isExtensionAlive()) {
        resolve({ allowed: false, email: null });
        return;
      }
      const msg = { type: "TD_BRIDGE_AUTH_CHECK" };
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          resolve(response ?? { allowed: false, email: null });
        });
      } catch {
        resolve({ allowed: false, email: null });
      }
    });
  }
  function send(event) {
    if (!isExtensionAlive()) {
      detach?.();
      detach = null;
      boundTo = null;
      return;
    }
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
    try {
      console.log("[TD Bridge]", event.action, "ticket", event.ticket.ticket_id, event.ticket.title);
      chrome.runtime.sendMessage(message).catch((err) => {
        console.warn("[TD Bridge] sendMessage rejected:", err);
      });
    } catch (err) {
      console.warn("[TD Bridge] sendMessage threw:", err);
    }
  }
  var detach = null;
  var boundTo = null;
  function bind(button) {
    if (boundTo === button) return;
    detach?.();
    boundTo = button;
    detach = attachObserver(button, () => location.href, send);
    console.log("[TD Bridge] observer attached to TD button");
  }
  function watchForButton() {
    const existing = findButton();
    if (existing) {
      console.log("[TD Bridge] TD button already in DOM at startup");
      bind(existing);
    } else {
      console.log("[TD Bridge] TD button not in DOM yet, waiting for it to appear");
    }
    const docObserver = new MutationObserver(() => {
      const btn = findButton();
      if (btn && btn !== boundTo) bind(btn);
    });
    docObserver.observe(document.body, { childList: true, subtree: true });
  }
  async function init() {
    const auth = await checkAuth();
    if (!auth.allowed) {
      console.warn("[TD Bridge] inactive: email", auth.email || "(empty)", "not @arcticgrey.com");
      return;
    }
    console.log("[TD Bridge] authorized as", auth.email, "\u2014 watching for TD button");
    watchForButton();
  }
  init();
})();
