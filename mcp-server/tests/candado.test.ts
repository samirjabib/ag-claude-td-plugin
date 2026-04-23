import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, Store } from '../src/store.js';
import { createCandado, Candado } from '../src/candado.js';
import type { IngressEvent } from '../src/types.js';

const evt = (overrides: Partial<IngressEvent>): IngressEvent => ({
  action: 'start',
  ticket_id: 'T1',
  source: 'extension',
  timestamp: 1000,
  ...overrides,
});

describe('Candado', () => {
  let store: Store;
  let candado: Candado;

  beforeEach(() => {
    store = createStore(':memory:');
    candado = createCandado(store);
  });

  it('start with no active → started', () => {
    const out = candado.apply(evt({ action: 'start', ticket_id: 'T1', metadata: { title: 'Task 1' } }));
    expect(out.kind).toBe('started');
    expect(store.getActiveTicket().ticket_id).toBe('T1');
    expect(store.getSession('T1')?.state).toBe('active');
  });

  it('start with same active ticket → ignored', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1' }));
    const out = candado.apply(evt({ action: 'start', ticket_id: 'T1', timestamp: 1100 }));
    expect(out.kind).toBe('ignored');
  });

  it('start with different ticket → switched', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1', metadata: { title: 'Task 1' } }));
    const out = candado.apply(evt({ action: 'start', ticket_id: 'T2', timestamp: 2000, metadata: { title: 'Task 2' } }));
    expect(out.kind).toBe('switched');
    if (out.kind === 'switched') {
      expect(out.from).toBe('T1');
      expect(out.to).toBe('T2');
    }
    expect(store.getActiveTicket().ticket_id).toBe('T2');
    expect(store.getSession('T1')?.state).toBe('paused');
    expect(store.getSession('T2')?.state).toBe('active');
  });

  it('stop on matching active → stopped', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1' }));
    const out = candado.apply(evt({ action: 'stop', ticket_id: 'T1', timestamp: 1500 }));
    expect(out.kind).toBe('stopped');
    expect(store.getActiveTicket().ticket_id).toBeNull();
    expect(store.getSession('T1')?.state).toBe('paused');
  });

  it('stop with no active → ignored', () => {
    const out = candado.apply(evt({ action: 'stop', ticket_id: 'T1' }));
    expect(out.kind).toBe('ignored');
  });

  it('stop with mismatched active → ignored, no state change', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1' }));
    const out = candado.apply(evt({ action: 'stop', ticket_id: 'T2' }));
    expect(out.kind).toBe('ignored');
    expect(store.getActiveTicket().ticket_id).toBe('T1');
  });

  it('rejects events older than the active session start (stale_timestamp)', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1', timestamp: 5000 }));
    const out = candado.apply(evt({ action: 'stop', ticket_id: 'T1', timestamp: 4000 }));
    expect(out.kind).toBe('ignored');
    if (out.kind === 'ignored') expect(out.reason).toBe('stale_timestamp');
    expect(store.getActiveTicket().ticket_id).toBe('T1');
    expect(store.getSession('T1')?.state).toBe('active');
  });

  it('accepts equal timestamps at the active threshold', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1', timestamp: 5000 }));
    const out = candado.apply(evt({ action: 'stop', ticket_id: 'T1', timestamp: 5000 }));
    expect(out.kind).toBe('stopped');
  });

  it('records every event into tracking_events', () => {
    candado.apply(evt({ action: 'start', ticket_id: 'T1' }));
    candado.apply(evt({ action: 'stop', ticket_id: 'T1', timestamp: 1500 }));
    const events = store.listEvents();
    expect(events).toHaveLength(2);
    expect(events.map((e) => `${e.action}:${e.ticket_id}:${e.timestamp}`)).toEqual([
      'start:T1:1000',
      'stop:T1:1500',
    ]);
  });
});
