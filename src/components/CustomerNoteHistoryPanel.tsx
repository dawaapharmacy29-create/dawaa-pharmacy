import { useState } from 'react';
import { ChevronDown, ChevronUp, History, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type NoteHistoryRow = {
  id: string;
  note_type: string;
  note_text: string;
  created_by_name: string | null;
  created_at: string;
};

const NOTE_TYPE_LABELS: Record<string, string> = {
  general: 'ملاحظة عامة',
  service: 'خدمة العملاء',
  team: 'الفريق',
  handling: 'تعليمات تعامل',
  whatsapp: 'واتساب',
};

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString('ar-EG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

/**
 * سجل تاريخي كامل لكل الملاحظات اللي اتسجلت على العميل ده، بمن كتبها ومتى —
 * مبني على customer_note_history اللي بتتغذى تلقائيًا (trigger) من أي تعديل
 * على حقول الملاحظات في ملف العميل. من غير الپانل ده الملاحظات كانت
 * بتتسجل في الخلفية بس محدش بيشوفها.
 */
export function CustomerNoteHistoryPanel({
  customerId,
  customerCode,
}: {
  customerId?: string | null;
  customerCode?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<NoteHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canLoad = Boolean(customerId || customerCode);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded && canLoad) {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from('customer_note_history')
          .select('id,note_type,note_text,created_by_name,created_at')
          .order('created_at', { ascending: false })
          .limit(50);
        query = customerId
          ? query.eq('customer_id', customerId)
          : query.eq('customer_code', customerCode as string);
        const { data, error: fetchError } = await query;
        if (fetchError) throw fetchError;
        setRows((data || []) as NoteHistoryRow[]);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل سجل الملاحظات');
      } finally {
        setLoading(false);
      }
    }
  };

  if (!canLoad) return null;

  return (
    <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"
      >
        <span className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          سجل الملاحظات التاريخي (كل تعديل، بمن كتبه ومتى)
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--dawaa-theme-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ التحميل…
            </div>
          ) : error ? (
            <div className="text-xs font-bold text-red-400">{error}</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-[var(--dawaa-theme-muted)]">
              لا يوجد سجل ملاحظات سابق لهذا العميل.
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-2.5 text-xs"
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[var(--dawaa-theme-muted)]">
                  <span className="rounded-full border border-[var(--dawaa-theme-accent-border)] px-2 py-0.5 font-black text-[var(--dawaa-theme-primary-strong)]">
                    {NOTE_TYPE_LABELS[row.note_type] || row.note_type}
                  </span>
                  <span>
                    {row.created_by_name || 'غير معروف'} · {formatDateTime(row.created_at)}
                  </span>
                </div>
                <div className="whitespace-pre-line text-[var(--dawaa-theme-text)]">
                  {row.note_text}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
