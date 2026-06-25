import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';

export type CustomerBranchOverride = {
  id: string;
  customer_code: string | null;
  customer_id: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  old_branch: string | null;
  new_branch: string;
  suggested_branch: string | null;
  reason: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  active: boolean;
};

export type CustomerBranchOverrideInput = {
  customer_code?: string | null;
  customer_id?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  old_branch?: string | null;
  new_branch: string;
  suggested_branch?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
};

function clean(value: unknown) {
  return String(value || '').trim();
}

export function resolveSuggestedBranchFromInvoiceMetrics(metrics?: Record<string, unknown> | null) {
  const last = normalizeBranchName(metrics?.branch_last_purchase || '');
  const frequent = normalizeBranchName(metrics?.branch_most_frequent || '');
  const highest = normalizeBranchName(metrics?.branch_highest_value || '');
  return last || frequent || highest || null;
}

export async function saveCustomerBranchOverride(input: CustomerBranchOverrideInput) {
  if (!isSupabaseConfigured) throw new Error('Supabase غير متصل');
  const identifiers = {
    customer_code: clean(input.customer_code) || null,
    customer_id: clean(input.customer_id) || null,
    customer_phone: clean(input.customer_phone) || null,
  };

  let deactivate = supabase.from('customer_branch_overrides').update({ active: false }).eq('active', true);
  if (identifiers.customer_code) deactivate = deactivate.eq('customer_code', identifiers.customer_code);
  else if (identifiers.customer_phone) deactivate = deactivate.eq('customer_phone', identifiers.customer_phone);
  else if (identifiers.customer_id) deactivate = deactivate.eq('customer_id', identifiers.customer_id);
  await deactivate;

  const { data, error } = await supabase
    .from('customer_branch_overrides')
    .insert({
      ...identifiers,
      customer_name: clean(input.customer_name) || null,
      old_branch: normalizeBranchName(input.old_branch || '') || null,
      new_branch: normalizeBranchName(input.new_branch) || input.new_branch,
      suggested_branch: normalizeBranchName(input.suggested_branch || '') || null,
      reason: clean(input.reason) || null,
      created_by: clean(input.created_by) || null,
      created_by_name: clean(input.created_by_name) || null,
      active: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CustomerBranchOverride;
}

export async function fetchActiveCustomerBranchOverrides(keys: Array<{
  customer_code?: string | null;
  customer_phone?: string | null;
  customer_id?: string | null;
}>) {
  if (!isSupabaseConfigured || !keys.length) return new Map<string, CustomerBranchOverride>();
  const codes = [...new Set(keys.map((key) => clean(key.customer_code)).filter(Boolean))];
  const phones = [...new Set(keys.map((key) => clean(key.customer_phone)).filter(Boolean))];
  const ids = [...new Set(keys.map((key) => clean(key.customer_id)).filter(Boolean))];
  const parts = [
    ...codes.map((value) => `customer_code.eq.${value}`),
    ...phones.map((value) => `customer_phone.eq.${value}`),
    ...ids.map((value) => `customer_id.eq.${value}`),
  ];
  if (!parts.length) return new Map<string, CustomerBranchOverride>();
  const { data, error } = await supabase
    .from('customer_branch_overrides')
    .select('*')
    .eq('active', true)
    .or(parts.join(','))
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) {
    console.warn('[customerBranchOverrides] skipped', error);
    return new Map<string, CustomerBranchOverride>();
  }
  const map = new Map<string, CustomerBranchOverride>();
  for (const row of (data || []) as CustomerBranchOverride[]) {
    [row.customer_code, row.customer_phone, row.customer_id].map(clean).filter(Boolean).forEach((key) => {
      if (!map.has(key)) map.set(key, row);
    });
  }
  return map;
}

export function overrideKey(input: { customer_code?: string | null; customer_phone?: string | null; customer_id?: string | null }) {
  return clean(input.customer_code) || clean(input.customer_phone) || clean(input.customer_id);
}
