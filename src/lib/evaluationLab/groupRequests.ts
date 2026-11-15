import { isCompleteRequest } from './earnedIncentive';

// Customer requests posted in the branches' WhatsApp groups (owner decision 2026-11-15): they count
// with the app's requests. A group request for the same customer on the same Cairo day as an app
// request is the same request, so it counts once. Pure: no I/O.

export interface GroupRequest {
  staffId: string | null;
  branch: string | null;
  /** Cairo day of the message, YYYY-MM-DD. */
  day: string;
  customerCode: string | null;
  customerPhone: string | null;
}

export interface AppRequest {
  recordedStaffId: string | null;
  createdAt: string;
  status?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  medicineName?: string | null;
  productCode?: string | null;
}

const cairoDay = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 10);
const digits = (value: string | null | undefined) =>
  String(value || '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/\D/g, '');

/** The customer of a request: its code, else its phone (last 10 digits). Empty when it has neither. */
export function customerKey(
  code: string | null | undefined,
  phone: string | null | undefined
): string {
  const c = digits(code);
  if (c && !/^0*$/.test(c)) return c.length >= 10 ? `p:${c.slice(-10)}` : `c:${c}`;
  const p = digits(phone);
  return p.length >= 8 ? `p:${p.slice(-10)}` : '';
}

/** Complete requests per staff id: the app's complete requests plus group requests not already in the app. */
export function completeRequestCounts(
  appRequests: readonly AppRequest[],
  groupRequests: readonly GroupRequest[] | null | undefined
): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of appRequests) {
    const key = customerKey(r.customerCode, r.customerPhone);
    if (key) seen.add(`${cairoDay(r.createdAt)}|${key}`);
    if (r.recordedStaffId && isCompleteRequest(r))
      counts.set(r.recordedStaffId, (counts.get(r.recordedStaffId) || 0) + 1);
  }
  for (const g of groupRequests || []) {
    const key = customerKey(g.customerCode, g.customerPhone);
    if (!key) continue;
    const slot = `${g.day}|${key}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    if (g.staffId) counts.set(g.staffId, (counts.get(g.staffId) || 0) + 1);
  }
  return counts;
}
