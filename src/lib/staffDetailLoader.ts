import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { normalizeStaffName } from '@/lib/staffIdentityService';
import { staffRowIsActive } from '@/lib/staffActiveFilter';
import { getStaffCycleIncentive, type StaffCycleIncentive } from '@/lib/staffIncentiveService';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';
import {
  getStaffSalesSummaryForPeriod,
  type StaffSalesSummary,
} from '@/lib/staff/sharedStaffSalesService';

export const STAFF_DETAIL_SECTION_TIMEOUT_MS = 8000;

export type StaffDetailSectionKey =
  | 'staff_base'
  | 'incentive'
  | 'sales'
  | 'customers'
  | 'attendance'
  | 'schedule'
  | 'stagnant_list'
  | 'pdf'
  | 'reviews'
  | 'medicines'
  | 'followups';

export type StaffDetailSectionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'timeout';

export type StaffBaseProfile = {
  id: string;
  name: string;
  branch: string;
  role: string;
  is_active: boolean;
  created_at?: string | null;
  points?: number | null;
  max_points?: number | null;
  active?: boolean | null;
  status?: string | null;
  primary_staff_id?: string | null;
  primary_staff_name?: string | null;
};

export type SectionLoadResult<T> =
  | { ok: true; data: T; timedOut?: boolean }
  | { ok: false; error: unknown; timedOut?: boolean };

function isDev() {
  return import.meta.env.DEV;
}

export function logStaffDetailSectionFailure(
  section: StaffDetailSectionKey,
  error: unknown,
  timedOut?: boolean
) {
  if (!isDev()) return;
  const label = timedOut ? 'timeout' : 'error';
  console.warn(`[StaffDetail:${section}] ${label}`, error);
}

