import { supabase } from '@/lib/supabase';

/**
 * ملخص جودة أداء الدكتور في المحادثات — الطبقة الذكية اللي بتحوّل 12 بُعد
 * تقييم رقمي متناثر (من conversation_sales_reviews) لنقاط قوة وضعف واضحة،
 * عشان مدير الفرع/الفروع يقدر يشوف عيوب ومميزات كل دكتور من نظرة واحدة
 * بدل ما يقرأ عشرات المحادثات.
 */

export type DimensionKey =
  | 'response_speed' | 'greeting' | 'tone_language' | 'understanding' | 'follow_up'
  | 'consultation_quality' | 'dosage_explanation' | 'alternative_handling'
  | 'sales_quality' | 'upsell_cross_sell' | 'complaint_handling' | 'order_confirmation'
  | 'closing_message';

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  response_speed: 'سرعة الرد',
  greeting: 'التحية',
  tone_language: 'نبرة ولغة التعامل',
  understanding: 'فهم احتياج العميل',
  follow_up: 'المتابعة',
  consultation_quality: 'جودة الاستشارة',
  dosage_explanation: 'شرح الجرعة',
  alternative_handling: 'التعامل مع البدائل',
  sales_quality: 'جودة البيع',
  upsell_cross_sell: 'البيع الإضافي/التكميلي',
  complaint_handling: 'التعامل مع الشكاوى',
  order_confirmation: 'تأكيد الطلب',
  closing_message: 'رسالة الختام',
};

const DIMENSION_KEYS: DimensionKey[] = Object.keys(DIMENSION_LABELS) as DimensionKey[];

export type DoctorQualitySummary = {
  doctorId: string | null;
  doctorName: string;
  branch: string;
  reviewCount: number;
  avgFinalScore: number | null;
  dimensions: { key: DimensionKey; label: string; avg: number | null }[];
  strengths: { key: DimensionKey; label: string; avg: number }[];
  weaknesses: { key: DimensionKey; label: string; avg: number }[];
  flags: {
    complaintCount: number;
    medicalErrorCount: number;
    badToneCount: number;
    severeBadToneCount: number;
    missedSaleCount: number;
    excellentCaseCount: number;
  };
  coachingNotes: { praise: number; coaching: number; warning: number };
  riskLevel: 'critical' | 'watch' | 'stable' | 'excelling';
};

type RpcRow = Record<string, unknown>;

