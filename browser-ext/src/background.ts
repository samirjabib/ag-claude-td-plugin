import type { RuntimeMessage } from './types.js';

const BRIDGE_URL = 'http://127.0.0.1:47821/event';

async function forward(payload: unknown): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn('[td-bridge] bridge replied', res.status);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn('[td-bridge] could not reach bridge:', err);
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg?.type !== 'TD_BRIDGE_EVENT') return false;
  // Must `return true` synchronously to keep message channel open while
  // we await the network round-trip.
  (async () => {
    const result = await forward(msg.payload);
    sendResponse(result);
  })();
  return true;
});
