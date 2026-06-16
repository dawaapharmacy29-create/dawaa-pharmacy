/**
 * money.ts — Currency and invoice amount utilities
 */

export interface InvoiceAmountSource {
  net_amount?: number | string | null;
  discounted_amount?: number | string | null;
  amount?: number | string | null;
  gross_amount?: number | string | null;
  total_amount?: number | string | null;
}

/**
 * Safely converts a value to a number, returning 0 for nulls/NaN.
 */
export function safeNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

/**
 * Extracts the correct invoice amount using the precedence:
 * net_amount > discounted_amount > amount > gross_amount > total_amount > 0
 *
 * Matches the SQL: COALESCE(net_amount, discounted_amount, amount, gross_amount, 0)
 */
export function getInvoiceAmount(row: InvoiceAmountSource): number {
  if (row.net_amount != null && safeNumber(row.net_amount) > 0) {
    return safeNumber(row.net_amount);
  }
  if (row.discounted_amount != null && safeNumber(row.discounted_amount) > 0) {
    return safeNumber(row.discounted_amount);
  }
  if (row.amount != null && safeNumber(row.amount) > 0) {
    return safeNumber(row.amount);
  }
  if (row.gross_amount != null && safeNumber(row.gross_amount) > 0) {
    return safeNumber(row.gross_amount);
  }
  if (row.total_amount != null && safeNumber(row.total_amount) > 0) {
    return safeNumber(row.total_amount);
  }
  return 0;
}

/**
 * Formats a number as Egyptian Pounds currency.
 * Example: 1341724.58 → "1,341,724.58 ج.م"
 */
export function formatCurrency(
  amount: number | null | undefined,
  options: { decimals?: number; symbol?: string; compact?: boolean } = {}
): string {
  const { decimals = 2, symbol = "ج.م", compact = false } = options;
  const n = safeNumber(amount);

  if (compact) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}م ${symbol}`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}ك ${symbol}`;
  }

  return `${n.toLocaleString("ar-EG", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${symbol}`;
}

/**
 * Formats a number as a percentage string.
 */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  return `${safeNumber(value).toFixed(decimals)}%`;
}

/**
 * Sums an array of invoice rows by their resolved amount.
 */
export function sumInvoiceAmounts(rows: InvoiceAmountSource[]): number {
  return rows.reduce((acc, row) => acc + getInvoiceAmount(row), 0);
}
