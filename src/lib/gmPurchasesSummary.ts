import { supabase } from '@/lib/supabase';

// Purchases of the «دواء وائل» purchases app per branch for any period (migration 20261105120000).
// Saved invoices only, like the purchases app (migration 20261105200000); invoices still waiting for review are pending_*.
// net = gross − transfers between the two branches − agreed excluded suppliers − invoices excluded one by one.

export interface GmPurchasesBranch {
  branch: string;
  invoices: number;
  gross: number;
  transfers: number;
  excluded: number;
  net: number;
  /** Purchases still «انتظار المراجعة» in the app: not in the net. */
  pending_invoices: number;
  pending_value: number;
}

export interface GmPurchasesSummary {
  from: string;
  to: string;
  branches: GmPurchasesBranch[];
  excluded_suppliers: string[];
  synced_at: string | null;
}

export async function loadGmPurchasesSummary(
  from: string,
  to: string
): Promise<GmPurchasesSummary> {
  const { data, error } = await supabase.rpc('get_gm_purchases_summary_v1', {
    p_from: from,
    p_to: to,
  });
  if (error) {
    const message = String(error.message || '');
    if (message.includes('not_authorized')) throw new Error('ده للمدير العام والتنفيذي بس');
    if (message.includes('invalid_period'))
      throw new Error('الفترة مش صح (لازم "من" قبل "لحد" ومش أكتر من سنة)');
    throw new Error('تعذّر تحميل المشتريات');
  }
  const summary = data as GmPurchasesSummary;
  return {
    ...summary,
    branches: (summary.branches || []).map((row) => ({
      ...row,
      invoices: Number(row.invoices) || 0,
      gross: Number(row.gross) || 0,
      transfers: Number(row.transfers) || 0,
      excluded: Number(row.excluded) || 0,
      net: Number(row.net) || 0,
      pending_invoices: Number(row.pending_invoices) || 0,
      pending_value: Number(row.pending_value) || 0,
    })),
  };
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The 26 → 25 pay cycle that contains `today` (offset 0), or the one before it (offset -1).
 * The current cycle ends today; a past cycle ends on its 25th.
 */
export function cycleRange(today: string, offset = 0): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  // Month index (0-based) in which the cycle starts.
  let startMonth = d >= 26 ? m - 1 : m - 2;
  startMonth += offset;
  const from = new Date(Date.UTC(y, startMonth, 26));
  const end = new Date(Date.UTC(y, startMonth + 1, 25));
  const to = offset === 0 ? today : iso(end);
  return { from: iso(from), to };
}

export function purchasesTotals(branches: GmPurchasesBranch[]) {
  return branches.reduce(
    (sum, row) => ({
      invoices: sum.invoices + row.invoices,
      gross: sum.gross + row.gross,
      transfers: sum.transfers + row.transfers,
      excluded: sum.excluded + row.excluded,
      net: sum.net + row.net,
      pending_invoices: sum.pending_invoices + (row.pending_invoices || 0),
      pending_value: sum.pending_value + (row.pending_value || 0),
    }),
    { invoices: 0, gross: 0, transfers: 0, excluded: 0, net: 0, pending_invoices: 0, pending_value: 0 }
  );
}
