import { supabase } from './supabase';

export interface StaffDuplicateGroup {
  normalized_name: string;
  staff: StaffDuplicateRecord[];
}

export interface StaffDuplicateRecord {
  staff_id: string;
  staff_account_id?: string;
  display_name: string;
  normalized_name: string;
  role: string;
  branch: string;
  active: boolean;
  created_at: string;
  linked_user_id?: string;
  sales_invoice_count: number;
  staff_sales_summary_count: number;
  employee_transactions_count: number;
  points_transactions_count: number;
  point_records_count: number;
  conversation_reviews_count: number;
  daily_followups_count: number;
  shift_schedule_count: number;
  attendance_count: number;
  time_off_count: number;
  stagnant_list_records_count: number;
}

/**
 * تطبيع الاسم العربي للكشف عن التكرارات
 */
export function normalizeStaffName(name: string): string {
  if (!name) return '';

  const normalized = name
    // إزالة البادئات الشائعة
    .replace(/^(د|د\/|د\.|دكتور|أ|أ\/|أ\.|أستاذ|م|م\/|م\.|مهندس)/i, '')
    // إزالة المسافات الزائدة
    .trim()
    // توحيد الحروف المتشابهة
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ي]/g, 'ى')
    // إزالة علامات الترقيم
    .replace(/[.,،\-_]/g, '')
    // إزالة المسافات الداخلية
    .replace(/\s+/g, '')
    // تحويل إلى أحرف صغيرة
    .toLowerCase();

  return normalized;
}

/**
 * جلب جميع الموظفين مع بياناتهم
 */
export async function fetchAllStaffWithCounts(): Promise<StaffDuplicateRecord[]> {
  const { data: staffData, error: staffError } = await supabase
    .from('staff')
    .select('id, name, role, branch, active, created_at, user_id');

  if (staffError) throw new Error(staffError.message);

  const staffRecords: StaffDuplicateRecord[] = [];

  for (const staff of staffData || []) {
    const display_name = staff.name || '';
    const normalized_name = normalizeStaffName(display_name);

    // جلب العدادات لكل جدول
    const [
      { count: sales_invoice_count },
      { count: staff_sales_summary_count },
      { count: employee_transactions_count },
      { count: points_transactions_count },
      { count: point_records_count },
      { count: conversation_reviews_count },
      { count: daily_followups_count },
      { count: shift_schedule_count },
      { count: attendance_count },
      { count: time_off_count },
      { count: stagnant_list_records_count },
    ] = await Promise.all([
      supabase
        .from('sales_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('staff_sales_summary')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('employee_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('points_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('point_records')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('conversation_sales_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('daily_followups')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('shift_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('time_off')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
      supabase
        .from('stagnant_medicine_dispenses')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', staff.id),
    ]);

    staffRecords.push({
      staff_id: staff.id,
      staff_account_id: staff.user_id || undefined,
      display_name,
      normalized_name,
      role: staff.role || '',
      branch: staff.branch || '',
      active: staff.active || false,
      created_at: staff.created_at || '',
      linked_user_id: staff.user_id || undefined,
      sales_invoice_count: sales_invoice_count || 0,
      staff_sales_summary_count: staff_sales_summary_count || 0,
      employee_transactions_count: employee_transactions_count || 0,
      points_transactions_count: points_transactions_count || 0,
      point_records_count: point_records_count || 0,
      conversation_reviews_count: conversation_reviews_count || 0,
      daily_followups_count: daily_followups_count || 0,
      shift_schedule_count: shift_schedule_count || 0,
      attendance_count: attendance_count || 0,
      time_off_count: time_off_count || 0,
      stagnant_list_records_count: stagnant_list_records_count || 0,
    });
  }

  return staffRecords;
}

/**
 * العثور على الموظفين المكررين
 */
export async function findStaffDuplicates(): Promise<StaffDuplicateGroup[]> {
  const allStaff = await fetchAllStaffWithCounts();

  // تجميع حسب الاسم الموحد
  const groups = new Map<string, StaffDuplicateRecord[]>();

  for (const staff of allStaff) {
    const normalized = staff.normalized_name;
    if (!normalized) continue;

    if (!groups.has(normalized)) {
      groups.set(normalized, []);
    }
    groups.get(normalized)!.push(staff);
  }

  // تصفية المجموعات التي تحتوي على أكثر من موظف واحد
  const duplicateGroups: StaffDuplicateGroup[] = [];

  for (const [normalized_name, staff] of groups) {
    if (staff.length > 1) {
      duplicateGroups.push({
        normalized_name,
        staff,
      });
    }
  }

  // ترتيب حسب عدد الموظفين في المجموعة (الأكثر تكراراً أولاً)
  duplicateGroups.sort((a, b) => b.staff.length - a.staff.length);

  return duplicateGroups;
}

/**
 * الحصول على إحصائيات التكرار
 */
export async function getDuplicateStatistics() {
  const duplicateGroups = await findStaffDuplicates();

  const totalStaff =
    (await supabase.from('staff').select('*', { count: 'exact', head: true })).count || 0;
  const totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.staff.length, 0);
  const uniqueDuplicateNames = duplicateGroups.length;

  return {
    totalStaff,
    totalDuplicates,
    uniqueDuplicateNames,
    duplicateGroups,
  };
}
