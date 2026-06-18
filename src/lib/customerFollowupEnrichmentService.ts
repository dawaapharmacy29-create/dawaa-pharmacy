import { ALL_FILTER, normalizeCustomerMetric, type CustomerMetric } from '@/lib/api/customers';
import { normalizeBranchName } from '@/lib/branch';
import { getBestCustomerPhone, isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type Row = Record<string, unknown>;

export type EnrichableFollowup = {
  id: string;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  name?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
  branch?: string | null;
  segment?: string | null;
  classification?: string | null;
  customer_status?: string | null;
  total_spent?: number | null;
  last_purchase_date?: string | null;
  purchase_count_current_month?: number | null;
  average_monthly_purchase_count?: number | null;
  purchase_frequency_status?: string | null;
  customer_flags?: Record<string, boolean> | null;
  customer_notes?: string | null;
  service_notes?: string | null;
  team_notes?: string | null;
  handling_notes?: string | null;
  whatsapp_notes?: string | null;
  address?: string | null;
  phone_alt?: string | null;
  whatsapp_phone?: string | null;
  customer_metrics?: CustomerMetric | null;
};

export type EnrichedFollowup<T extends EnrichableFollowup> = T & {
  customer_metrics?: CustomerMetric | null;
  display_phone?: string | null;
  display_name?: string | null;
  display_code?: string | null;
  data_health?: {
    hasMetrics: boolean;
    hasCustomerProfile: boolean;
    hasValidPhone: boolean;
    source: string;
  };
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function codeFrom(value: unknown) {
  return text(value)
    .replace(/^code:/i, '')
    .trim();
}

function normalizeDigits(value: unknown) {
  return text(value).replace(/[^\d]/g, '');
}

function rowCode(row: EnrichableFollowup) {
  return codeFrom(
    row.customer_code ||
      (text(row.customer_phone).startsWith('code:') ? row.customer_phone : '') ||
      (text(row.phone).startsWith('code:') ? row.phone : '')
  );
}

function validPhoneValues(rows: EnrichableFollowup[]) {
  const values = new Set<string>();
  for (const row of rows) {
    for (const value of [row.customer_phone, row.phone]) {
      if (isValidEgyptPhone(value, rowCode(row))) values.add(text(value));
    }
  }
  return [...values].slice(0, 120);
}

function mapByKeys<T>(rows: T[], keys: (row: T) => Array<string | null | undefined>) {
  const map = new Map<string, T>();
  for (const row of rows) {
    for (const key of keys(row)) {
      const value = text(key);
      if (value && !map.has(value)) map.set(value, row);
    }
  }
  return map;
}

function profileName(profile: Row | null | undefined) {
  return text(profile?.customer_name || profile?.name) || null;
}

function applyProfile<T extends EnrichableFollowup>(
  row: T,
  profile: Row | null,
  metric: CustomerMetric | null
) {
  const displayPhone = getBestCustomerPhone(row, metric, profile);
  const displayName =
    row.customer_name || row.name || metric?.customer_name || profileName(profile);
  const customerCode =
    rowCode(row) || metric?.customer_code || text(profile?.customer_code) || null;
  return {
    ...row,
    customer_metrics: metric,
    customer_code: customerCode || row.customer_code || null,
    customer_name: displayName || null,
    name: row.name || displayName || null,
    customer_phone: displayPhone || metric?.customer_phone || row.customer_phone || null,
    phone: displayPhone || null,
    branch: normalizeBranchName(row.branch || metric?.branch || profile?.branch),
    segment: row.segment || row.classification || metric?.segment || null,
    classification: row.classification || row.segment || metric?.segment || null,
    customer_status: row.customer_status || metric?.customer_status || null,
    total_spent: row.total_spent ?? metric?.total_spent ?? null,
    last_purchase_date: row.last_purchase_date || metric?.last_purchase || null,
    customer_flags:
      (profile?.customer_flags as Record<string, boolean> | null) || row.customer_flags || null,
    customer_notes: (profile?.customer_notes as string | null) || row.customer_notes || null,
    service_notes: (profile?.service_notes as string | null) || row.service_notes || null,
    team_notes: (profile?.team_notes as string | null) || row.team_notes || null,
    handling_notes: (profile?.handling_notes as string | null) || row.handling_notes || null,
    whatsapp_notes: (profile?.whatsapp_notes as string | null) || row.whatsapp_notes || null,
    address: (profile?.address as string | null) || row.address || null,
    phone_alt: (profile?.phone_alt as string | null) || row.phone_alt || null,
    whatsapp_phone: (profile?.whatsapp_phone as string | null) || row.whatsapp_phone || null,
    display_phone: displayPhone,
    display_name: displayName || null,
    display_code: customerCode,
    data_health: {
      hasMetrics: Boolean(metric),
      hasCustomerProfile: Boolean(profile),
      hasValidPhone: Boolean(displayPhone && isValidEgyptPhone(displayPhone, customerCode)),
      source: profile
        ? 'customer_metrics_summary + customers'
        : metric
          ? 'customer_metrics_summary'
          : 'daily_followups',
    },
  } as EnrichedFollowup<T>;
}

export async function enrichFollowupsWithCustomerData<T extends EnrichableFollowup>(
  rows: T[]
): Promise<Array<EnrichedFollowup<T>>> {
  if (!rows.length || !isSupabaseConfigured)
    return rows.map((row) => applyProfile(row, null, row.customer_metrics || null));

  const codes = [...new Set(rows.map(rowCode).filter(Boolean))].slice(0, 120);
  const phones = validPhoneValues(rows);
  if (!codes.length && !phones.length)
    return rows.map((row) => applyProfile(row, null, row.customer_metrics || null));

  const summaryClauses = [
    ...codes.map((code) => `customer_code.eq.${code}`),
    ...phones.map((phone) => `customer_phone.eq.${phone}`),
  ];
  const profileClauses = [
    ...codes.map((code) => `customer_code.eq.${code}`),
    ...phones.flatMap((phone) => [
      `phone.eq.${phone}`,
      `phone_alt.eq.${phone}`,
      `whatsapp_phone.eq.${phone}`,
    ]),
  ];

  const [summaryResult, profileResult] = await Promise.all([
    summaryClauses.length
      ? supabase
          .from('customer_metrics_summary')
          .select(
            'final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status'
          )
          .or(summaryClauses.join(','))
          .limit(300)
      : Promise.resolve({ data: [], error: null } as any),
    profileClauses.length
      ? supabase
          .from('customers')
          .select(
            'id,customer_code,name,phone,whatsapp_phone,phone_alt,address,notes,customer_notes,whatsapp_notes,service_notes,team_notes,handling_notes,customer_flags,branch'
          )
          .or(profileClauses.join(','))
          .limit(300)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (summaryResult.error && import.meta.env.DEV)
    console.warn('[customerFollowupEnrichment.summary]', summaryResult.error);
  if (profileResult.error && import.meta.env.DEV)
    console.warn('[customerFollowupEnrichment.customers]', profileResult.error);

  const metrics = ((summaryResult.data ?? []) as Row[]).map(normalizeCustomerMetric);
  const profiles = (profileResult.data ?? []) as Row[];
  const metricsByKey = mapByKeys(metrics, (metric) => [
    metric.customer_code,
    metric.customer_phone,
    metric.final_customer_key,
    metric.customer_id,
  ]);
  const profilesByKey = mapByKeys(profiles, (profile) => [
    profile.customer_code as string,
    profile.phone as string,
    profile.phone_alt as string,
    profile.whatsapp_phone as string,
  ]);

  return rows.map((row) => {
    const code = rowCode(row);
    const phoneCandidates = [row.customer_phone, row.phone]
      .filter((phone) => isValidEgyptPhone(phone, code))
      .map(text);
    const metric =
      (code && metricsByKey.get(code)) ||
      phoneCandidates.map((phone) => metricsByKey.get(phone)).find(Boolean) ||
      row.customer_metrics ||
      null;
    const profile =
      (code && profilesByKey.get(code)) ||
      phoneCandidates.map((phone) => profilesByKey.get(phone)).find(Boolean) ||
      null;
    return applyProfile(row, profile || null, metric || null);
  });
}

export function clearCustomerFollowupEnrichmentCache() {
  // Enrichment currently queries visible rows directly; this hook keeps import invalidation explicit.
}

export function buildCustomerSearchPattern(search: string) {
  const trimmed = search.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[%,()]/g, '').replace(/\*/g, '%');
  return safe.includes('%') ? safe : `%${safe}%`;
}

export function buildPhoneSearchVariants(search: string) {
  const digits = normalizeDigits(search);
  if (digits.length < 7) return [];
  const values = new Set<string>([digits]);
  if (digits.startsWith('01')) values.add(`20${digits}`);
  if (digits.startsWith('201')) values.add(digits.slice(1));
  if (digits.startsWith('00201')) values.add(digits.slice(2));
  return [...values];
}

export function isAllFilter(value?: string | null) {
  return !value || value === ALL_FILTER || value.includes('كل ');
}
