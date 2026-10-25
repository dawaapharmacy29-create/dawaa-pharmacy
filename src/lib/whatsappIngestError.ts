/** Avoid losing the real reason when a browser/API throws a plain object instead of Error. */
export function describeWhatsAppIngestError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code, record.status]
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .map(String)
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(' | ').slice(0, 700);
  }
  return `خطأ غير محدد أثناء المعالجة (النوع: ${error === null ? 'null' : typeof error})`;
}
