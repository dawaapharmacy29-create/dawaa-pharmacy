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
}

export interface AccountantReport {
  synced_at: string | null;
  last_error: string | null;
  month: string;
  months: string[];
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
    const line = lines.get(t.classification) ?? { classification: t.classification, incoming: 0, outgoing: 0, diff: 0 };
    const amount = Number(t.amount) || 0;
    if (t.direction === 'in') line.incoming += amount;
    else line.outgoing += amount;
    line.diff = line.incoming - line.outgoing;
    lines.set(t.classification, line);
  }
  const rows = [...lines.values()].sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing));
  const total = rows.reduce(
    (acc, r) => ({ ...acc, incoming: acc.incoming + r.incoming, outgoing: acc.outgoing + r.outgoing, diff: acc.diff + r.diff }),
    { classification: 'الإجمالي', incoming: 0, outgoing: 0, diff: 0 }
  );
  return { rows, total };
}

/** The sync is stale after an hour without a successful run (it runs every 15 minutes). */
export const accountantSyncStale = (syncedAt: string | null, now = Date.now()) =>
  !syncedAt || now - new Date(syncedAt).getTime() > 3600e3;

export async function loadAccountantReport(month: string | null): Promise<AccountantReport> {
  const { data, error } = await supabase.rpc('get_accountant_report_v1', { p_month: month });
  if (error) throw new Error(error.message?.includes('not_authorized') ? 'الصفحة دي للمدير العام والتنفيذي بس' : 'تعذّر التحميل');
  return data as AccountantReport;
}
