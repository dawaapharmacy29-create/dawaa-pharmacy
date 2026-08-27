import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';

export type StaffPerformanceProjectionRow = Pick<
  StaffChoice,
  | 'id'
  | 'name'
  | 'original_name'
  | 'display_name'
  | 'role'
  | 'branch'
  | 'branch_id'
  | 'phone'
  | 'status'
  | 'active'
  | 'points'
  | 'max_points'
  | 'duplicate_ids'
  | 'aliases'
  | 'duplicate_count'
>;

let inFlightRead: Promise<StaffPerformanceProjectionRow[]> | null = null;

async function loadProjection(): Promise<StaffPerformanceProjectionRow[]> {
  const { data, error } = await supabase.from('staff').select('*').limit(800);

  if (error) {
    throw new Error(`تعذر تحميل إسقاط أداء الموظفين: ${error.message}`);
  }

  return mergeStaffChoices((data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      original_name: row.original_name,
      display_name: row.display_name,
      role: row.role,
      branch: row.branch,
      branch_id: row.branch_id ?? null,
      phone: row.phone ?? null,
      status: row.status ?? null,
      active: row.active ?? null,
      points: row.points,
      max_points: row.max_points,
      duplicate_ids: row.duplicate_ids,
      aliases: row.aliases,
      duplicate_count: row.duplicate_count,
    }))
    .sort((a, b) => {
      const pointsDiff = (b.points ?? Number.NEGATIVE_INFINITY) - (a.points ?? Number.NEGATIVE_INFINITY);
      if (pointsDiff !== 0) return pointsDiff;
      return `${a.branch}-${a.role}-${a.name}`.localeCompare(
        `${b.branch}-${b.role}-${b.name}`,
        'ar'
      );
    });
}

/**
 * Canonical read boundary for staff identity plus the current points fields.
 *
 * Keep this separate from Staff Directory: identity-only pages should not inherit
 * performance fields. Points/Reviews can use this projection when they genuinely
 * need points/max_points without continuing to query the physical staff table.
 *
 * The projection deliberately reuses mergeStaffChoices so duplicate selection,
 * aliases, display names and active/deleted filtering stay compatible with the
 * current performance screens during migration.
 */
export async function readStaffPerformanceProjection(): Promise<StaffPerformanceProjectionRow[]> {
  if (!isSupabaseConfigured) return [];
  if (inFlightRead) return inFlightRead;

  const load = loadProjection().finally(() => {
    if (inFlightRead === load) inFlightRead = null;
  });
  inFlightRead = load;
  return load;
}
