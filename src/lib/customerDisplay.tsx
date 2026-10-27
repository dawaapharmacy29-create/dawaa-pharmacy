import { useEffect, useMemo, useState } from 'react';
import { normalizeBranchName } from '@/lib/branch';
import { translateAndDedupeCustomerFlags } from '@/lib/customerFlagLabels';
import { supabase } from '@/lib/supabase';

type AnyRow = Record<string, unknown>;

type CustomerDisplayProfile = {
  customer_flags?: unknown;
  flags?: unknown;
  tags?: unknown;
  customer_tags?: unknown;
  customer_notes?: unknown;
  notes?: unknown;
  service_notes?: unknown;
  team_notes?: unknown;
  handling_notes?: unknown;
  whatsapp_notes?: unknown;
};

const profileCache = new Map<string, CustomerDisplayProfile | null>();
const pendingProfiles = new Map<string, Promise<CustomerDisplayProfile | null>>();

function isRecord(row: unknown): row is AnyRow {
  return Boolean(row && typeof row === 'object');
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function readNestedBranch(row: AnyRow) {
  const customer = row.customer;
  return isRecord(customer) ? customer.branch : undefined;
}

function labelFromValue(value: unknown): string[] {
  if (value == null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(labelFromValue);
  if (typeof value === 'object') {
    return Object.entries(value as AnyRow)
      .filter(([, entryValue]) => entryValue !== false && entryValue != null && entryValue !== '')
      .flatMap(([key, entryValue]) => {
        if (key === 'important_tags' && Array.isArray(entryValue)) return entryValue.flatMap(labelFromValue);
        if (typeof entryValue === 'string') return entryValue;
        if (entryValue === true) return key;
        if (typeof entryValue === 'object') {
          const record = entryValue as AnyRow;
          return text(record.key ?? record.label ?? record.name ?? record.title ?? key);
        }
        return key;
      });
  }
  return text(value)
    .split(/[,،|;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBranchCandidate(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const normalized = normalizeBranchName(raw);
  if (normalized) return normalized;
  const lower = raw.toLowerCase();
  if (/shamy|الشامي|شامي/.test(lower)) return 'فرع الشامي';
  if (/shokry|شكري|شكرى/.test(lower)) return 'فرع شكري';
  if (/store|warehouse|مخزن|المخزن/.test(lower)) return 'المخزن';
  return '';
}

function customerIdentity(row: AnyRow) {
  const customerId = text(row.customer_id ?? row.id);
  const code = getCustomerCodeSafe(row);
  const phone = text(row.customer_phone ?? row.phone);
  return customerId || code || phone;
}

function hasDisplayData(row: AnyRow) {
  return Boolean(
    labelFromValue(row.customer_flags).length ||
      labelFromValue(row.flags).length ||
      labelFromValue(row.tags).length ||
      labelFromValue(row.customer_tags).length ||
      getCustomerHandlingSummary(row)
  );
}

const PROFILE_COLUMNS = 'customer_flags,customer_notes,notes,service_notes,team_notes,handling_notes,whatsapp_notes';
const PROFILE_BATCH_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LookupColumn = 'id' | 'customer_code';
type QueuedLookup = {
  column: LookupColumn;
  value: string;
  resolve: (profile: CustomerDisplayProfile | null) => void;
  reject: (error: Error) => void;
};

let queuedLookups: QueuedLookup[] = [];
let flushScheduled = false;

// Unregistered customers carry a composite display key ("name:…|branch:…"), never a
// customers.customer_code; looking it up can only return nothing.
function isSyntheticCustomerKey(code: string) {
  return code.startsWith('name:') || code.includes('|branch:');
}

// Rows rendered together (one table page) share one bounded `in` query per column
// instead of one request per row.
function queueProfileLookup(column: LookupColumn, value: string) {
  return new Promise<CustomerDisplayProfile | null>((resolve, reject) => {
    queuedLookups.push({ column, value, resolve, reject });
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flushProfileLookups, 0);
    }
  });
}

function flushProfileLookups() {
  const lookups = queuedLookups;
  queuedLookups = [];
  flushScheduled = false;
  for (const column of ['id', 'customer_code'] as const) {
    const forColumn = lookups.filter((lookup) => lookup.column === column);
    const values = [...new Set(forColumn.map((lookup) => lookup.value))];
    for (let start = 0; start < values.length; start += PROFILE_BATCH_SIZE) {
      const chunk = values.slice(start, start + PROFILE_BATCH_SIZE);
      const waiting = forColumn.filter((lookup) => chunk.includes(lookup.value));
      void fetchProfileChunk(column, chunk).then(
        (byValue) => waiting.forEach((lookup) => lookup.resolve(byValue.get(lookup.value) ?? null)),
        (error: Error) => waiting.forEach((lookup) => lookup.reject(error))
      );
    }
  }
}

async function fetchProfileChunk(column: LookupColumn, values: string[]) {
  const { data, error } = await supabase
    .from('customers')
    .select(`${column},${PROFILE_COLUMNS}`)
    .in(column, values)
    .limit(values.length * 10);
  if (error) throw new Error(error.message);
  const byValue = new Map<string, CustomerDisplayProfile>();
  for (const row of (data ?? []) as AnyRow[]) {
    const value = text(row[column]);
    // Same as the former per-row `.limit(1)`: the first matching customer wins.
    if (value && !byValue.has(value)) byValue.set(value, row as CustomerDisplayProfile);
  }
  return byValue;
}

async function loadProfileByPhone(phone: string) {
  const { data, error } = await supabase
    .from('customers')
    .select(PROFILE_COLUMNS)
    .or(`phone.eq.${phone},mobile.eq.${phone},whatsapp.eq.${phone}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data || null) as CustomerDisplayProfile | null;
}

export async function loadCustomerDisplayProfile(row: AnyRow): Promise<CustomerDisplayProfile | null> {
  const key = customerIdentity(row);
  if (!key || hasDisplayData(row)) return null;
  if (profileCache.has(key)) return profileCache.get(key) ?? null;
  const pending = pendingProfiles.get(key);
  if (pending) return pending;

  const request = (async () => {
    const customerId = text(row.customer_id);
    const code = getCustomerCodeSafe(row);
    const phone = text(row.customer_phone ?? row.phone);
    let profile: CustomerDisplayProfile | null;
    try {
      if (customerId) profile = UUID_PATTERN.test(customerId) ? await queueProfileLookup('id', customerId) : null;
      else if (code) profile = isSyntheticCustomerKey(code) ? null : await queueProfileLookup('customer_code', code);
      else if (phone) profile = await loadProfileByPhone(phone);
      else return null;
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[customer-display] profile enrichment failed', (error as Error).message);
      profile = null;
    }
    profileCache.set(key, profile);
    return profile;
  })().finally(() => pendingProfiles.delete(key));

  pendingProfiles.set(key, request);
  return request;
}

export function getCustomerCodeSafe(row: unknown): string {
  if (!isRecord(row)) return '';
  return text(row.customer_code ?? row.code ?? row.raw_customer_code ?? row.customerCode ?? row.final_customer_key);
}

export function resolveCustomerBranch(row: unknown): {
  branch: string;
  source: string;
  needsReview: boolean;
} {
  if (!isRecord(row)) return { branch: 'غير محدد', source: 'missing_row', needsReview: true };

  const candidates: Array<[string, unknown]> = [
    ['branch', readNestedBranch(row) ?? row.branch],
    ['current_branch', row.current_branch],
    ['last_invoice_branch', row.last_invoice_branch ?? row.branch_last_purchase],
    ['invoice_branch', row.invoice_branch],
    ['followup_branch', row.followup_branch],
    ['raw_branch', row.raw_branch],
    ['suggested_branch', row.suggested_branch],
  ];

  for (const [source, value] of candidates) {
    const branch = normalizeBranchCandidate(value);
    if (branch) return { branch, source, needsReview: false };
  }

  const searchText = [
    row.customer_name,
    row.name,
    row.notes,
    row.customer_notes,
    row.service_notes,
    row.team_notes,
    row.followup_notes,
  ]
    .map(text)
    .join(' ')
    .toLowerCase();
  const inferred = normalizeBranchCandidate(searchText);
  if (inferred) return { branch: inferred, source: 'text_inference', needsReview: true };

  return { branch: 'غير محدد', source: 'missing', needsReview: true };
}

export function getCustomerHandlingSummary(row: unknown): string {
  if (!isRecord(row)) return '';
  return text(
    row.handling_notes ??
      row.service_notes ??
      row.customer_notes ??
      row.whatsapp_notes ??
      row.team_notes ??
      row.notes
  );
}

export function getCustomerFlagChips(row: unknown): string[] {
  if (!isRecord(row)) return [];
  const rawLabels = [
    ...labelFromValue(row.customer_flags),
    ...labelFromValue(row.flags),
    ...labelFromValue(row.tags),
    ...labelFromValue(row.customer_tags),
    ...labelFromValue(row.risk_label),
    ...labelFromValue(row.priority_label ?? row.priority),
  ];

  const code = getCustomerCodeSafe(row);
  const branch = resolveCustomerBranch(row);
  if (!code) rawLabels.push('بدون كود');
  if (branch.needsReview) rawLabels.push('فرع غير مؤكد');
  if (text(row.source_type).includes('unregistered') || text(row.customer_status).includes('غير مسجل')) {
    rawLabels.push('عميل غير مسجل');
  }

  return translateAndDedupeCustomerFlags(rawLabels, 8);
}

export function CustomerFlagChips({ row, className = '' }: { row: unknown; className?: string }) {
  const [profile, setProfile] = useState<CustomerDisplayProfile | null>(null);

  useEffect(() => {
    if (!isRecord(row)) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void loadCustomerDisplayProfile(row).then((loaded) => {
      if (!cancelled) setProfile(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [row]);

  const merged = useMemo(() => {
    if (!isRecord(row) || !profile) return row;
    return { ...profile, ...row, customer_flags: row.customer_flags ?? profile.customer_flags };
  }, [profile, row]);

  const chips = getCustomerFlagChips(merged);
  const handlingSummary = getCustomerHandlingSummary(merged);
  if (!chips.length && !handlingSummary) return null;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-teal-300/30 bg-teal-500/10 px-2.5 py-1 text-[11px] font-black text-teal-100"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {handlingSummary ? (
        <div
          className="max-w-xl rounded-xl border border-amber-300/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold leading-5 text-amber-100"
          title={handlingSummary}
        >
          <span className="font-black">تعليمات التعامل: </span>
          {handlingSummary.length > 140 ? `${handlingSummary.slice(0, 140)}…` : handlingSummary}
        </div>
      ) : null}
    </div>
  );
}