function n(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** درجة إنذار مبسّطة لترتيب الشاشة — الأخطاء الحرجة تتفضّل دايمًا فوق أي حاجة تانية. */
function computeRiskLevel(row: DoctorQualitySummary): DoctorQualitySummary['riskLevel'] {
  if (row.flags.medicalErrorCount > 0 || row.flags.severeBadToneCount > 0) return 'critical';
  if (row.flags.complaintCount >= 2 || row.flags.badToneCount >= 2 || row.coachingNotes.warning >= 2) return 'watch';
  if ((row.avgFinalScore ?? 0) >= 95 && row.flags.excellentCaseCount > 0) return 'excelling';
  return 'stable';
}

/**
 * يجلب ملخص كل الدكاترة (أو فرع معيّن) خلال آخر days يوم، ويحوّل الأبعاد
 * الرقمية الخام لأعلى 3 نقاط قوة وأقل 3 نقاط ضعف لكل دكتور. بُعد لازم يكون
 * عنده 3 محادثات على الأقل يتقيّم فيها (min_samples) عشان يدخل الترتيب —
 * أقل من كده العينة صغيرة جدًا تستاهل حكم.
 */
export async function fetchDoctorQualitySummaries(
  branch: string | null = null,
  days = 30,
  minSamples = 3
): Promise<{ rows: DoctorQualitySummary[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_doctor_conversation_quality_summary', {
    p_branch: branch,
    p_days: days,
  });
  if (error) return { rows: [], error: error.message };

  const rows: DoctorQualitySummary[] = ((data as RpcRow[]) || []).map((row) => {
    const reviewCount = Number(row.review_count) || 0;
    const sampleFloor = Math.min(minSamples, Math.max(1, Math.floor(reviewCount / 4)));

    const dimensions = DIMENSION_KEYS.map((key) => ({
      key,
      label: DIMENSION_LABELS[key],
      avg: n(row[`avg_${key}`]),
    }));

    // نرتّب بس الأبعاد اللي عندها بيانات كافية (مش null وعدد العينة معقول)
    const ranked = dimensions.filter((d) => d.avg !== null) as { key: DimensionKey; label: string; avg: number }[];
    const bySize = reviewCount >= minSamples ? ranked : ranked.filter(() => reviewCount >= sampleFloor);

    const strengths = [...bySize].sort((a, b) => b.avg - a.avg).slice(0, 3).filter((d) => d.avg >= 7);
    const weaknesses = [...bySize].sort((a, b) => a.avg - b.avg).slice(0, 3).filter((d) => d.avg <= 7.5);

    const summary: DoctorQualitySummary = {
      doctorId: row.doctor_id ? String(row.doctor_id) : null,
      doctorName: String(row.doctor_name || ''),
      branch: String(row.branch || ''),
      reviewCount,
      avgFinalScore: n(row.avg_final_score),
      dimensions,
      strengths,
      weaknesses,
      flags: {
        complaintCount: Number(row.complaint_count) || 0,
        medicalErrorCount: Number(row.medical_error_count) || 0,
        badToneCount: Number(row.bad_tone_count) || 0,
        severeBadToneCount: Number(row.severe_bad_tone_count) || 0,
        missedSaleCount: Number(row.missed_sale_count) || 0,
        excellentCaseCount: Number(row.excellent_case_count) || 0,
      },
      coachingNotes: {
        praise: Number(row.notes_praise_count) || 0,
        coaching: Number(row.notes_coaching_count) || 0,
        warning: Number(row.notes_warning_count) || 0,
      },
      riskLevel: 'stable',
    };
    summary.riskLevel = computeRiskLevel(summary);
    return summary;
  });

  // الأولوية للحالات الحرجة، بعدين تحت المراقبة، بعدين الباقي حسب عدد المحادثات
  const order: Record<DoctorQualitySummary['riskLevel'], number> = { critical: 0, watch: 1, stable: 2, excelling: 3 };
  rows.sort((a, b) => order[a.riskLevel] - order[b.riskLevel] || b.reviewCount - a.reviewCount);

  return { rows, error: null };
}

export type DoctorAlert = {
  alertType: 'repeat_error' | 'fraud_flag' | 'coaching_warning';
  doctorId: string | null;
  doctorName: string;
  branch: string;
  detail: string;
  severity: 'critical' | 'warning';
  occurredAt: string;
  sourceId: string | null;
};

export const ALERT_TYPE_LABELS: Record<DoctorAlert['alertType'], string> = {
  repeat_error: 'تكرار خطأ في تقييم محادثة',
  fraud_flag: 'تبليغ تلاعب في متابعة',
  coaching_warning: 'ملاحظة تدريب تحذيرية',
};

/**
 * لوحة تنبيهات مجمّعة للمدير: بتجمع 3 مصادر إنذار كانت متفرقة كل واحد جوه
 * شاشته لوحده (تكرار أخطاء المحادثات، تبليغات تلاعب المتابعات، ملاحظات
 * التدريب التحذيرية) في مصدر واحد مرتب بالأحدث والأخطر أولاً.
 */
export async function fetchManagerDoctorAlerts(
  branch: string | null = null,
  days = 30
): Promise<{ rows: DoctorAlert[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_manager_doctor_alerts', {
    p_branch: branch,
    p_days: days,
  });
  if (error) return { rows: [], error: error.message };
  const rows: DoctorAlert[] = ((data as RpcRow[]) || []).map((row) => ({
    alertType: String(row.alert_type) as DoctorAlert['alertType'],
    doctorId: row.doctor_id ? String(row.doctor_id) : null,
    doctorName: String(row.doctor_name || 'غير محدد'),
    branch: String(row.branch || ''),
    detail: String(row.detail || ''),
    severity: (String(row.severity) as DoctorAlert['severity']) || 'warning',
    occurredAt: String(row.occurred_at || ''),
    sourceId: row.source_id ? String(row.source_id) : null,
  }));
  return { rows, error: null };
}
