import { describe, it, expect, vi } from 'vitest';
import { buildNotifications } from '../src/notifications.js';
import type { SessionRow } from '../src/types.js';

const session = (id: string, state: 'active' | 'paused' = 'active'): SessionRow => ({
  ticket_id: id,
  session_id: `s-${id}`,
  title: `Title ${id}`,
  board_id: null,
  url: null,
  state,
  created_at: 1,
  last_active_at: 2,
});

describe('Notifications (spec-compliant)', () => {
  it('started → resource update for session://active and the ticket URI + log message', () => {
    const send = vi.fn();
    const emit = buildNotifications(send);
    emit({ kind: 'started', ticket_id: 'T1', session: session('T1') });

    expect(send).toHaveBeenCalledWith('notifications/resources/list_changed', {});
    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://active' });
    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://T1' });
    expect(send).toHaveBeenCalledWith(
      'notifications/message',
      expect.objectContaining({
        level: 'info',
        logger: 'td-bridge',
        data: expect.objectContaining({ event: 'tracking_started', ticket_id: 'T1' }),
      }),
    );
  });

  it('stopped → resource updates for active + ticket + log message', () => {
    const send = vi.fn();
    const emit = buildNotifications(send);
    emit({ kind: 'stopped', ticket_id: 'T1', session: session('T1', 'paused') });

    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://active' });
    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://T1' });
    expect(send).toHaveBeenCalledWith(
      'notifications/message',
      expect.objectContaining({
        level: 'info',
        data: expect.objectContaining({ event: 'tracking_stopped', ticket_id: 'T1' }),
      }),
    );
  });

  it('switched → resource updates for active + both tickets + log message', () => {
    const send = vi.fn();
    const emit = buildNotifications(send);
    emit({
      kind: 'switched',
      from: 'A',
      to: 'B',
      from_session: session('A', 'paused'),
      to_session: session('B', 'active'),
    });

    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://active' });
    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://A' });
    expect(send).toHaveBeenCalledWith('notifications/resources/updated', { uri: 'session://B' });
    expect(send).toHaveBeenCalledWith(
      'notifications/message',
      expect.objectContaining({
        level: 'info',
        data: expect.objectContaining({ event: 'tracking_switched', from_ticket: 'A', to_ticket: 'B' }),
      }),
    );
  });

  it('emits warning log for ignored outcome', () => {
    const send = vi.fn();
    const emit = buildNotifications(send);
    emit({ kind: 'ignored', reason: 'duplicate_start' });
    expect(send).toHaveBeenCalledWith(
      'notifications/message',
      expect.objectContaining({
        level: 'warning',
        data: expect.objectContaining({ event: 'tracking_ignored', reason: 'duplicate_start' }),
      }),
    );
  });
});
