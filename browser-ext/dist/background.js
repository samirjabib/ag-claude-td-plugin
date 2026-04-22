// src/background.ts
var BRIDGE_URL = "http://127.0.0.1:47821/event";
async function forward(payload) {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn("[td-bridge] bridge replied", res.status);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn("[td-bridge] could not reach bridge:", err);
    return { ok: false, error: String(err) };
  }
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "TD_BRIDGE_EVENT") return false;
  (async () => {
    const result = await forward(msg.payload);
    sendResponse(result);
  })();
  return true;
});
