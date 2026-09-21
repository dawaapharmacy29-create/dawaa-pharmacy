import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { REVIEW_CRITERIA, reviewerDisplayName } from '@/lib/conversationReviews';
import { toNumber } from '@/lib/utils';
import ConversationReviewTranscriptCard from '@/components/reviews/ConversationReviewTranscriptCard';

type ReviewRow = Record<string, any>;

const DETAIL_SELECT = [
  'id','created_at','updated_at','reviewer_id','reviewer_name','reviewer_role',
  'staff_id','doctor_id','staff_name','doctor_name','staff_role','branch',
  'customer_name','customer_code','customer_phone','invoice_number','evaluation_kind','conversation_type','evaluation_reason',
  'conversation_date','final_score','total_score','doctor_points_impact','point_impact','level',
  'main_positive_reason','main_negative_reason','reviewer_notes','training_recommendation',
  'manager_review_score','manager_review_notes','manager_reviewed_by','manager_reviewed_at',
  'raw_scores','review_items','repeat_count','repeat_multiplier'
].join(',');

function parseJson(value: unknown) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value as any;
}

function reviewItems(row: ReviewRow | null) {
  if (!row) return [] as any[];
  const explicit = parseJson(row.review_items);
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const raw = parseJson(row.raw_scores);
  if (Array.isArray(raw?.result?.reviewItems) && raw.result.reviewItems.length) return raw.result.reviewItems;
  if (Array.isArray(raw?.review_items) && raw.review_items.length) return raw.review_items;
  const criteria = raw?.criteria;
  if (!criteria || typeof criteria !== 'object') return [] as any[];
  return REVIEW_CRITERIA.map((criterion) => {
    const saved = criteria[criterion.key];
    if (!saved || typeof saved !== 'object') return null;
    const choice = criterion.choices.find((item) => item.value === saved.choice);
    return {
      key: criterion.key,
      label: criterion.label,
      applies: saved.applies !== false,
      selectedOption: choice?.label || String(saved.choice || '-'),
      pointsEarned: saved.applies === false ? 0 : (choice?.pointsEarned ?? 0),
      maxPoints: criterion.maxPoints,
      notes: saved.notes || '',
    };
  }).filter(Boolean) as any[];
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' });
}

