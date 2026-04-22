import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, Store } from '../src/store.js';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  it('initializes with no active ticket', () => {
    expect(store.getActiveTicket()).toEqual({ ticket_id: null, since: null });
  });

  it('sets and reads active ticket', () => {
    store.setActiveTicket('11820279584', 1000);
    expect(store.getActiveTicket()).toEqual({ ticket_id: '11820279584', since: 1000 });
  });

  it('clears active ticket', () => {
    store.setActiveTicket('11820279584', 1000);
    store.clearActiveTicket();
    expect(store.getActiveTicket()).toEqual({ ticket_id: null, since: null });
  });

  it('enforces single row in active_ticket via singleton check', () => {
    store.setActiveTicket('A', 100);
    store.setActiveTicket('B', 200);
    expect(store.getActiveTicket()).toEqual({ ticket_id: 'B', since: 200 });
  });
});
