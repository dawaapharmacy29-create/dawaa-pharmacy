import { supabase } from '@/lib/supabase';

// عجز الأرصدة والأصناف المنتهية لكل فرع في كل دورة، بإدخال يدوي من الإدارة العليا
// (migration 20261114140000). مصدر بند «العجز والإكسبير» في محفظة الخصومات.

export type LossBranchKey = 'shokry' | 'elshamy';
export const LOSS_BRANCHES: { key: LossBranchKey; label: string }[] = [
  { key: 'shokry', label: 'فرع شكري' },
  { key: 'elshamy', label: 'فرع الشامي' },
];

export interface BranchCycleLoss {
  cycle_start: string;
  branch_key: LossBranchKey;
  stock_shortage: number;
  expired_value: number;
  note: string | null;
  entered_by_name: string | null;
  entered_at: string;
}

/** The 26th that opens the cycle a day belongs to, and the `count` cycles before it (newest first). */
export function recentCycleStarts(day: string, count: number): string[] {
  const [y, m, d] = day.split('-').map(Number);
  const first = d >= 26 ? m - 1 : m - 2;
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, first - i, 26)).toISOString().slice(0, 10)
  );
}

/** Reads "1,250.5", "١٢٥٠" or "" as a non-negative amount; null when it is not one. */
export function parseAmount(text: string): number | null {
  const western = text
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[,،\s]/g, '')
    .replace('٫', '.');
  if (!western) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(western)) return null;
  return Number(western);
}

export function lossErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  if (message.includes('not_authorized')) return 'الإدخال للإدارة العليا بس';
  if (message.includes('invalid_amount')) return 'المبلغ لازم يكون رقم موجب';
  if (message.includes('invalid_cycle')) return 'الدورة دي لسه ما بدأتش';
  if (message.includes('Could not find the function') || message.includes('PGRST202'))
    return 'إدخال العجز والإكسبير لسه مش متفعل على قاعدة البيانات';
  return 'حصلت مشكلة، جرّب تاني';
}

export async function listBranchCycleLosses(from: string) {
  const { data, error } = await supabase.rpc('list_branch_cycle_losses_v1', { p_from: from });
  if (error) throw error;
  return ((data || []) as BranchCycleLoss[]).map((row) => ({
    ...row,
    stock_shortage: Number(row.stock_shortage),
    expired_value: Number(row.expired_value),
  }));
}

export async function setBranchCycleLoss(
  cycleStart: string,
  branch: LossBranchKey,
  stockShortage: number,
  expiredValue: number,
  note: string
) {
  const { error } = await supabase.rpc('set_branch_cycle_losses_v1', {
    p_cycle_start: cycleStart,
    p_branch_key: branch,
    p_stock_shortage: stockShortage,
    p_expired_value: expiredValue,
    p_note: note,
  });
  if (error) throw error;
}
