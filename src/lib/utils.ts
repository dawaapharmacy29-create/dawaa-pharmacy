import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { CUSTOMER_SEGMENT_THRESHOLDS } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("ar-EG").format(toNumber(n));
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(toNumber(n)) + " ج.م";
}

export function formatDate(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
}

export function formatTime(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-EG", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export function getInitials(name: string): string {
  return (name || "").trim().split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "؟";
}

export function normalizeName(value: unknown): string {
  return String(value || "")
    .replace(/[\u0623\u0625\u0622]/g, "ا")
    .replace(/\u0629/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * بحث مرن بالنجوم: `ا*س*ل*ا*م` يطابق "إسلام" لأن الأجزاء تظهر بالترتيب.
 * بدون `*` يُستخدم تطابق جزئي بسيط (يحتوي النص).
 */
export function matchesOrderedSegments(haystack: string, needleRaw: string): boolean {
  const raw = normalizeName(needleRaw).toLowerCase().trim();
  if (!raw) return true;
  const h = normalizeName(haystack).toLowerCase();
  if (!raw.includes("*")) {
    const q = raw.replace(/\s+/g, " ");
    return h.includes(q);
  }
  const segments = raw.split("*").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return true;
  let idx = 0;
  for (const seg of segments) {
    const i = h.indexOf(seg, idx);
    if (i === -1) return false;
    idx = i + seg.length;
  }
  return true;
}

/**
 * تصنيف العميل بناءً على متوسطه الشهري.
 * يستخدم CUSTOMER_SEGMENT_THRESHOLDS من constants.ts — لا ترقام صلبة هنا.
 */
export function classifyCustomer(avgMonthly: number): { label: string; color: string; bg: string } {
  avgMonthly = toNumber(avgMonthly);
  if (avgMonthly >= CUSTOMER_SEGMENT_THRESHOLDS.VERY_IMPORTANT)
    return { label: "مهم جدًا", color: "text-purple-400", bg: "bg-purple-500/15 border-purple-500/25" };
  if (avgMonthly >= CUSTOMER_SEGMENT_THRESHOLDS.IMPORTANT)
    return { label: "مهم", color: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/25" };
  if (avgMonthly >= CUSTOMER_SEGMENT_THRESHOLDS.MEDIUM)
    return { label: "متوسط", color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/25" };
  return { label: "عادي", color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/25" };
}

export function isCurrentlyOnShift(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime || !startTime.includes(":") || !endTime.includes(":")) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return false;
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (endMinutes > startMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  // overnight shift
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function uniqueBy<T>(arr: T[], key: (item: T) => unknown): T[] {
  const seen = new Set();
  return arr.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function sumBy<T>(arr: T[], key: (item: T) => number): number {
  return arr.reduce((sum, item) => sum + toNumber(key(item)), 0);
}

export function sortBy<T>(arr: T[], key: (item: T) => number | string, direction: "asc" | "desc" = "asc"): T[] {
  return [...arr].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
    return direction === "asc" ? cmp : -cmp;
  });
}

export function truncate(str: string, maxLength: number): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

export function isArabic(str: string): boolean {
  return /[\u0600-\u06FF]/.test(str);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function percent(value: number, total: number, decimals = 1): number {
  if (!total) return 0;
  return parseFloat(((value / total) * 100).toFixed(decimals));
}
