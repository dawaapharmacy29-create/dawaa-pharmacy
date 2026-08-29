import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Camera, Check, Clock, Loader2, Star } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { uploadImageToStorage } from '@/lib/storageUpload';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import { toast } from 'sonner';
import { Panel, MiniBox } from '@/components/dashboard/DashboardPrimitives';

type ChecklistItem = {
  id: string;
  item_key: string;
  title: string;
  description: string | null;
  time_slot: string;
  sort_order: number;
  requires_photo: boolean;
};

type Submission = {
  id: string;
  item_id: string;
  completed: boolean;
  photo_url: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
};

type CleaningDailyRating = {
  stars: number;
  score_pct: number;
  points_delta: number;
  manager_note: string | null;
};

type CleaningCycleSummary = {
  rated_days: number;
  five_star_days: number;
  avg_stars: number;
  avg_score_pct: number;
  total_star_points: number;
  performance_band: string;
};

const TIME_SLOT_ORDER: Record<string, number> = { 'فتح': 0, 'أثناء اليوم': 1, 'قفل': 2 };

const STATUS_LABEL: Record<Submission['review_status'], { label: string; color: string; bg: string; borderColor: string }> = {
  pending: { label: 'بانتظار مراجعة المدير', color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  approved: { label: 'معتمد', color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  rejected: { label: 'مرفوض — صحّح البند وأعد الإرسال', color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' },
};

function cairoDateKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function StaffDailyChecklist() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const branch = user?.branch || '';
  const canonicalRole = canonicalStaffRole(user?.role);
  const isCleaning = canonicalRole === 'cleaning';
  const staffRole = isCleaning
    ? 'مسؤولة النظافة'
    : canonicalRole === 'assistant'
      ? 'مساعد صيدلي'
      : canonicalRole === 'customer_service'
        ? 'مسؤول خدمة العملاء'
        : null;

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [dailyRating, setDailyRating] = useState<CleaningDailyRating | null>(null);
  const [cycleSummary, setCycleSummary] = useState<CleaningCycleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const today = cairoDateKey();

  const load = useCallback(async () => {
    if (!staffRole) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const checklistItemsQuery = supabase
      .from('staff_daily_checklist_items')
      .select('id, item_key, title, description, time_slot, sort_order, requires_photo')
      .eq('role', staffRole)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    const submissionsQuery = staffId
      ? supabase
          .from('staff_daily_checklist_submissions')
          .select('id, item_id, completed, photo_url, review_status, reviewer_note')
          .eq('staff_id', staffId)
          .eq('submission_date', today)
      : Promise.resolve({ data: [] as Submission[] });

    const [itemsRes, subsRes, ratingRes, summaryRes] = await Promise.all([
      checklistItemsQuery,
      submissionsQuery,
      isCleaning && staffId
        ? supabase
            .from('cleaning_daily_ratings')
            .select('stars, score_pct, points_delta, manager_note')
            .eq('staff_id', staffId)
            .eq('rating_date', today)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      isCleaning && staffId
        ? supabase.rpc('get_cleaning_cycle_rating_summary_v1', { p_staff_id: staffId, p_month_cycle: null })
        : Promise.resolve({ data: [] }),
    ]);

    setItems((itemsRes.data || []) as ChecklistItem[]);
    const map: Record<string, Submission> = {};
    ((subsRes.data || []) as Submission[]).forEach((s) => {
      map[s.item_id] = s;
    });
    setSubmissions(map);

    const rating = ratingRes.data as Record<string, unknown> | null;
    setDailyRating(rating ? {
      stars: Number(rating.stars || 0),
      score_pct: Number(rating.score_pct || 0),
      points_delta: Number(rating.points_delta || 0),
      manager_note: rating.manager_note ? String(rating.manager_note) : null,
    } : null);

    const summaryRow = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
    const summary = summaryRow as Record<string, unknown> | null;
    setCycleSummary(summary ? {
      rated_days: Number(summary.rated_days || 0),
      five_star_days: Number(summary.five_star_days || 0),
      avg_stars: Number(summary.avg_stars || 0),
      avg_score_pct: Number(summary.avg_score_pct || 0),
      total_star_points: Number(summary.total_star_points || 0),
      performance_band: String(summary.performance_band || '—'),
    } : null);
    setLoading(false);
  }, [isCleaning, staffId, staffRole, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const groups: Record<string, ChecklistItem[]> = {};
    items.forEach((item) => {
      groups[item.time_slot] = groups[item.time_slot] || [];
      groups[item.time_slot].push(item);
    });
    return Object.entries(groups).sort((a, b) => (TIME_SLOT_ORDER[a[0]] ?? 9) - (TIME_SLOT_ORDER[b[0]] ?? 9));
  }, [items]);

  const dailyProgress = useMemo(() => {
    const values = Object.values(submissions);
    return {
      submitted: values.filter((item) => item.completed).length,
      pending: values.filter((item) => item.review_status === 'pending').length,
      approved: values.filter((item) => item.review_status === 'approved').length,
      rejected: values.filter((item) => item.review_status === 'rejected').length,
    };
  }, [submissions]);

  const handleUploadAndComplete = useCallback(
    async (item: ChecklistItem, file: File | null) => {
      if (!staffId) return;
      setUploadingKey(item.item_key);
      try {
        let photoUrl: string | null = null;
        if (file) {
          const { publicUrl } = await uploadImageToStorage('checklist-evidence', file, `${branch}/${staffId}`);
          photoUrl = publicUrl;
        }
        if (item.requires_photo && !photoUrl) {
          toast.error('البند ده محتاج صورة قبل ما تتم عليه.');
          setUploadingKey(null);
          return;
        }
        const { data, error } = await supabase.rpc('submit_my_staff_daily_checklist_v1', {
          p_item_id: item.id,
          p_photo_url: photoUrl,
          p_staff_note: null,
        });
        if (error) throw error;
        const saved = (Array.isArray(data) ? data[0] : data) as Submission | null;
        if (!saved?.id) throw new Error('لم يرجع سجل التشيك ليست بعد الحفظ');
        setSubmissions((prev) => ({ ...prev, [item.id]: saved }));
        toast.success('اتسجل، وهيتراجع من مدير الفرع.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
      } finally {
        setUploadingKey(null);
      }
    },
    [branch, staffId]
  );

  if (!staffRole) {
    return (
      <div className="p-6 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
        الصفحة دي مخصصة لعامل النظافة والمساعد ومسؤول خدمة العملاء فقط.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>التشيك ليست اليومي — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>نفّذ كل بند وارفع صورة واضحة. لو المدير رفض بند، صححه وأعد إرساله من نفس المكان.</p>
      </div>

      {isCleaning && !loading ? (
        <Panel className="p-4">
          <h2 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>إنجاز مهام النظافة اليوم</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniBox label="تم الإرسال" value={`${dailyProgress.submitted}/${items.length}`} />
            <MiniBox label="بانتظار المراجعة" value={String(dailyProgress.pending)} />
            <MiniBox label="معتمد" value={String(dailyProgress.approved)} />
            <MiniBox label="يحتاج تصحيح" value={String(dailyProgress.rejected)} />
          </div>
          <p className="mt-3 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            تقييم النجوم يفتح للمدير بعد إرسال ومراجعة كل مهام اليوم.
          </p>
        </Panel>
      ) : null}

      {isCleaning && !loading ? (
        <Panel className="p-4" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)' }}>
          <div className="flex items-center gap-2">
            <Award size={18} style={{ color: 'var(--dawaa-status-warning-text)' }} />
            <h2 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>تقييم النظافة والتحفيز</h2>
          </div>
          {dailyRating ? (
            <>
              <div className="mt-3 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Star key={value} size={24} className={value <= dailyRating.stars ? 'fill-current' : ''} style={{ color: value <= dailyRating.stars ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-border)' }} />
                ))}
                <span className="mr-2 text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{dailyRating.stars}/5 — {dailyRating.score_pct}%</span>
              </div>
              <p className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
                أثر اليوم على النقاط: {dailyRating.points_delta > 0 ? '+' : ''}{dailyRating.points_delta}
              </p>
              {dailyRating.manager_note ? <p className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة المدير: {dailyRating.manager_note}</p> : null}
            </>
          ) : (
            <p className="mt-3 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>تقييم اليوم لم يُعتمد بعد.</p>
          )}

          {cycleSummary ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniBox label="متوسط الدورة" value={`${cycleSummary.avg_stars.toFixed(2)}★`} tone="amber" />
              <MiniBox label="متوسط الدرجة" value={`${cycleSummary.avg_score_pct}%`} tone="amber" />
              <MiniBox label="أيام 5 نجوم" value={String(cycleSummary.five_star_days)} tone="amber" />
              <MiniBox label="نقاط النجوم" value={`${cycleSummary.total_star_points > 0 ? '+' : ''}${cycleSummary.total_star_points}`} tone="amber" />
            </div>
          ) : null}
          {cycleSummary ? <p className="mt-3 text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>المستوى الحالي: {cycleSummary.performance_band} • {cycleSummary.rated_days} يوم مُقيّم</p> : null}
        </Panel>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : (
        grouped.map(([slot, slotItems]) => (
          <div key={slot} className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
              <Clock size={14} /> {slot}
            </h2>
            {slotItems.map((item) => {
              const sub = submissions[item.id];
              const status = sub ? STATUS_LABEL[sub.review_status] : null;
              const canSubmit = !sub?.completed || sub.review_status === 'rejected';
              return (
                <Panel key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.title}</p>
                      {item.description ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.description}</p> : null}
                    </div>
                    {sub?.completed && sub.review_status !== 'rejected' ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }}>
                        <Check size={16} />
                      </span>
                    ) : null}
                  </div>

                  {status ? (
                    <div className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-black" style={{ borderColor: status.borderColor, background: status.bg, color: status.color }}>
                      {status.label}
                      {sub?.review_status === 'rejected' && sub.reviewer_note ? (
                        <span className="mt-1 block font-normal">سبب الرفض: {sub.reviewer_note}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {sub?.photo_url ? (
                    <img src={sub.photo_url} alt={item.title} className="mt-3 h-32 w-full rounded-xl object-cover" />
                  ) : null}

                  {canSubmit ? (
                    <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-text)' }}>
                      {uploadingKey === item.item_key ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <Camera size={16} /> {sub?.review_status === 'rejected' ? 'أعد التصوير والتسجيل' : item.requires_photo ? 'صوّر وسجّل' : 'سجّل الإنجاز'}
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingKey === item.item_key}
                        onChange={(e) => void handleUploadAndComplete(item, e.target.files?.[0] || null)}
                      />
                    </label>
                  ) : null}
                </Panel>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
