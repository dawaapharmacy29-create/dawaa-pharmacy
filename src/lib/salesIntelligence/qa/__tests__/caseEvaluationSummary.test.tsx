import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadCaseEvaluationSummaries } from '../caseEvaluationSummary';
import { SavedCaseEvaluationSummary } from '@/components/salesIntelligence/CaseEvaluationSummaryCard';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const review = (patch = {}) => ({
  id: 'review-1', staff_id: 'staff-1', staff_name: 'د اختبار',
  whatsapp_review_source_id: 'source-1', sales_intelligence_case_id: 'case-1',
  evaluation_kind: 'automatic', automatic_evaluation_version: 'v2',
  final_score: 96, total_score: 96, is_current: true, superseded_at: null,
  impact_status: 'approved', manager_reviewed_at: null, manager_reviewed_by: null,
  evidence_coverage_percent: 85, automatic_reliability_percent: 90,
  manual_clinical_review_required: true, ...patch,
});

function client(data: unknown, error: unknown = null) {
  const query: any = {};
  for (const method of ['select', 'eq', 'order']) query[method] = vi.fn(() => query);
  query.limit = vi.fn(async () => ({ data, error }));
  return { from: vi.fn(() => query), query };
}

async function render(data: unknown) {
  const rows = await loadCaseEvaluationSummaries(client(data), 'source-1', 'case-1');
  return { rows, html: renderToStaticMarkup(createElement(SavedCaseEvaluationSummary, { rows })) };
}

describe('saved case evaluation summary', () => {
  it('reads only the selected source/case current canonical records with a bounded projection', async () => {
    const db = client([review()]);
    await loadCaseEvaluationSummaries(db, 'source-1', 'case-1');
    expect(db.from).toHaveBeenCalledWith('conversation_sales_reviews_canonical_v2');
    expect(db.query.eq.mock.calls).toEqual([
      ['whatsapp_review_source_id', 'source-1'], ['sales_intelligence_case_id', 'case-1'], ['is_current', true],
    ]);
    expect(db.query.limit).toHaveBeenCalledWith(21);
    expect(db.query.select.mock.calls[0][0]).not.toContain('automatic_evaluation_json');
  });

  it('shows the saved proposal without promoting zero-point automatic approved status to manager approval', async () => {
    const { rows, html } = await render([review()]);
    expect(rows[0]).toMatchObject({ automaticScore: 96, official: false, officialScore: null });
    expect(html).toContain('96 / 100');
    expect(html).toContain('لم يُعتمد رسميًا بعد');
    expect(html).toContain('تغطية الأدلة: 85%');
    expect(html).toContain('مراجعة طبية بشرية منفصلة');
  });

  it('uses the central approval contract for official score', async () => {
    const { rows } = await render([review({ manager_reviewed_at: '2026-11-17', manager_reviewed_by: 'manager-1' })]);
    expect(rows[0]).toMatchObject({ official: true, officialScore: 96 });
  });

  it('keeps two doctors separate, never calculates a conversation average', async () => {
    const { html, rows } = await render([review(), review({ id: 'review-2', staff_id: 'staff-2', staff_name: 'د آخر', final_score: 60 })]);
    expect(rows).toHaveLength(2);
    expect(html).toContain('96 / 100');
    expect(html).toContain('60 / 100');
    expect(html).not.toContain('78 / 100');
  });

  it('does not borrow inherited automatic scores or evidence coverage from a manager correction', async () => {
    const { rows, html } = await render([review({ evaluation_kind: 'manager_correction', final_score: 80 })]);
    expect(rows[0]).toMatchObject({ automaticScore: null, evidenceCoverage: null, reliability: null, corrected: true });
    expect(html).toContain('تم استبدال النسخة الآلية بتصحيح بشري');
    expect(html).not.toContain('80 / 100');
  });

  it('preserves real zero and unknown/invalid scores without defaulting absence to zero', async () => {
    expect((await render([review({ final_score: 0 })])).html).toContain('0 / 100');
    for (const patch of [{ final_score: null, total_score: null }, { final_score: 101 }, { final_score: 'invalid' }]) {
      const { rows } = await render([review(patch)]);
      expect(rows[0].automaticScore).toBeNull();
    }
    expect((await render([])).html).toContain('لا يوجد تقييم محفوظ');
  });

  it('does not display rejected or superseded records as current evaluations', async () => {
    const { rows } = await render([review({ impact_status: 'rejected' }), review({ is_current: false })]);
    expect(rows).toEqual([]);
  });

  it('surfaces failed reads, over-limit, foreign-scope and duplicate staff records instead of plausible results', async () => {
    await expect(loadCaseEvaluationSummaries(client(null, { message: 'denied' }), 'source-1', 'case-1')).rejects.toThrow('تعذر تحميل');
    for (const data of [null, Array(21).fill(review()), [review({ sales_intelligence_case_id: 'other-case' })], [review(), review()]]) {
      await expect(loadCaseEvaluationSummaries(client(data), 'source-1', 'case-1')).rejects.toThrow();
    }
  });
});
