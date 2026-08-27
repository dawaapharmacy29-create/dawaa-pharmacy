import { normalizeBranchName } from '@/lib/branch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type StaffPerformanceProjectionRow = {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id: string | null;
  phone: string | null;
  status: string | null;
  active: boolean;
  points: number | null;
  max_points: number | null;
};

type RawRow = Record<string, unknown>;
let inFlightRead: Promise<StaffPerformanceProjectionRow[]> | null = null;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowIsActive(row: RawRow) {
  if (row.active === false || row.is_active === false) return false;
  if (row.is_deleted === true || row.deleted_at) return false;
  return !/inactive|disabled|archived|موقوف|غير نشط/i.test(text(row.status));
}

function mapRow(row: RawRow): StaffPerformanceProjectionRow | null {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name || !rowIsActive(row)) return null;

  return {
    id,
    name,
    role: text(row.role || row.type),
    branch: normalizeBranchName(row.branch || row.branch_name) || '',
    branch_id: nullableText(row.branch_id),
    phone: nullableText(row.phone),
    status: nullableText(row.status),
    active: true,
    points: nullableNumber(row.points),
    max_points: nullableNumber(row.max_points),
  };
}

async function loadProjection(): Promise<StaffPerformanceProjectionRow[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('id,name,role,type,branch,branch_name,branch_id,phone,status,active,is_active,deleted_at,is_deleted,points,max_points')
    .limit(800);

  if (error) {
    throw new Error(`تعذر تحميل إسقاط أداء الموظفين: ${error.message}`);
  }

  return ((data ?? []) as RawRow[])
    .flatMap((row) => {
      const mapped = mapRow(row);
      return mapped ? [mapped] : [];
    })
    .sort((a, b) => {
      const pointsDiff = (b.points ?? Number.NEGATIVE_INFINITY) - (a.points ?? Number.NEGATIVE_INFINITY);
      if (pointsDiff !== 0) return pointsDiff;
      return a.name.localeCompare(b.name, 'ar');
    });
}

/**
 * Canonical read boundary for staff performance identity + current points fields.
 *
 * Keep this separate from Staff Directory: identity pages should not inherit
 * performance fields, while Points/Reviews can migrate away from direct staff
 * table reads without losing points/max_points or branch metadata.
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
