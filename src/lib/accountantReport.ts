import { supabase } from '@/lib/supabase';

// «التقارير المجمعة» from the Dawaa Bills accountant book (migration 20261101160000). Top management only.

export interface AccountantVault {
  code: string;
  name: string;
  opening_balance: number;
  opening_date: string | null;
  incoming: number;
  outgoing: number;
  balance: number;
  last_date: string | null;
  period_opening: number | null;
  period_incoming: number;
  period_outgoing: number;
  source_details: AccountantSourceDetails;
}

export interface AccountantSourceDetails {
  original_description?: string | null;
  description_edited_by?: string | null;
  description_edited_at?: string | null;
  source_sheet?: string | null;
  source_row?: number | null;
  source_original_date?: string | null;
  source_date_adjusted?: boolean;
  source_excel_balance?: number | null;
  source_closing_balance?: number | null;
  source_closing_date?: string | null;
  source_filename?: string | null;
  import_batch?: string | null;
  source_classification_override?: string | null;
  alias_applied?: boolean;
}
export interface AccountantHistory {
  month: string;
  vault_code: string;
  opening: number | null;
  incoming: number;
  outgoing: number;
  count: number;
}
export interface AccountantTransaction {
  id: string;
  vault_code: string;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  classification: string;
  category_name: string | null;
  description: string | null;
  created_by_name: string | null;
  running_balance: number;
  is_offset_pair: boolean;
  source_details: AccountantSourceDetails;
}

export interface AccountantReport {
  synced_at: string | null;
  last_error: string | null;
  month: string;
  months: string[];
  today: string;
  history: AccountantHistory[];
  vaults: AccountantVault[];
  transactions: AccountantTransaction[];
}

export interface CategoryLine {
  classification: string;
  incoming: number;
  outgoing: number;
  diff: number;
}

/** Incoming, outgoing and their difference per classification (one vault, or all when null). */
export function categoryBreakdown(transactions: AccountantTransaction[], vault: string | null) {
  const lines = new Map<string, CategoryLine>();
  for (const t of transactions) {
    if (vault && t.vault_code !== vault) continue;
    const line = lines.get(t.classification) ?? {
      classification: t.classification,
      incoming: 0,
      outgoing: 0,
      diff: 0,
    };
    const amount = Number(t.amount) || 0;
    if (t.direction === 'in') line.incoming += amount;
    else line.outgoing += amount;
    line.diff = line.incoming - line.outgoing;
    lines.set(t.classification, line);
  }
  const rows = [...lines.values()].sort(
    (a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing)
  );
  const total = rows.reduce(
    (acc, r) => ({
      ...acc,
      incoming: acc.incoming + r.incoming,
      outgoing: acc.outgoing + r.outgoing,
      diff: acc.diff + r.diff,
    }),
    { classification: 'الإجمالي', incoming: 0, outgoing: 0, diff: 0 }
  );
  return { rows, total };
}

/** The sync is stale after an hour without a successful run (it runs every 15 minutes). */
export const accountantSyncStale = (syncedAt: string | null, now = Date.now()) =>
  !syncedAt ||
  !Number.isFinite(Date.parse(syncedAt)) ||
  now - new Date(syncedAt).getTime() > 3600e3;

export type AccountantReportScope = 'all' | 'shokry';

/** «shokry» is خزنة شكري only, for the «بصمات د وائل» viewers (migration 20261103220000). */
export async function loadAccountantReport(
  month: string | null,
  scope: AccountantReportScope = 'all'
): Promise<AccountantReport> {
  const { data, error } = await supabase.rpc(
    scope === 'shokry' ? 'get_dr_wael_shokry_report_v1' : 'get_accountant_report_v1',
    { p_month: month }
  );
  if (error)
    throw new Error(
      error.message?.includes('not_authorized')
        ? scope === 'shokry'
          ? 'الصفحة دي لد وائل والمدير العام بس'
          : 'الصفحة دي للمدير العام والتنفيذي بس'
        : 'تعذّر التحميل'
    );
  if (
    !data ||
    !Array.isArray(data.vaults) ||
    !Array.isArray(data.transactions) ||
    !Array.isArray(data.history)
  )
    throw new Error('بيانات التقرير غير مكتملة؛ أعد التحديث');
  return data as AccountantReport;
}

export function accountantHistoryRows(history: AccountantHistory[], vault: string | null) {
  const months = new Map<
    string,
    { month: string; opening: number | null; incoming: number; outgoing: number; count: number }
  >();
  for (const row of history) {
    if (vault && row.vault_code !== vault) continue;
    const current = months.get(row.month) ?? {
      month: row.month,
      opening: 0,
      incoming: 0,
      outgoing: 0,
      count: 0,
    };
    current.opening =
      current.opening === null || row.opening === null
        ? null
        : current.opening + Number(row.opening);
    current.incoming += Number(row.incoming);
    current.outgoing += Number(row.outgoing);
    current.count += Number(row.count);
    months.set(row.month, current);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
export function accountantFilter(
  rows: AccountantTransaction[],
  filters: {
    vault: string | null;
    direction: string;
    category: string;
    query: string;
    from: string;
    to: string;
    itemName?: string;
  }
) {
  const query = filters.query.trim().normalize('NFC').toLocaleLowerCase('ar');
  return rows.filter(
    (t) =>
      (!filters.vault || t.vault_code === filters.vault) &&
      (!filters.direction || t.direction === filters.direction) &&
      (!filters.category || t.classification === filters.category) &&
      (!filters.itemName || (t.category_name || 'بدون بند') === filters.itemName) &&
      (!filters.from || t.date >= filters.from) &&
      (!filters.to || t.date <= filters.to) &&
      (!query ||
        [
          t.description,
          t.category_name,
          t.classification,
          t.created_by_name,
          t.source_details?.original_description,
          t.id,
        ].some((value) =>
          String(value ?? '')
            .normalize('NFC')
            .toLocaleLowerCase('ar')
            .includes(query)
        ))
  );
}
export const accountantExportText = (value: string | null | undefined) =>
  /^[=+\-@\t\r\n]/.test(value ?? '') ? "'" + value : (value ?? '');
