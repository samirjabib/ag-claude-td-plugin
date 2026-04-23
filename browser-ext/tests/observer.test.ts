import { describe, it, expect, vi } from 'vitest';
import { extractTicketContext, isTracking, attachObserver } from '../src/observer.js';

function makeButton(running: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-testid', 'timedoctor-button');
  btn.className = running ? 'timedoctor2 monday-detail-button tracking-active' : 'timedoctor2 monday-detail-button';
  const span = document.createElement('span');
  span.className = 'td2-button__title';
  span.textContent = running ? 'STOP TIMER' : 'START TIMER';
  btn.appendChild(span);
  return btn;
}

function makeHeading(title: string): HTMLDivElement {
  const wrap = document.createElement('div');
  const inner = document.createElement('div');
  inner.setAttribute('data-testid', 'editable-heading');
  const h2 = document.createElement('h2');
  h2.setAttribute('data-testid', 'text');
  h2.textContent = title;
  inner.appendChild(h2);
  wrap.appendChild(inner);
  return wrap;
}

describe('observer.isTracking', () => {
  it('true when tracking-active class present', () => {
    expect(isTracking(makeButton(true))).toBe(true);
  });
  it('false when tracking-active class absent', () => {
    expect(isTracking(makeButton(false))).toBe(false);
  });
  it('prefers aria-pressed=true over class signals', () => {
    const btn = makeButton(false);
    btn.setAttribute('aria-pressed', 'true');
    expect(isTracking(btn)).toBe(true);
  });
  it('prefers aria-pressed=false over class signals', () => {
    const btn = makeButton(true);
    btn.setAttribute('aria-pressed', 'false');
    expect(isTracking(btn)).toBe(false);
  });
  it('honours data-state=active when no aria-pressed is present', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-state', 'active');
    expect(isTracking(btn)).toBe(true);
  });
  it('honours data-state=paused when no aria-pressed is present', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-state', 'paused');
    expect(isTracking(btn)).toBe(false);
  });
});

describe('observer.extractTicketContext', () => {
  it('extracts ticket_id, board_id, view_id from URL and title from DOM', () => {
    document.body.innerHTML = '';
    document.body.appendChild(makeHeading('AI-TESTING BILLING TOKEN'));
    const url = 'https://arcticgrey.monday.com/boards/9515259371/views/202104545/pulses/11820279584';
    const ctx = extractTicketContext(url, document);
    expect(ctx).toEqual({
      ticket_id: '11820279584',
      board_id: '9515259371',
      view_id: '202104545',
      url,
      title: 'AI-TESTING BILLING TOKEN',
    });
  });

  it('returns null when URL has no /pulses/ segment', () => {
    expect(extractTicketContext('https://arcticgrey.monday.com/boards/9515259371/views/202104545', document)).toBeNull();
  });

  it('handles missing title gracefully (returns title:null)', () => {
    document.body.innerHTML = '';
    const ctx = extractTicketContext('https://x.monday.com/boards/1/views/2/pulses/3', document);
    expect(ctx).toMatchObject({ ticket_id: '3', board_id: '1', view_id: '2', title: null });
  });
});

describe('observer.attachObserver', () => {
  it('fires onChange(true) when tracking-active class is added', async () => {
    document.body.innerHTML = '';
    const btn = makeButton(false);
    document.body.appendChild(btn);
    document.body.appendChild(makeHeading('Task A'));

    const handler = vi.fn();
    const detach = attachObserver(btn, () => 'https://x.monday.com/boards/1/views/2/pulses/3', handler);

    btn.classList.add('tracking-active');
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'start',
        ticket: expect.objectContaining({ ticket_id: '3', title: 'Task A' }),
      }),
    );
    detach();
  });

  it('fires onChange(false) when tracking-active class is removed', async () => {
    document.body.innerHTML = '';
    const btn = makeButton(true);
    document.body.appendChild(btn);
    document.body.appendChild(makeHeading('Task A'));

    const handler = vi.fn();
    const detach = attachObserver(btn, () => 'https://x.monday.com/boards/1/views/2/pulses/3', handler);

    btn.classList.remove('tracking-active');
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ action: 'stop' }));
    detach();
  });

  it('fires onChange when aria-pressed flips even without class changes', async () => {
    document.body.innerHTML = '';
    const btn = document.createElement('button');
    btn.setAttribute('aria-pressed', 'false');
    document.body.appendChild(btn);
    document.body.appendChild(makeHeading('Task A'));

    const handler = vi.fn();
    const detach = attachObserver(btn, () => 'https://x.monday.com/boards/1/views/2/pulses/3', handler);

    btn.setAttribute('aria-pressed', 'true');
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ action: 'start' }));
    detach();
  });

  it('does not fire on no-op class mutations', async () => {
    document.body.innerHTML = '';
    const btn = makeButton(false);
    document.body.appendChild(btn);
    document.body.appendChild(makeHeading('Task A'));

    const handler = vi.fn();
    const detach = attachObserver(btn, () => 'https://x.monday.com/boards/1/views/2/pulses/3', handler);

    btn.classList.add('some-other-class');
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    detach();
  });
});
