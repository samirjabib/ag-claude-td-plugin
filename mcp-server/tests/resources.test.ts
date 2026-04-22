import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, Store } from '../src/store.js';
import { createCandado } from '../src/candado.js';
import { buildResourceHandlers, parseResourceUri } from '../src/resources.js';

describe('Resources', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
    const candado = createCandado(store);
    candado.apply({
      action: 'start',
      ticket_id: '11820279584',
      source: 'extension',
      timestamp: 1000,
      metadata: { title: 'AI-TESTING BILLING TOKEN' },
    });
  });

  it('parseResourceUri parses session://active', () => {
    expect(parseResourceUri('session://active')).toEqual({ kind: 'active' });
  });

  it('parseResourceUri parses session://{ticket}', () => {
    expect(parseResourceUri('session://11820279584')).toEqual({ kind: 'by-ticket', ticket_id: '11820279584' });
  });

  it('parseResourceUri returns null for invalid uri', () => {
    expect(parseResourceUri('garbage')).toBeNull();
  });

  it('reads session://active', async () => {
    const handlers = buildResourceHandlers(store);
    const text = await handlers.read('session://active');
    expect(text).not.toBeNull();
    const parsed = JSON.parse(text!);
    expect(parsed).toMatchObject({ ticket_id: '11820279584' });
  });

  it('reads session://{ticket_id}', async () => {
    const handlers = buildResourceHandlers(store);
    const text = await handlers.read('session://11820279584');
    expect(text).not.toBeNull();
    expect(JSON.parse(text!)).toMatchObject({ ticket_id: '11820279584' });
  });

  it('returns null for unknown ticket resource', async () => {
    const handlers = buildResourceHandlers(store);
    expect(await handlers.read('session://unknown')).toBeNull();
  });

  it('lists all known session resources', async () => {
    const handlers = buildResourceHandlers(store);
    const list = await handlers.list();
    expect(list.map((r) => r.uri)).toContain('session://active');
    expect(list.map((r) => r.uri)).toContain('session://11820279584');
  });

  it('returns JSON "null" string for session://active when no active session', async () => {
    const emptyStore = createStore(':memory:');
    const handlers = buildResourceHandlers(emptyStore);
    expect(await handlers.read('session://active')).toBe('null');
  });
});
