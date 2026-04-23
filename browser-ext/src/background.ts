import type { RuntimeMessage, AuthCheckResponse } from './types.js';

const BRIDGE_URL = 'http://127.0.0.1:47821/event';
const ALLOWED_DOMAIN = '@arcticgrey.com';

function getProfileEmail(): Promise<string> {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: chrome.identity.AccountStatus.ANY }, (info) => {
      resolve(info.email ?? '');
    });
  });
}

function isAllowed(email: string): boolean {
  return email.endsWith(ALLOWED_DOMAIN);
}

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
    console.log('[td-bridge] forwarded event → 202');
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn('[td-bridge] could not reach bridge:', err);
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg?.type === 'TD_BRIDGE_AUTH_CHECK') {
    (async () => {
      const email = await getProfileEmail();
      const response: AuthCheckResponse = { allowed: isAllowed(email), email };
      if (!response.allowed) {
        console.warn('[td-bridge] blocked: email', email || '(empty)', 'not @arcticgrey.com');
      }
      sendResponse(response);
    })();
    return true;
  }

  if (msg?.type === 'TD_BRIDGE_EVENT') {
    (async () => {
      const email = await getProfileEmail();
      if (!isAllowed(email)) {
        console.warn('[td-bridge] blocked event: not @arcticgrey.com');
        sendResponse({ ok: false, error: 'unauthorized' });
        return;
      }
      const result = await forward(msg.payload);
      sendResponse(result);
    })();
    return true;
  }

  return false;
});
