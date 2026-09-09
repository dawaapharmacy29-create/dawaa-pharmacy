import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Camera, Clock, Loader2, Star } from 'lucide-react';
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

type DailyRating = {
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

type TeamAlphaTrack = {
  track: 'purchasing' | 'cs_shami' | 'cs_shokry';
  track_label: string;
  branch: string;
};

// فريق دواء ألفا (هبه/هاجر/نور): مسار أسبوعي دوّار — كل واحدة تاخد مسار مختلف كل
// أسبوع (المشتريات / خدمة عملاء الشامي / خدمة عملاء شكري) والدوران بيحصل تلقائيًا
// من قاعدة البيانات (dawaa_team_alpha_my_track_v1)، فمفيش تحديث يدوي مطلوب هنا.
const TEAM_ALPHA_TRACK_TO_CHECKLIST_ROLE: Record<TeamAlphaTrack['track'], string> = {
  purchasing: 'فريق_ألفا_مشتريات',
  cs_shami: 'مسؤول خدمة العملاء',
  cs_shokry: 'مسؤول خدمة العملاء',
};

const TIME_SLOT_ORDER: Record<string, number> = { فتح: 0, 'أثناء اليوم': 1, قفل: 2 };

const STATUS_LABEL: Record<Submission['review_status'], { label: string; color: string; bg: string; borderColor: string }> = {
  pending: { label: 'بانتظار مراجعة المدير', color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  approved: { label: 'معتمد', color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  rejected: { label: 'مرفوض — صحّح البند وأعد الإرسال', color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' },
};

function timeSlotLabel(slot: string) {
  if (slot === 'فتح') return 'الفترة الصباحية';
  if (slot === 'قفل') return 'الفترة الليلية';
  if (slot === 'أثناء اليوم') return 'أثناء يوم العمل';
  return slot || 'خلال يوم العمل';
}

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

function RatingPanel({ title, rating, cycleSummary }: { title: string; rating: DailyRating | null; cycleSummary?: CleaningCycleSummary | null }) {
  return (
    <Panel className="p-4" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)' }}>
      <div className="flex items-center gap-2">
        <Award size={18} style={{ color: 'var(--dawaa-status-warning-text)' }} />
        <h2 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{title}</h2>
      </div>
      {rating ? (
        <>
          <div className="mt-3 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <Star key={value} size={24} className={value <= rating.stars ? 'fill-current' : ''} style={{ color: value <= rating.stars ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-border)' }} />
            ))}
            <span className="mr-2 text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{rating.stars}/5 — {rating.score_pct}%</span>
          </div>
          <p className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
            مكافأة جودة اليوم: {rating.points_delta > 0 ? `+${rating.points_delta}` : 'لا توجد نقاط إضافية'}
          </p>
          <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            أي خصم مرتبط ببند مرفوض يُسجل من البند نفسه فقط، ولا يتكرر بسبب تقييم النجوم.
          </p>
          {rating.manager_note ? <p className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة المدير: {rating.manager_note}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>تقييم اليوم لم يُعتمد بعد.</p>
      )}

      {cycleSummary ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniBox label="متوسط الدورة" value={`${cycleSummary.avg_stars.toFixed(2)}★`} tone="amber" />
            <MiniBox label="متوسط الدرجة" value={`${cycleSummary.avg_score_pct}%`} tone="amber" />
            <MiniBox label="أيام 5 نجوم" value={String(cycleSummary.five_star_days)} tone="amber" />
            <MiniBox label="مكافآت الجودة" value={`${cycleSummary.total_star_points > 0 ? '+' : ''}${cycleSummary.total_star_points}`} tone="amber" />
          </div>
          <p className="mt-3 text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>
            المستوى الحالي: {cycleSummary.performance_band} • {cycleSummary.rated_days} يوم مُقيّم
          </p>
        </>
      ) : null}
    </Panel>
  );
}

