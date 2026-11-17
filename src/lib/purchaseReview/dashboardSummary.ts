import {
  EXPECTED_STORES,
  PURCHASE_BRANCHES,
  addDays,
  isExcluded,
  type PurchaseReviewData,
} from './ledger';
import type { PurchaseBranch } from './ePlusReport';

// «صافي المشتريات» on the GM dashboard, from the ePlus reports uploaded to «مراجعة المشتريات»: credit and
// cash invoices of the period, less the internal codes (transfers between the branches, stock counts) and
// the invoices marked «مستثناة». Purchase returns are not in these reports, so nothing is taken off for them.

export interface DashboardBranchPurchases {
  branch: PurchaseBranch;
  gross: number;
  internal: number;
  excluded: number;
  net: number;
  credit: number;
  cash: number;
  invoices: number;
}

export interface DashboardPurchases {
  from: string;
  to: string;
  branches: DashboardBranchPurchases[];
  total: Omit<DashboardBranchPurchases, 'branch'>;
  /** Names of the internal codes left out. */
  internalSuppliers: string[];
  /** Stores whose uploaded reports stop before the period's last day (yesterday when it runs to today). */
  behind: { store: string; last_day: string | null }[];
}

export function dashboardPurchases(
  data: PurchaseReviewData,
  range: { from: string; to: string }
): DashboardPurchases {
  const terms = new Map(data.suppliers.map((s) => [s.code, s]));
  const branches = new Map<PurchaseBranch, DashboardBranchPurchases>(
    PURCHASE_BRANCHES.map((branch) => [
      branch,
      { branch, gross: 0, internal: 0, excluded: 0, net: 0, credit: 0, cash: 0, invoices: 0 },
    ])
  );
  const lastDay = new Map<string, string>();
  const internalCodes = new Set<string>();
  for (const line of data.lines) {
    if (!lastDay.has(line.store) || line.day > lastDay.get(line.store)!)
      lastDay.set(line.store, line.day);
    if (line.day < range.from || line.day > range.to) continue;
    const b = branches.get(line.branch);
    if (!b) continue;
    b.gross += line.net;
    if (isExcluded(line.supplier_code, terms)) {
      b.internal += line.net;
      internalCodes.add(line.supplier_code);
    } else if (line.excluded) {
      b.excluded += line.net;
    } else {
      b[line.payment] += line.net;
      b.invoices += line.invoices;
    }
  }
  const list = [...branches.values()].map((b) => ({ ...b, net: b.credit + b.cash }));
  const sum = (key: keyof Omit<DashboardBranchPurchases, 'branch'>) =>
    list.reduce((t, b) => t + b[key], 0);
  // Today's purchases are uploaded tomorrow, so a period running to today is complete up to yesterday.
  const end = range.to >= data.today ? addDays(data.today, -1) : range.to;
  return {
    from: range.from,
    to: range.to,
    branches: list,
    total: {
      gross: sum('gross'),
      internal: sum('internal'),
      excluded: sum('excluded'),
      net: sum('net'),
      credit: sum('credit'),
      cash: sum('cash'),
      invoices: sum('invoices'),
    },
    internalSuppliers: [...internalCodes].map((code) => terms.get(code)?.name ?? code),
    behind:
      range.from > end
        ? []
        : EXPECTED_STORES.filter((s) => (lastDay.get(s.store) ?? '') < end).map((s) => ({
            store: s.store,
            last_day: lastDay.get(s.store) ?? null,
          })),
  };
}
