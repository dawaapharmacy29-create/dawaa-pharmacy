import { supabase } from './supabase';
import { staffIdentityKey } from './staff/staffIdentityKey';
import { readUnlinkedInvoiceSellerNames } from './readModels/unlinkedSellerNamesReadModel';
import { getCurrentUserProfile } from '@/hooks/useAuth';
import { hasPermission } from './core/permissionSystem';
import { readStaffDirectory } from './readModels/staffDirectoryReadModel';
import { resolveStaffDirectoryName } from './staff/staffIdentityResolver';

function canManageStaffIdentity(): boolean {
  try { return hasPermission(getCurrentUserProfile(), 'manage_staff_accounts'); }
  catch { return false; }
}

export interface StaffIdentityAlias {
  id: string;
  staff_id: string;
  alias_name: string;
  normalized_alias: string;
  source: string;
  confidence: number;
  active: boolean;
  created_at: string;
  created_by?: string;
}

export interface StaffIdentityMatch {
  staff_id: string;
  staff_name: string;
  confidence: number;
  source: string;
}

/** One complete snapshot for an import batch; no per-seller directory requests. */
export async function resolveStaffNamesToStaffIds(rawNames: string[]): Promise<Map<string, string | null>> {
  const names = [...new Set(rawNames.filter(name => name.trim()))];
  if (!names.length) return new Map();
  const directory = await readStaffDirectory({ requireComplete: true });
  return new Map(names.map(name => {
    const decision = resolveStaffDirectoryName(name, directory);
    return [name, decision.status === 'resolved' ? decision.staff?.id || null : null];
  }));
}

/**
 * حل اسم الموظف الخام إلى staff_id باستخدام خريطة الهويات
 */
export async function resolveStaffNameToStaffId(
  rawName: string,
  options?: { createAutoAlias?: boolean; source?: string }
): Promise<string | null> {
  if (!rawName) return null;

  const staffId = (await resolveStaffNamesToStaffIds([rawName])).get(rawName) || null;
  if (!staffId) return null;
  if (options?.createAutoAlias) {
    await createStaffAlias(staffId, rawName, options.source || 'auto-resolve', 0.9, 'system');
  }
  return staffId;
}

/** إنشاء alias جديد للموظف */
export async function createStaffAlias(
  staffId: string,
  aliasName: string,
  source: string,
  confidence: number,
  createdBy: string
): Promise<StaffIdentityAlias | null> {
  if (!canManageStaffIdentity()) return null;
  const normalized = staffIdentityKey(aliasName);
  if (!normalized || !staffId || !aliasName.trim()) return null;

  // Advisory early validation; database key ownership arbitrates concurrent writes.
  const [targetResult, aliasesResult] = await Promise.all([
    supabase.from('staff').select('id,active,is_active').eq('id', staffId).maybeSingle(),
    supabase.from('staff_identity_aliases')
      .select('staff_id')
      .eq('normalized_alias', normalized)
      .eq('active', true)
      .limit(1000),
  ]);
  const target = targetResult.data;
  if (targetResult.error || !target || !target.active || !target.is_active ||
      aliasesResult.error || (aliasesResult.data || []).length > 0) {
    return null;
  }

  const { data, error } = await supabase
    .from('staff_identity_aliases')
    .insert({
      staff_id: staffId,
      alias_name: aliasName,
      normalized_alias: normalized,
      source,
      confidence,
      active: true,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating staff alias:', error);
    return null;
  }

  return data as StaffIdentityAlias;
}

/** اقتراح ربط تلقائي للأسماء غير المرتبطة */
export async function suggestStaffAliases(
  rawNames: string[]
): Promise<Map<string, StaffIdentityMatch[]>> {
  const suggestions = new Map<string, StaffIdentityMatch[]>();

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('id, name')
    .eq('active', true);

  if (staffError || !staff) {
    console.error('Error fetching staff:', staffError);
    return suggestions;
  }

  for (const rawName of rawNames) {
    const normalized = staffIdentityKey(rawName);
    if (!normalized) continue;

    const matches: StaffIdentityMatch[] = [];

    for (const s of staff) {
      const staffName = s.name || '';
      const staffNormalized = staffIdentityKey(staffName);

      if (staffNormalized === normalized) {
        matches.push({
          staff_id: s.id,
          staff_name: staffName,
          confidence: 1.0,
          source: 'exact-match',
        });
      } else if (staffNormalized.includes(normalized) || normalized.includes(staffNormalized)) {
        matches.push({
          staff_id: s.id,
          staff_name: staffName,
          confidence: 0.7,
          source: 'partial-match',
        });
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => b.confidence - a.confidence);
      suggestions.set(rawName, matches);
    }
  }

  return suggestions;
}

/** جلب جميع الأسماء غير المرتبطة من الفواتير والمراجعات */
export async function getUnlinkedSellerNames(): Promise<string[]> {
  const sellerNames = new Set<string>();

  try {
    const invoiceNames = await readUnlinkedInvoiceSellerNames();
    invoiceNames.forEach((name) => sellerNames.add(name));
  } catch (invoiceError) {
    console.error('Error fetching invoice seller identities:', invoiceError);
  }

  const { data: reviews, error: reviewError } = await supabase
    .from('conversation_sales_reviews')
    .select('staff_name')
    .not('staff_name', 'is', null)
    .is('staff_id', null);

  if (!reviewError && reviews) {
    for (const review of reviews) {
      const staffName = review.staff_name;
      if (staffName) sellerNames.add(staffName);
    }
  }

  return Array.from(sellerNames);
}

/** تأكيد ربط الاسم بالموظف */
export async function confirmStaffAlias(
  staffId: string,
  aliasName: string,
  createdBy: string
): Promise<boolean> {
  if (!canManageStaffIdentity()) return false;
  const normalized = staffIdentityKey(aliasName);

  const { data: existing, error: existingError } = await supabase
    .from('staff_identity_aliases')
    .select('*')
    .eq('normalized_alias', normalized)
    .eq('active', true);

  if (existingError) {
    console.error('Error checking existing alias:', existingError);
    return false;
  }

  if (existing && existing.length > 0) {
    // Reassignment must be an audited, atomic server-side operation.
    // Never deactivate valid aliases before the replacement is committed.
    return existing.every((alias) => alias.staff_id === staffId);
  }

  const result = await createStaffAlias(staffId, aliasName, 'manual-confirm', 1.0, createdBy);
  return result !== null;
}

/** جلب جميع aliases لموظف معين */
export async function getStaffAliases(staffId: string): Promise<StaffIdentityAlias[]> {
  const { data, error } = await supabase
    .from('staff_identity_aliases')
    .select('*')
    .eq('staff_id', staffId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching staff aliases:', error);
    return [];
  }

  return data as StaffIdentityAlias[];
}
