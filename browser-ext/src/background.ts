import { createBridgeClient } from './bridge-client.js';
import type { RuntimeMessage, AuthCheckResponse } from './types.js';

const ALLOWED_DOMAIN = '@arcticgrey.com';
const RETRY_ALARM = 'td_bridge_retry_queue';

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

const bridge = createBridgeClient({
  storage: chrome.storage.local,
  alarms: chrome.alarms,
});

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
      const result = await bridge.forwardOrQueue(msg.payload);
      sendResponse(result);
    })();
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RETRY_ALARM) return;
  void bridge.flushQueue();
});

void bridge.flushQueue();