export default function ConversationReviewDetailsFast() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, checkPermission } = useAuth();
  const reviewId = String(params.get('id') || '').trim();
  const [row, setRow] = useState<ReviewRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!reviewId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('conversation_sales_reviews')
        .select(DETAIL_SELECT)
        .eq('id', reviewId)
        .maybeSingle();
      if (queryError) throw queryError;
      if (!data) throw new Error('لم يتم العثور على التقييم');
      setRow(data as ReviewRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل التقييم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [reviewId]);

  const items = useMemo(() => reviewItems(row), [row]);
  const raw = useMemo(() => parseJson(row?.raw_scores), [row]);
  const severeEntries = useMemo(() => Object.entries(raw?.severe_errors || {}).filter(([, active]) => Boolean(active)), [raw]);
  const score = toNumber(row?.final_score ?? row?.total_score ?? 0);
  const impact = toNumber(row?.doctor_points_impact ?? row?.point_impact ?? 0);
  const role = normalizeRole(user?.role);
  const canEdit = Boolean(checkPermission('edit_reviews') || role === 'general_manager' || role === 'branches_manager' || role === 'executive_manager');

  if (loading) {
    return <div dir="rtl" className="dawaa-card p-6"><div className="flex items-center gap-3 font-black"><RefreshCw className="animate-spin" size={18}/>جاري تحميل تفاصيل التقييم...</div></div>;
  }

  if (error || !row) {
    return <div dir="rtl" className="dawaa-card p-6 space-y-3"><div className="text-red-300 font-black">{error || 'تعذر تحميل التقييم'}</div><button className="dawaa-button dawaa-button--secondary" onClick={() => navigate('/reviews?section=history')}>العودة للسجل</button></div>;
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="dawaa-card p-4 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
        <div>
          <h1 className="dawaa-title text-xl font-black">تفاصيل تقييم المحادثة كاملة</h1>
          <p className="dawaa-caption mt-1 text-sm">يتم تحميل تقييم واحد فقط لضمان فتح سريع بدون إعادة تحميل سجل التقييمات.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <button className="dawaa-button dawaa-button--primary flex items-center gap-2" onClick={() => navigate(`/reviews?mode=edit&id=${encodeURIComponent(reviewId)}`)}><Pencil size={16}/>تعديل التقييم بالكامل</button>}
          <button className="dawaa-button dawaa-button--secondary flex items-center gap-2" onClick={() => navigate('/reviews?section=history')}><X size={16}/>العودة للسجل</button>
        </div>
      </div>

      <section className="dawaa-card p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Info label="الدكتور / الموظف" value={row.staff_name || row.doctor_name || '-'} />
          <Info label="المراجع" value={reviewerDisplayName(row, '-')} />
          <Info label="الفرع" value={row.branch || '-'} />
          <Info label="العميل" value={row.customer_name || '-'} />
          <Info label="كود العميل" value={row.customer_code || '-'} />
          <Info label="رقم الفاتورة" value={row.invoice_number || '-'} />
          <Info label="تاريخ المحادثة" value={formatDate(row.conversation_date || row.created_at)} />
          <Info label="نوع المحادثة" value={row.evaluation_kind || row.conversation_type || '-'} />
          <Info label="سبب التقييم" value={row.evaluation_reason || '-'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="النتيجة" value={`${score}/100`} />
          <Metric label="تأثير النقاط" value={impact > 0 ? `+${impact}` : String(impact)} />
          <Metric label="عدد البنود" value={String(items.length)} />
          <Metric label="تقييم المراجع" value={row.manager_review_score != null ? `${row.manager_review_score}/100` : 'لم يُقيّم'} />
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-4 text-sm leading-7">
          <div><span className="text-slate-400">أهم نقطة إيجابية:</span> {row.main_positive_reason || '-'}</div>
          <div><span className="text-slate-400">أهم سبب خصم:</span> {row.main_negative_reason || '-'}</div>
          <div><span className="text-slate-400">ملاحظات المراجع:</span> {row.reviewer_notes || '-'}</div>
          <div><span className="text-slate-400">التوصية التدريبية:</span> {row.training_recommendation || '-'}</div>
        </div>
      </section>

      <section className="dawaa-card p-4 space-y-3">
        <div className="font-black text-lg">كل بنود التقييم</div>
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-950/70"><tr><th className="p-3 text-right">البند</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">الاختيار</th><th className="p-3 text-right">النقاط</th><th className="p-3 text-right">الملاحظة</th></tr></thead>
            <tbody>
              {items.map((item: any, index) => <tr key={item.key || index} className="border-t border-slate-800"><td className="p-3 font-bold">{item.label || item.key || '-'}</td><td className="p-3">{item.applies === false ? 'لا ينطبق' : 'ينطبق'}</td><td className="p-3">{item.selectedOption || item.choice || '-'}</td><td className="p-3 font-black">{item.pointsEarned != null ? `${item.pointsEarned}/${item.maxPoints ?? ''}` : '-'}</td><td className="p-3">{item.notes || '-'}</td></tr>)}
              {!items.length && <tr><td colSpan={5} className="p-6 text-center text-amber-200">لا توجد بنود تفصيلية قابلة للعرض لهذا التقييم.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {severeEntries.length > 0 && <section className="dawaa-card p-4 border border-red-500/30"><div className="font-black text-red-200 mb-2">الأخطاء الجسيمة</div><div className="flex flex-wrap gap-2">{severeEntries.map(([key]) => <span key={key} className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">{key}</span>)}</div></section>}

      <ConversationReviewTranscriptCard reviewRow={row} defaultOpen={false} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 font-black text-white">{value}</div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-xl font-black text-teal-200">{value}</div></div>;
}
