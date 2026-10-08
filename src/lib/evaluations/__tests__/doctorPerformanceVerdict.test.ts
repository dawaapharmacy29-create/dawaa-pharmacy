import { describe, expect, it } from 'vitest';
import { buildDoctorPerformanceVerdict } from '@/lib/evaluations/doctorPerformanceVerdict';
import type { DoctorPerformanceIntelligence, DoctorPerformanceMonth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';
import type { MonthlyConversationCoaching } from '@/lib/staff/employeeMonthlyEvidenceService';

const impact = { available: true, commercialConversations: 2, verifiedSaleConversations: 1, verifiedRevenue: 0, verifiedConversionRate: 50, followupsNeeded: 0, complaints: 0, saleLeakage: 0, unavailableProducts: 0, acceptedProducts: 0 };
function month(sales: number | null, eligible = true): DoctorPerformanceMonth {
  return {
    cycleLabel: 'x', displayLabel: '', sales, invoices: 1, customers: 1, averageInvoice: 1, workedHours: 1, salesPerHour: 1, invoicesPerHour: 1, customersPerHour: 1,
    conversations: 1, convertedConversations: 1, conversionRate: 1, coverage: 'available', confidence: 'high', coverageReason: '', comparisonEligible: eligible,
    comparisonMode: eligible ? 'full_cycle' : 'blocked', comparisonReason: 'محجوبة', comparisonSnapshot: null, salesIdentity: 'canonical', salesSourceAvailable: true,
    attendanceSourceAvailable: true, conversationSourceAvailable: true, salesEvidenceCount: 1, attendanceEvidenceCount: 1, conversationEvidenceCount: 1, customerImpact: impact, diagnoses: [],
  };
}
const ok = { status: 'available' as const, error: null, evidenceCount: 1, firstEvidenceDate: null, dataAsOf: null };
function data(cur: number | null, prev: number | null, salesStatus: 'available' | 'unavailable' = 'available'): DoctorPerformanceIntelligence {
  return { months: [month(cur), month(prev), month(prev)], sources: { sales: { ...ok, status: salesStatus, error: salesStatus === 'available' ? null : 'انتهت مهلة مصدر المبيعات (57014).' }, attendance: ok, conversations: ok, customerImpact: ok },
    actions: [], generatedAt: '', firstEvidenceDate: null, firstSalesEvidenceDate: null, firstAttendanceEvidenceDate: null, firstConversationEvidenceDate: null };
}
function header(worked: number | null, late: number | null): EvaluationHeaderSummary {
  return { roleGroup: 'doctor', branch: '', sales: { state: 'available', total: 0, invoices: 0, avgInvoice: 0, customers: 0, dataAsOf: null }, conversations: { state: 'available', count: 0, average: null },
    attendance: { state: worked === null ? 'unavailable' : 'available', workedDays: worked, workedHours: null, scheduledDays: null, lateDays: late, absenceReviewDays: null },
    timeOff: { state: 'available', permissions: null, permissionMinutes: null, annualLeaveCycleDays: null, annualLeaveYearUsed: null, annualLeaveYearBalance: null, weeklyOffDays: null, otherApprovedLeaveDays: null }, warnings: [] };
}
function conv(over: Partial<MonthlyConversationCoaching> = {}): MonthlyConversationCoaching {
  return { reviewCount: 24, sampleSufficient: true, minSamples: 3, dimensions: [], coreDimensions: [], coreAverage: 8, strengths: [], weaknesses: [], positiveReasons: [], negativeReasons: [], trainingRecommendations: [],
    flags: { complaints: 0, medicalErrors: 0, badAlternativeCases: 0, badTone: 0, severeBadTone: 0, missedSales: 0, invoiceErrors: 0, excellentCases: 0, criticalErrors: 0 }, examples: [], drafts: { strength: '', development: '', actionPlan: '', measurement: '' }, ...over } as MonthlyConversationCoaching;
}

describe('doctor performance verdict', () => {
  it('reads growing sales with frequent lateness as improving with lateness as the main problem', () => {
    const v = buildDoctorPerformanceVerdict({ data: data(401791.81, 326588.14), header: header(15, 10), conversation: conv() });
    expect(v.signal).toBe('improving');
    expect(v.lead).toBe('problem');
    expect(v.headline.startsWith('الأولوية: تأخير')).toBe(true);
    expect(v.headline).toContain('رغم تحسن المبيعات');
    expect(v.badge.tone).toBe('danger');
    expect(v.problem?.text).toContain('١٠');
    expect(v.strength?.text).toContain('نمو المبيعات');
    expect(v.action?.owner).toBe('doctor');
  });

  it('ranks patient-safety errors above lateness and sales', () => {
    const v = buildDoctorPerformanceVerdict({ data: data(50, 100), header: header(15, 10), conversation: conv({ flags: { ...conv().flags, medicalErrors: 2 } }) });
    expect(v.signal).toBe('declining');
    expect(v.lead).toBe('problem');
    expect(v.headline).toContain('أخطاء طبية');
    expect(v.problem?.text).toContain('أخطاء طبية');
    expect(v.action?.owner).toBe('manager');
  });

  it('keeps the sales trend as the headline when no priority problem is documented', () => {
    const v = buildDoctorPerformanceVerdict({ data: data(80, 100), header: header(20, 1), conversation: conv() });
    expect(v.lead).toBe('trend');
    expect(v.headline.startsWith('المبيعات تتراجع')).toBe(true);
    expect(v.badge.label).toBe('المبيعات تتراجع ↓');
  });

  it('never invents a problem or a strength without crossing a threshold', () => {
    const v = buildDoctorPerformanceVerdict({ data: data(102, 100), header: header(20, 1), conversation: conv() });
    expect(v.signal).toBe('stable');
    expect(v.lead).toBe('trend');
    expect(v.headline.startsWith('المبيعات مستقرة')).toBe(true);
    expect(v.problem).toBe(null);
    expect(v.strength).toBe(null);
    expect(v.action).toBe(null);
  });

  it('treats an unavailable sales source as insufficient, not zero, and asks for a reload', () => {
    const v = buildDoctorPerformanceVerdict({ data: data(null, null, 'unavailable'), header: header(15, 0), conversation: conv() });
    expect(v.signal).toBe('insufficient');
    expect(v.metrics[0].value).toBe('غير متاح');
    expect(v.metrics[0].note).toContain('57014');
    expect(v.action?.text).toContain('إعادة تحميل');
  });

  it('does not announce no documented problems when customer impact is missing', () => {
    const d = data(102, 100);
    d.sources.customerImpact = { ...ok, status: 'partial', evidenceCount: 0 };
    d.months[0].customerImpact = { ...impact, available: false };
    const v = buildDoctorPerformanceVerdict({ data: d, header: header(20, 1), conversation: conv() });
    expect(v.headline).toContain('الأدلة غير مكتملة');
    expect(v.headline).not.toContain('ولا توجد مشكلة موثقة');
  });

  it('does not judge discipline or quality while their evidence is missing', () => {
    const v = buildDoctorPerformanceVerdict({ data: data(100, 100), header: null, conversation: conv({ sampleSufficient: false, coreAverage: null, reviewCount: 1 }) });
    expect(v.metrics[1].value).toBe('غير متاح');
    expect(v.metrics[2].value).toBe('غير كافٍ');
    expect(v.problem).toBe(null);
  });
});
