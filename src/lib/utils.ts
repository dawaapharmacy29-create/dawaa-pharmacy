import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { matchesAppSearch, normalizeAppSearchText } from '@/lib/appSearch';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('ar-EG').format(toNumber(n));
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(toNumber(n)) + ' ج.م';
}

export function formatDate(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatTime(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export function getInitials(name: string): string {
  return (
    (name || '')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('') || '؟'
  );
}

export function normalizeName(value: unknown): string {
  return normalizeAppSearchText(value).replace(/ة/g, 'ه');
}

/**
 * بحث موحد على مستوى التطبيق يدعم النجمة في البداية أو المنتصف أو النهاية،
 * مع توحيد الهمزات والتشكيل والأرقام العربية والإنجليزية.
 */
export function matchesOrderedSegments(haystack: string, needleRaw: string): boolean {
  return matchesAppSearch(haystack, needleRaw);
}

export function classifyCustomer(avgMonthly: number): { label: string; color: string; bg: string } {
  avgMonthly = toNumber(avgMonthly);
  if (avgMonthly >= 8000)
    return {
      label: 'مهم جدًا',
      color: 'text-purple-400',
      bg: 'bg-purple-500/15 border-purple-500/25',
    };
  if (avgMonthly >= 4000)
    return { label: 'مهم', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/25' };
  if (avgMonthly >= 1500)
    return { label: 'متوسط', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/25' };
  return { label: 'عادي', color: 'text-slate-400', bg: 'bg-slate-500/15 border-slate-500/25' };
}

export function isCurrentlyOnShift(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime || !startTime.includes(':') || !endTime.includes(':')) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return false;
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (endMinutes > startMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export function toNumber(value: unknown, fallback = 0): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function percent(value: unknown, total: unknown): number {
  const safeTotal = toNumber(total);
  if (safeTotal <= 0) return 0;
  return Math.max(0, Math.min(100, (toNumber(value) / safeTotal) * 100));
}
