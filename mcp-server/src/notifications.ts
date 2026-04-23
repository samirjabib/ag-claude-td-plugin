import type { CandadoOutcome } from './types.js';

export type NotificationSender = (method: string, params: Record<string, unknown>) => void;
export type NotificationLevel = 'info' | 'warning' | 'error';

const ACTIVE_URI = 'session://active';

export function sendBridgeMessage(
  send: NotificationSender,
  level: NotificationLevel,
  data: Record<string, unknown>,
): void {
  send('notifications/message', {
    level,
    logger: 'td-bridge',
    data,
  });
}

export function buildNotifications(send: NotificationSender) {
  return function emit(outcome: CandadoOutcome): void {
    if (outcome.kind === 'ignored') {
      sendBridgeMessage(send, 'warning', {
        event: 'tracking_ignored',
        reason: outcome.reason,
      });
      return;
    }

    if (outcome.kind === 'started') {
      send('notifications/resources/list_changed', {});
      send('notifications/resources/updated', { uri: ACTIVE_URI });
      send('notifications/resources/updated', { uri: `session://${outcome.ticket_id}` });
      sendBridgeMessage(send, 'info', {
        event: 'tracking_started',
        ticket_id: outcome.ticket_id,
        session_id: outcome.session.session_id,
        title: outcome.session.title,
        url: outcome.session.url,
      });
      return;
    }

    if (outcome.kind === 'stopped') {
      send('notifications/resources/updated', { uri: ACTIVE_URI });
      send('notifications/resources/updated', { uri: `session://${outcome.ticket_id}` });
      sendBridgeMessage(send, 'info', {
        event: 'tracking_stopped',
        ticket_id: outcome.ticket_id,
        session_id: outcome.session.session_id,
      });
      return;
    }

    if (outcome.kind === 'switched') {
      send('notifications/resources/updated', { uri: ACTIVE_URI });
      send('notifications/resources/updated', { uri: `session://${outcome.from}` });
      send('notifications/resources/updated', { uri: `session://${outcome.to}` });
      sendBridgeMessage(send, 'info', {
        event: 'tracking_switched',
        from_ticket: outcome.from,
        to_ticket: outcome.to,
        from_session_id: outcome.from_session.session_id,
        to_session_id: outcome.to_session.session_id,
        title: outcome.to_session.title,
        url: outcome.to_session.url,
      });
      return;
    }
  };
}
