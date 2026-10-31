import { describe, expect, it } from 'vitest';
import { agendaComplianceSummary, agendaErrorMessage, agendaNoteRequired, groupAgendaItems, type AgendaItem } from '../branchManagerAgenda';

const item = (key: AgendaItem['key'], group: AgendaItem['group']): AgendaItem =>
  ({ key, group, count: 1, rows: [], done: false, state: null, note: null, marked_by: null });

describe('branch manager daily agenda', () => {
  it('asks for a note on every hand-closed item except a fine floor check', () => {
    expect(agendaNoteRequired(item('cash_reconciliation', 'check'), 'done')).toBe(false);
    expect(agendaNoteRequired(item('cash_reconciliation', 'check'), 'issue')).toBe(true);
    expect(agendaNoteRequired(item('high_discount', 'decide'), 'done')).toBe(true);
    expect(agendaNoteRequired(item('open_requests', 'auto'), 'done')).toBe(true);
  });

  it('groups items as data, decisions, then floor checks', () => {
    const grouped = groupAgendaItems([item('shelves_fridge', 'check'), item('big_customers', 'decide'), item('open_requests', 'auto')]);
    expect(grouped.map((section) => section.group)).toEqual(['auto', 'decide', 'check']);
  });

  it('maps the RPC errors to Arabic messages', () => {
    expect(agendaErrorMessage({ message: 'note_required' })).toBe('اكتب ملاحظة قصيرة باللي عملته');
    expect(agendaErrorMessage({ message: 'not_authorized' })).toBe('القائمة دي لمدير الفرع بس');
    expect(agendaErrorMessage({ message: 'Could not find the function public.get_branch_manager_agenda_v1' }))
      .toBe('قائمة اليوم لسه مش متفعلة على قاعدة البيانات');
  });

  it('counts full-check days of the cycle without today', () => {
    const day = (d: string, checks: number, issues = 0) => ({
      branch: 'shokry' as const, day: d, checks_done: checks, checks_total: 3, marked: checks,
      issues: Array.from({ length: issues }, () => ({ item: 'shelves_fridge' as const, note: 'x' })),
      first_marked_at: null, marked_by: null,
    });
    expect(agendaComplianceSummary([day('2026-10-31', 0), day('2026-10-30', 3, 1), day('2026-10-29', 2)], '2026-10-31'))
      .toEqual({ full: 1, past: 2, issues: 1 });
  });
});
