import { supabase } from './supabase';
import { normalizeStaffName } from './staffDuplicateAudit';
import { readUnlinkedInvoiceSellerNames } from './readModels/unlinkedSellerNamesReadModel';

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

/**
 * حل اسم الموظف الخام إلى staff_id باستخدام خريطة الهويات
 */
export async function resolveStaffNameToStaffId(
  rawName: string,
  options?: { createAutoAlias?: boolean; source?: string }
): Promise<string | null> {
  if (!rawName) return null;

  const normalized = normalizeStaffName(rawName);
  if (!normalized) return null;

  const { data: aliases, error: aliasError } = await supabase
    .from('staff_identity_aliases')
    .select('*')
    .eq('normalized_alias', normalized)
    .eq('active', true)
    .order('confidence', { ascending: false })
    .limit(1);

  if (aliasError) {
    console.error('Error resolving staff name:', aliasError);
    return null;
  }

  if (aliases && aliases.length > 0) {
    return aliases[0].staff_id;
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('id, name')
    .eq('active', true)
    .limit(100);

  if (staffError) {
    console.error('Error searching staff:', staffError);
    return null;
  }

  if (staff && staff.length > 0) {
    for (const s of staff) {
      const staffName = s.name || '';
      const staffNormalized = normalizeStaffName(staffName);
      if (staffNormalized === normalized) {
        if (options?.createAutoAlias) {
          await createStaffAlias(s.id, rawName, options.source || 'auto-resolve', 0.9, 'system');
        }
        return s.id;
      }
    }
  }

  return null;
}

/** إنشاء alias جديد للموظف */
export async function createStaffAlias(
  staffId: string,
  aliasName: string,
  source: string,
  confidence: number,
  createdBy: string
): Promise<StaffIdentityAlias | null> {
  const normalized = normalizeStaffName(aliasName);

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
    const normalized = normalizeStaffName(rawName);
    if (!normalized) continue;

    const matches: StaffIdentityMatch[] = [];

    for (const s of staff) {
      const staffName = s.name || '';
      const staffNormalized = normalizeStaffName(staffName);

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
  const normalized = normalizeStaffName(aliasName);

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
    for (const alias of existing) {
      await supabase.from('staff_identity_aliases').update({ active: false }).eq('id', alias.id);
    }
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
