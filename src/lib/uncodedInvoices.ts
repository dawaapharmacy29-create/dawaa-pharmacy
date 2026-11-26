import { supabase } from '@/supabaseClient';

// تحليل الفواتير اللي مش على كود عميل حقيقي (كود ٧ أو من غير كود) — dawaa_uncoded_invoices_analysis_v1.
// للإدارة بس، ومش داخل في أي تقييم دلوقتي.

export const UNCODED_REASONS = {
  none: 'من غير ملاحظة',
  data: 'كاتب بيانات العميل',
  refused: 'رفض التسجيل',
  child: 'طفل',
  hurry: 'مستعجل / تعبان',
  no_phone: 'مالوش أو مايعرفش رقم',
  bad_number: 'رقم ناقص أو غلط',
  other: 'سبب تاني',
} as const;
export type UncodedReason = keyof typeof UNCODED_REASONS;

export type UncodedBranch = {
  branch: string;
  total: number;
  uncoded: number;
  with_note: number;
  no_note: number;
  reasons: Partial<Record<UncodedReason, number>>;
};

export type UncodedDoctor = {
  branch: string;
  seller: string;
  total: number;
  uncoded: number;
  no_note: number;
  data: number;
  refused: number;
  child: number;
  hurry: number;
};

export type UncodedDay = {
  day: string;
  branch: string;
  total: number;
  uncoded: number;
  no_note: number;
};

export type UncodedAnalysis = {
  from: string;
  to: string;
  branches: UncodedBranch[];
  doctors: UncodedDoctor[];
  days: UncodedDay[];
};

export async function loadUncodedAnalysis(from: string, to: string): Promise<UncodedAnalysis> {
  const { data, error } = await supabase.rpc('dawaa_uncoded_invoices_analysis_v1', {
    p_from: from,
    p_to: to,
  });
  if (error) {
    if (/not_authorized/.test(error.message)) throw new Error('الصفحة دي للإدارة بس');
    throw new Error(error.message || 'تعذّر تحميل التحليل');
  }
  const d = data as UncodedAnalysis;
  return { ...d, branches: d.branches ?? [], doctors: d.doctors ?? [], days: d.days ?? [] };
}

export const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;