export default function StaffDailyChecklist() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const branch = user?.branch || '';
  const canonicalRole = canonicalStaffRole(user?.role);
  const isCleaning = canonicalRole === 'cleaning';
  const isAssistant = canonicalRole === 'assistant';
  const isTeamAlpha = user?.rawRole === 'team_dawaa_alpha';
  const baseStaffRole = isCleaning
    ? 'مسؤولة النظافة'
    : isAssistant
      ? 'مساعد صيدلي'
      : canonicalRole === 'customer_service'
        ? 'مسؤول خدمة العملاء'
        : null;

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [dailyRating, setDailyRating] = useState<DailyRating | null>(null);
  const [cycleSummary, setCycleSummary] = useState<CleaningCycleSummary | null>(null);
  const [teamAlphaTrack, setTeamAlphaTrack] = useState<TeamAlphaTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const today = cairoDateKey();

  // لأعضاء فريق دواء ألفا، المسار الأسبوعي بيحدد قايمة المهام مش الدور العام
  // "مساعد صيدلي" — لحد ما نجيب المسار من السيرفر منستخدمش أي قايمة مهام.
  const staffRole = isTeamAlpha
    ? teamAlphaTrack
      ? TEAM_ALPHA_TRACK_TO_CHECKLIST_ROLE[teamAlphaTrack.track]
      : null
    : baseStaffRole;

  const load = useCallback(async () => {
    let track: TeamAlphaTrack | null = null;
    if (isTeamAlpha && staffId) {
      const trackRes = await supabase.rpc('dawaa_team_alpha_my_track_v1', { p_staff_id: staffId });
      if (trackRes.error) throw trackRes.error;
      track = Array.isArray(trackRes.data) ? (trackRes.data[0] as TeamAlphaTrack) || null : null;
      setTeamAlphaTrack(track);
    }

    const resolvedRole = isTeamAlpha
      ? track
        ? TEAM_ALPHA_TRACK_TO_CHECKLIST_ROLE[track.track]
        : null
      : baseStaffRole;

    if (!resolvedRole) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const checklistItemsQuery = supabase
      .from('staff_daily_checklist_items')
      .select('id, item_key, title, description, time_slot, sort_order, requires_photo')
      .eq('role', resolvedRole)
      .eq('active', true)
      .order('sort_order', { ascending: true });

    const submissionsQuery = staffId
      ? supabase
          .from('staff_daily_checklist_submissions')
          .select('id, item_id, completed, photo_url, review_status, reviewer_note')
          .eq('staff_id', staffId)
          .eq('submission_date', today)
      : Promise.resolve({ data: [] as Submission[] });

    const ratingQuery = !staffId
      ? Promise.resolve({ data: null })
      : isCleaning
        ? supabase
            .from('cleaning_daily_ratings')
            .select('stars, score_pct, points_delta, manager_note')
            .eq('staff_id', staffId)
            .eq('rating_date', today)
            .maybeSingle()
        : isAssistant
          ? supabase
              .from('branch_operations_daily_ratings')
              .select('stars, score_pct, points_delta, manager_note')
              .eq('staff_id', staffId)
              .eq('rating_date', today)
              .maybeSingle()
          : Promise.resolve({ data: null });

    const [itemsRes, subsRes, ratingRes, summaryRes] = await Promise.all([
      checklistItemsQuery,
      submissionsQuery,
      ratingQuery,
      isCleaning && staffId
        ? supabase.rpc('get_cleaning_cycle_rating_summary_v1', { p_staff_id: staffId, p_month_cycle: null })
        : Promise.resolve({ data: [] }),
    ]);

    if ('error' in itemsRes && itemsRes.error) throw itemsRes.error;
    if ('error' in subsRes && subsRes.error) throw subsRes.error;
    if ('error' in ratingRes && ratingRes.error) throw ratingRes.error;
    if ('error' in summaryRes && summaryRes.error) throw summaryRes.error;

    setItems((itemsRes.data || []) as ChecklistItem[]);
    const map: Record<string, Submission> = {};
    ((subsRes.data || []) as Submission[]).forEach((submission) => { map[submission.item_id] = submission; });
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
  }, [isAssistant, isCleaning, isTeamAlpha, staffId, baseStaffRole, today]);

  useEffect(() => {
    void load().catch((error) => {
      console.error('[StaffDailyChecklist] load failed', error);
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل مهام اليوم');
      setLoading(false);
    });
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

  const handleUploadAndComplete = useCallback(async (item: ChecklistItem, file: File | null) => {
    if (!staffId) return;
    setUploadingKey(item.item_key);
    try {
      let photoUrl: string | null = null;
      if (file) {
        const { publicUrl } = await uploadImageToStorage('checklist-evidence', file, `${branch}/${staffId}/${today}/${item.item_key}`);
        photoUrl = publicUrl;
      }
      if (item.requires_photo && !photoUrl) {
        toast.error('المهمة دي لا تُسجل من غير صورة واضحة خاصة بالمكان نفسه.');
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
      toast.success('تم تسجيل المهمة، وهي الآن بانتظار مراجعة مدير الفرع.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حصل خطأ في تسجيل المهمة');
    } finally {
      setUploadingKey(null);
    }
  }, [branch, staffId, today]);

  if (isTeamAlpha && loading && !teamAlphaTrack) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
        <Loader2 size={18} className="animate-spin" />
        جاري تحديد مسارك الأسبوعي...
      </div>
    );
  }

  if (!staffRole) {
    return (
      <div className="p-6 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
        الصفحة دي مخصصة لمسئول النظافة والمساعد ومسئول خدمة العملاء فقط.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>مهامي اليوم — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          نفّذ كل مهمة مسندة لك. في النظافة والرص لازم لكل مكان صورة واضحة ومستقلة، ولو المدير رفض بند صححه وارفع صورة جديدة.
        </p>
      </div>

      {isTeamAlpha && teamAlphaTrack ? (
        <Panel className="p-4" style={{ borderColor: 'var(--dawaa-status-info-border)', background: 'var(--dawaa-status-info-bg)' }}>
          <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
            مسارك هذا الأسبوع: {teamAlphaTrack.track_label}
            {teamAlphaTrack.branch !== 'كل الفروع' ? ` (${teamAlphaTrack.branch})` : ''}
          </p>
          <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            المسار بيتبدل تلقائيًا كل أسبوع بين المشتريات وخدمة عملاء الفرعين.
          </p>
        </Panel>
      ) : null}

      {!loading ? (
        <Panel className="p-4">
          <h2 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>إنجاز مهام اليوم</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniBox label="تم الإرسال" value={`${dailyProgress.submitted}/${items.length}`} />
            <MiniBox label="بانتظار المراجعة" value={String(dailyProgress.pending)} />
            <MiniBox label="معتمد" value={String(dailyProgress.approved)} />
            <MiniBox label="يحتاج تصحيح" value={String(dailyProgress.rejected)} />
          </div>
          {isAssistant ? <p className="mt-3 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>مهام الرص والجزء اليومي من الجرد تظهر فقط في أيام عملك المجدولة.</p> : null}
        </Panel>
      ) : null}

      {(isCleaning || isAssistant) && !loading ? (
        <RatingPanel
          title={isCleaning ? 'تقييم النظافة والتحفيز' : 'تقييم الرص والجرد والتحفيز'}
          rating={dailyRating}
          cycleSummary={isCleaning ? cycleSummary : null}
        />
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : items.length === 0 ? (
        <Panel className="p-5 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          لا توجد مهام مستحقة لك اليوم. يوم الإجازة أو المهمة غير المسندة لا يتحولان إلى تقصير.
        </Panel>
      ) : (
        grouped.map(([slot, slotItems]) => (
          <div key={slot} className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
              <Clock size={14} /> {timeSlotLabel(slot)}
            </h2>
            {slotItems.map((item) => {
              const submission = submissions[item.id];
              const status = submission ? STATUS_LABEL[submission.review_status] : null;
              const canSubmit = !submission?.completed || submission.review_status === 'rejected';
              return (
                <Panel key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.title}</p>
                      {item.description ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.description}</p> : null}
                    </div>
                    {item.requires_photo ? <span className="dawaa-badge text-[10px]">صورة إلزامية</span> : null}
                  </div>

                  {status ? (
                    <div className="mt-3 rounded-xl border p-2 text-xs font-black" style={{ color: status.color, background: status.bg, borderColor: status.borderColor }}>
                      {status.label}
                      {submission?.review_status === 'rejected' && submission.reviewer_note ? (
                        <span className="mt-1 block font-normal">سبب الرفض: {submission.reviewer_note}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {submission?.photo_url ? (
                    <img src={submission.photo_url} alt={item.title} loading="lazy" className="mt-3 h-32 w-full rounded-xl object-cover" />
                  ) : null}

                  {canSubmit ? (
                    <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-text)' }}>
                      {uploadingKey === item.item_key ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <Camera size={16} />
                          {submission?.review_status === 'rejected' ? 'أعد التصوير والتسجيل' : item.requires_photo ? 'صوّر المكان وسجّل' : 'سجّل الإنجاز'}
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingKey === item.item_key}
                        onChange={(event) => void handleUploadAndComplete(item, event.target.files?.[0] || null)}
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
