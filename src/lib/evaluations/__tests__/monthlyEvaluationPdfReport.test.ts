import { describe, expect, it } from 'vitest';
import { buildApprovedMonthlyEvaluationPdfReport } from '@/lib/evaluations/monthlyEvaluationPdfReport';

const sections = [{ key: 'discipline', title: 'الالتزام', description: 'اختبار', weight: 100, score: 0, notes: '', rubric: ['1','2','3','4','5'] as [string,string,string,string,string] }];

describe('monthly evaluation PDF report truth', () => {
  it('requires an approved snapshot and hash', () => {
    expect(buildApprovedMonthlyEvaluationPdfReport({ snapshot: null, snapshotHash: '', fallbackSections: sections })).toBe(null);
    expect(buildApprovedMonthlyEvaluationPdfReport({ snapshot: { schema: 'monthly_evaluation_final_snapshot_v5' }, snapshotHash: '', fallbackSections: sections })).toBe(null);
  });

  it('reads final report facts from the immutable approval snapshot', () => {
    const report = buildApprovedMonthlyEvaluationPdfReport({
      snapshotHash: 'abc123',
      fallbackSections: sections,
      snapshot: {
        schema: 'monthly_evaluation_final_snapshot_v5',
        approved_at: '2026-09-26T10:00:00Z', evaluator_name: 'المدير', overall_score: 80, grade: 'جيد جدًا',
        sections: [{ key: 'discipline', score: 4, notes: 'ملتزم' }],
        strengths: ['قوة'], development_points: ['تطوير'], manager_notes: 'نهائي',
        active_critical_gates: ['repeated_negligence'],
        server_evidence: { health: { reviews: 'available', followups: 'available', attendance: 'available' } },
        coaching_snapshot: {
          conversation: { reviewCount: 24, coreAverage: 9.7, flags: { medicalErrors: 0, invoiceErrors: 1 } },
          followups: { completed: 7, total: 8 },
          attendance: { resolvedDays: 20, pendingReviewCases: 0, conflictingResolutionDays: 0, lateCases: 1, veryLateCases: 2, lateMinutes: 45, absenceCases: 0 },
        },
      },
    });
    expect(report?.overallScore).toBe(80);
    expect(report?.sections[0].score).toBe(4);
    expect(report?.criticalGates).toEqual(['repeated_negligence']);
    expect(report?.evidence.conversationReviews).toBe(24);
    expect(report?.evidence.followupsTotal).toBe(8);
    expect(report?.evidence.attendanceLateCases).toBe(3);
    expect(report?.snapshotHash).toBe('abc123');
  });
});
