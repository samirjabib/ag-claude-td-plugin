// src/bridge-client.ts
var DEFAULT_PORT = 47821;
var PORT_SCAN_LIMIT = 10;
var RETRY_QUEUE_KEY = "td_bridge_retry_queue";
var RETRY_ALARM = "td_bridge_retry_queue";
var MAX_QUEUE_SIZE = 100;
function bridgeUrl(port) {
  return `http://127.0.0.1:${port}/event`;
}
function shouldRetry(result) {
  return !result.ok && (result.status === void 0 || result.status >= 500);
}
function backoffMs(attempt) {
  return Math.min(6e4, 1e3 * 2 ** Math.min(attempt, 6));
}
function parseQueue(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry;
    return !!item.payload && typeof item.attempt === "number" && typeof item.nextAttemptAt === "number";
  });
}
function candidatePorts(lastKnownPort) {
  const ports = /* @__PURE__ */ new Set();
  if (lastKnownPort !== null) ports.add(lastKnownPort);
  for (let offset = 0; offset <= PORT_SCAN_LIMIT; offset += 1) {
    ports.add(DEFAULT_PORT + offset);
  }
  return [...ports];
}
function createBridgeClient(deps) {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  let lastKnownPort = null;
  async function readQueue() {
    const stored = await deps.storage.get(RETRY_QUEUE_KEY);
    return parseQueue(stored[RETRY_QUEUE_KEY]);
  }
  async function writeQueue(queue) {
    const trimmed = queue.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(-MAX_QUEUE_SIZE);
    await deps.storage.set({ [RETRY_QUEUE_KEY]: trimmed });
    const next = trimmed[0];
    deps.alarms.clear(RETRY_ALARM);
    if (next) deps.alarms.create(RETRY_ALARM, { when: next.nextAttemptAt });
  }
  async function forward(payload) {
    let lastFailure = { ok: false, error: "bridge unavailable" };
    for (const port of candidatePorts(lastKnownPort)) {
      try {
        const res = await fetchFn(bridgeUrl(port), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          lastKnownPort = port;
          log.log("[td-bridge] forwarded event \u2192", res.status, "port", port);
          return { ok: true, status: res.status, port };
        }
        if (res.status === 404 || res.status === 405) {
          lastFailure = { ok: false, status: res.status, error: `unexpected service on port ${port}` };
          continue;
        }
        log.warn("[td-bridge] bridge replied", res.status, "port", port);
        return { ok: false, status: res.status, port };
      } catch (err) {
        lastFailure = { ok: false, error: String(err), port };
      }
    }
    log.warn("[td-bridge] could not reach bridge:", lastFailure.error ?? "(unknown)");
    return lastFailure;
  }
  async function enqueueRetry(payload, result) {
    const queue = await readQueue();
    const attempt = 1;
    queue.push({
      payload,
      attempt,
      nextAttemptAt: now() + backoffMs(attempt),
      lastError: result.error ?? (result.status ? `HTTP ${result.status}` : "unknown")
    });
    await writeQueue(queue);
  }
  async function forwardOrQueue(payload) {
    const result = await forward(payload);
    if (shouldRetry(result)) {
      await enqueueRetry(payload, result);
    } else if (result.ok) {
      await flushQueue();
    }
    return result;
  }
  async function flushQueue() {
    const queue = await readQueue();
    if (queue.length === 0) return;
    const currentTime = now();
    const remaining = [];
    for (const entry of queue.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)) {
      if (entry.nextAttemptAt > currentTime) {
        remaining.push(entry);
        continue;
      }
      const result = await forward(entry.payload);
      if (result.ok) continue;
      if (!shouldRetry(result)) {
        log.warn("[td-bridge] dropping queued event after terminal response", result);
        continue;
      }
      const attempt = entry.attempt + 1;
      remaining.push({
        ...entry,
        attempt,
        nextAttemptAt: currentTime + backoffMs(attempt),
        lastError: result.error ?? (result.status ? `HTTP ${result.status}` : "unknown")
      });
    }
    await writeQueue(remaining);
  }
  return {
    forwardOrQueue,
    flushQueue
  };
}

// src/background.ts
var ALLOWED_DOMAIN = "@arcticgrey.com";
var RETRY_ALARM2 = "td_bridge_retry_queue";
function getProfileEmail() {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: chrome.identity.AccountStatus.ANY }, (info) => {
      resolve(info.email ?? "");
    });
  });
}
function isAllowed(email) {
  return email.endsWith(ALLOWED_DOMAIN);
}
var bridge = createBridgeClient({
  storage: chrome.storage.local,
  alarms: chrome.alarms
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TD_BRIDGE_AUTH_CHECK") {
    (async () => {
      const email = await getProfileEmail();
      const response = { allowed: isAllowed(email), email };
      if (!response.allowed) {
        console.warn("[td-bridge] blocked: email", email || "(empty)", "not @arcticgrey.com");
      }
      sendResponse(response);
    })();
    return true;
  }
  if (msg?.type === "TD_BRIDGE_EVENT") {
    (async () => {
      const email = await getProfileEmail();
      if (!isAllowed(email)) {
        console.warn("[td-bridge] blocked event: not @arcticgrey.com");
        sendResponse({ ok: false, error: "unauthorized" });
        return;
      }
      const result = await bridge.forwardOrQueue(msg.payload);
      sendResponse(result);
    })();
    return true;
  }
  return false;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RETRY_ALARM2) return;
  void bridge.flushQueue();
});
void bridge.flushQueue();
