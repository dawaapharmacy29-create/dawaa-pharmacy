import { describe, expect, it } from 'vitest';
import { agendaItemTone, agendaStats, sortAgendaItems } from '../branchManagerAgenda';

const item = (key: string, done: boolean, state: 'done' | 'issue' | null = null) => ({
  key,
  done,
  state,
});

describe('قائمة اليوم — ترتيب وعدادات', () => {
  it('reads a reported problem as an issue even when the server counts it done', () => {
    expect(agendaItemTone(item('a', true, 'issue'))).toBe('issue');
    expect(agendaItemTone(item('b', false))).toBe('open');
    expect(agendaItemTone(item('c', true))).toBe('done');
    expect(agendaItemTone(item('d', true, 'done'))).toBe('done');
  });

  it('puts problems first, then open items, then finished ones, keeping their order', () => {
    const sorted = sortAgendaItems([
      item('done1', true),
      item('open1', false),
      item('issue', true, 'issue'),
      item('open2', false),
      item('done2', true, 'done'),
    ]);
    expect(sorted.map((row) => row.key)).toEqual(['issue', 'open1', 'open2', 'done1', 'done2']);
  });

  it('counts open, issues and finished items of a section', () => {
    expect(
      agendaStats([item('a', true), item('b', false), item('c', true, 'issue'), item('d', false)])
    ).toEqual({ total: 4, done: 2, open: 2, issues: 1, finished: 1 });
  });
});
