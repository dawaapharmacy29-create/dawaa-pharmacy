import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';

/**
 * ملاحظات التوجيه الموجّهة — الطبقة اللي بتقفل الفجوة بين "التقييم اتحسب"
 * و"الشخص المعني فعليًا استلم ملاحظة يقدر يتصرف عليها". أي مستوى إداري
 * (خدمة عملاء / مدير فرع / مدير فروع / مدير عام) يقدر يوجّه ملاحظة لأي
 * موظف تحته، وكل ملاحظة ممكن تتربط بمصدرها الأصلي (مراجعة محادثة، تقييم
 * أسبوعي، إلخ) عشان السياق يفضل واضح لما حد يرجع يقرأها بعدين.
 */

export type CoachingRole = 'customer_service' | 'branch_manager' | 'branches_manager' | 'general_manager';
export type CoachingRecipientRole = 'doctor' | 'customer_service' | 'branch_manager' | 'branches_manager';
export type CoachingCategory =
  | 'conversation_quality'
  | 'followups'
  | 'sales_quality'
  | 'discipline'
  | 'data_quality'
  | 'general';
export type CoachingTone = 'praise' | 'coaching' | 'warning';

export type CoachingNote = {
  id: string;
  from_staff_id: string | null;
  from_staff_name: string;
  from_role: CoachingRole;
  to_staff_id: string;
  to_staff_name: string;
  to_role: CoachingRecipientRole;
  branch: string | null;
  category: CoachingCategory;
  tone: CoachingTone;
  note: string;
  linked_table: string | null;
  linked_record_id: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewCoachingNote = {
  from_staff_id?: string | null;
  from_staff_name: string;
  from_role: CoachingRole;
  to_staff_id: string;
  to_staff_name: string;
  to_role: CoachingRecipientRole;
  branch?: string | null;
  category?: CoachingCategory;
  tone?: CoachingTone;
  note: string;
  linked_table?: string | null;
  linked_record_id?: string | null;
};

export async function addCoachingNote(input: NewCoachingNote): Promise<{ error: string | null }> {
  const { error } = await supabase.from(TABLES.staffCoachingNotes).insert({
    from_staff_id: input.from_staff_id ?? null,
    from_staff_name: input.from_staff_name,
    from_role: input.from_role,
    to_staff_id: input.to_staff_id,
    to_staff_name: input.to_staff_name,
    to_role: input.to_role,
    branch: input.branch ?? null,
    category: input.category ?? 'general',
    tone: input.tone ?? 'coaching',
    note: input.note.trim(),
    linked_table: input.linked_table ?? null,
    linked_record_id: input.linked_record_id ?? null,
  });
  return { error: error?.message ?? null };
}

/** ملاحظات موجهة لموظف معيّن (يستخدمها الدكتور/خدمة العملاء/مدير الفرع في لوحته الشخصية). */
export async function fetchNotesForStaff(staffId: string, limit = 20): Promise<CoachingNote[]> {
  const { data, error } = await supabase
    .from(TABLES.staffCoachingNotes)
    .select('*')
    .eq('to_staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as CoachingNote[];
}

/** كل ملاحظات فرع معيّن (يستخدمها مدير الفرع أو مدير الفروع للمتابعة). */
export async function fetchNotesForBranch(branch: string, limit = 100): Promise<CoachingNote[]> {
  const { data, error } = await supabase
    .from(TABLES.staffCoachingNotes)
    .select('*')
    .eq('branch', branch)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as CoachingNote[];
}

/** كل الملاحظات بدون فلترة (شاشة المدير العام فقط). */
export async function fetchAllNotes(limit = 200): Promise<CoachingNote[]> {
  const { data, error } = await supabase
    .from(TABLES.staffCoachingNotes)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as CoachingNote[];
}

export async function acknowledgeCoachingNote(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from(TABLES.staffCoachingNotes)
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error?.message ?? null };
}