export function withSectionTimeout<T>(
  promise: Promise<T>,
  ms = STAFF_DETAIL_SECTION_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SECTION_TIMEOUT_${ms}`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function runStaffDetailSection<T>(
  section: StaffDetailSectionKey,
  fn: () => Promise<T>,
  timeoutMs = STAFF_DETAIL_SECTION_TIMEOUT_MS
): Promise<SectionLoadResult<T>> {
  try {
    const data = await withSectionTimeout(fn(), timeoutMs);
    return { ok: true, data };
  } catch (error) {
    const timedOut = error instanceof Error && error.message.startsWith('SECTION_TIMEOUT_');
    logStaffDetailSectionFailure(section, error, timedOut);
    return { ok: false, error, timedOut };
  }
}

export async function loadStaffBaseProfile(staffId: string): Promise<StaffBaseProfile | null> {
  const result = await runStaffDetailSection('staff_base', async () => {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('staff')
      .select('id,name,branch,role,active,is_active,status,created_at,points,max_points')
      .eq('id', staffId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name || ''),
      branch: String(row.branch || 'غير محدد'),
      role: String(row.role || ''),
      is_active: staffRowIsActive(row as StaffBaseProfile),
      created_at: (row.created_at as string) || null,
      points: row.points as number | null,
      max_points: row.max_points as number | null,
      active: row.active as boolean | null,
      status: (row.status as string) || null,
    };
  });
  if (result.ok) return result.data;
  return null;
}

/** If inactive duplicate, find active primary with same normalized name. */
export async function resolvePrimaryStaffForInactive(
  profile: StaffBaseProfile
): Promise<StaffBaseProfile | null> {
  if (profile.is_active) return null;
  const normalized = normalizeStaffName(profile.name);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('staff')
    .select('id,name,branch,role,active,is_active,status,created_at,points,max_points')
    .neq('id', profile.id)
    .eq('branch', profile.branch)
    .limit(80);

  if (error) {
    logStaffDetailSectionFailure('staff_base', error);
    return null;
  }

  const match = (data || []).find((row) => {
    if (!staffRowIsActive(row as StaffBaseProfile)) return false;
    return normalizeStaffName(String((row as Record<string, unknown>).name || '')) === normalized;
  }) as Record<string, unknown> | undefined;

  if (!match) return null;
  return {
    id: String(match.id),
    name: String(match.name || ''),
    branch: String(match.branch || profile.branch),
    role: String(match.role || profile.role),
    is_active: true,
    created_at: (match.created_at as string) || null,
    points: match.points as number | null,
    max_points: match.max_points as number | null,
  };
}

export async function loadStaffCycleIncentiveSafe(args: {
  staffId: string;
  staffName: string;
  branch: string;
}): Promise<StaffCycleIncentive | null> {
  const result = await runStaffDetailSection('incentive', () =>
    getStaffCycleIncentive({
      staffId: args.staffId,
      staffName: args.staffName,
      branch: args.branch,
    })
  );
  if (result.ok) return result.data;
  return null;
}

export function dayAfter(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function loadStaffDetailSections(args: {
  staffId: string;
  staffName: string;
  cycle: PharmacyCycle;
}) {
  const cycleStart = args.cycle.start.toISOString().slice(0, 10);
  const cycleEndExclusive = dayAfter(args.cycle.end);

  const sections = await Promise.allSettled([
    runStaffDetailSection('sales', async () => {
      // Use the shared staff sales service for proper identity resolution
      const salesSummary = await getStaffSalesSummaryForPeriod({
        staffId: args.staffId,
        staffName: args.staffName,
        branch: '', // Will be determined from staff record if needed
        cycleStart,
        cycleEnd: args.cycle.end.toISOString().slice(0, 10),
        includeAliases: true,
      });

      // Convert StaffSalesSummary to the format expected by StaffDetail
      return {
        salesSummary,
        sourceUsed: salesSummary.sourceUsed,
        aliasesUsed: salesSummary.aliasesUsed,
        rawSellerNamesMatched: salesSummary.rawSellerNamesMatched,
        dataHealthWarnings: salesSummary.dataHealthWarnings,
      };
    }),
    runStaffDetailSection('medicines', async () => {
      const [byId, byName] = await Promise.all([
        supabase.from('incentive_medicines').select('*').eq('doctor_id', args.staffId).limit(200),
        supabase
          .from('incentive_medicines')
          .select('*')
          .eq('responsible_doctor', args.staffName)
          .limit(200),
      ]);
      const map = new Map<string, Record<string, unknown>>();
      for (const row of [...(byId.data || []), ...(byName.data || [])]) {
        const id = String((row as Record<string, unknown>).id || '');
        if (id) map.set(id, row as Record<string, unknown>);
      }
      return [...map.values()];
    }),
    runStaffDetailSection('stagnant_list', async () => {
      const [byId, byName] = await Promise.all([
        supabase
          .from('stagnant_medicines')
          .select('*')
          .eq('responsible_doctor_id', args.staffId)
          .limit(200),
        supabase
          .from('stagnant_medicines')
          .select('*')
          .eq('responsible_doctor_name', args.staffName)
          .limit(200),
      ]);
      const map = new Map<string, Record<string, unknown>>();
      for (const row of [...(byId.data || []), ...(byName.data || [])]) {
        const id = String((row as Record<string, unknown>).id || '');
        if (id) map.set(id, row as Record<string, unknown>);
      }
      const dispenses = await supabase
        .from('stagnant_medicine_dispenses')
        .select('*')
        .eq('staff_id', args.staffId)
        .gte('created_at', cycleStart)
        .lt('created_at', cycleEndExclusive)
        .limit(300);
      const listSales = await supabase
        .from('incentive_medicine_sales')
        .select('*')
        .eq('staff_id', args.staffId)
        .gte('created_at', cycleStart)
        .lt('created_at', cycleEndExclusive)
        .limit(300);
      return {
        stagnants: [...map.values()],
        stagnantDispenses: (dispenses.data || []) as Record<string, unknown>[],
        listSales: (listSales.data || []) as Record<string, unknown>[],
      };
    }),
    runStaffDetailSection('schedule', async () => {
      const scheduleRes = await supabase
        .from('shift_schedules')
        .select('*')
        .eq('staff_id', args.staffId)
        .limit(80);
      const timeOffRes = await supabase
        .from('shift_exceptions')
        .select('*')
        .eq('staff_id', args.staffId)
        .order('date', { ascending: false })
        .limit(80);
      return {
        schedule: (scheduleRes.data || []) as Record<string, unknown>[],
        timeOff: (timeOffRes.data || []) as Record<string, unknown>[],
      };
    }),
    runStaffDetailSection('followups', async () => {
      const { data, error } = await supabase
        .from('daily_followups')
        .select('*')
        .eq('staff_id', args.staffId)
        .gte('created_at', cycleStart)
        .lt('created_at', cycleEndExclusive)
        .limit(300);
      if (error) throw error;
      return (data || []) as Record<string, unknown>[];
    }),
    runStaffDetailSection('reviews', async () => {
      const byId = await supabase
        .from('conversation_sales_reviews')
        .select('*')
        .or(`staff_id.eq.${args.staffId},doctor_id.eq.${args.staffId}`)
        .order('created_at', { ascending: false })
        .limit(150);
      if (!byId.error) return (byId.data || []) as Record<string, unknown>[];
      const fallback = await supabase
        .from('conversation_sales_reviews')
        .select('*')
        .eq('staff_name', args.staffName)
        .order('created_at', { ascending: false })
        .limit(150);
      if (fallback.error) throw fallback.error;
      return (fallback.data || []) as Record<string, unknown>[];
    }),
  ]);

  return {
    sales: sections[0],
    medicines: sections[1],
    stagnantList: sections[2],
    schedule: sections[3],
    followups: sections[4],
    reviews: sections[5],
  };
}

export function sectionUnavailableMessage(status?: StaffDetailSectionStatus) {
  if (status === 'timeout') return 'غير متاح حاليًا (انتهت مهلة التحميل)';
  return 'غير متاح حاليًا';
}
