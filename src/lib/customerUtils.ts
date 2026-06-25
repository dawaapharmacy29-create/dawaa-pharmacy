// Shared customer utilities used by customer service, quick replies, and WhatsApp workflows.

export function safeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePhone(phone: string | null | undefined): string {
  return String(phone || '').replace(/[\s\-()+]/g, '').trim();
}

export function isValidEgyptianPhone(phone: string | null | undefined): boolean {
  const cleaned = normalizePhone(phone);
  return /^01[0125][0-9]{8}$/.test(cleaned) || /^201[0125][0-9]{8}$/.test(cleaned);
}

export function phoneToWhatsAppNumber(phone: string | null | undefined): string {
  const cleaned = normalizePhone(phone);
  if (!cleaned) return '';
  if (cleaned.startsWith('20')) return cleaned;
  if (cleaned.startsWith('0')) return `20${cleaned.slice(1)}`;
  if (cleaned.startsWith('1') && cleaned.length === 10) return `20${cleaned}`;
  return cleaned;
}

export function buildWhatsAppUrl(phone: string | null | undefined, message = ''): string {
  const number = phoneToWhatsAppNumber(phone);
  if (!number) return '';
  const text = message.trim() ? `?text=${encodeURIComponent(message.trim())}` : '';
  return `https://wa.me/${number}${text}`;
}

export function escapeSupabaseOrValue(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\./g, '\\.')
    .replace(/:/g, '\\:')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to textarea copy.
    }
  }
  if (typeof document === 'undefined') return;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

export function daysSince(dateValue: string | null | undefined): number | null {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export function customerRiskLabel(lastPurchase: string | null | undefined): string {
  const days = daysSince(lastPurchase);
  if (days == null) return 'غير محدد';
  if (days <= 14) return 'نشط';
  if (days <= 45) return 'يحتاج متابعة';
  if (days <= 60) return 'في خطر';
  return 'مفقود';
}
