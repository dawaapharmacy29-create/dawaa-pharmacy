import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, ClipboardCheck, Headphones, RefreshCw, Star, Target } from 'lucide-react';
import { fetchMyRequestedFollowups } from '@/lib/api/doctorRequestedFollowups';
import { listStaffNotifications, type StaffNotification } from '@/lib/staffNotificationService';
import { supabase } from '@/lib/supabase';
import CoachingNotesFeed from '@/components/shared/CoachingNotesFeed';

type Row = Record<string, unknown>;
type TabTarget = 'requirements' | 'followups' | 'reviews' | 'notifications' | 'performance';
type SourceKey = 'assignments' | 'followups' | 'notifications' | 'reviews';
type SourceState = 'idle' | 'loading' | 'ready' | 'error';
type FocusTone = 'success' | 'warning' | 'danger' | 'info';

function text(value: unknown) { return String(value ?? '').trim(); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function normalizeName(value: unknown) {
  return text(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '')
    .replace(/[\s/_.-]+/g, ' ')
    .trim()
    .toLowerCase();
}
function isDueToday(value: unknown) {
  if (!value) return false;
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}
function isNearExpiry(row: Row) {
  const raw = text(row.nearest_expiry_date || row.expiry_date);
  if (!raw) return false;
  const days = (new Date(raw).getTime() - Date.now()) / 86400000;
  return Number.isFinite(days) && days <= 30;
}
function matchesDoctor(row: Row, staffId: string, doctorName: string) {
  const idMatch = [row.responsible_doctor_id, row.doctor_id, row.staff_id]
    .map(text)
    .some((value) => Boolean(value) && value === staffId);
  const target = normalizeName(doctorName);
  const nameMatch = [row.responsible_doctor_name, row.responsible_doctor, row.doctor_name, row.staff_name]
    .map(normalizeName)
    .some((value) => Boolean(value) && value === target);
  return idMatch || nameMatch;
}

function initialSources(): Record<SourceKey, SourceState> {
  return { assignments: 'idle', followups: 'idle', notifications: 'idle', reviews: 'idle' };
}

function toneBadge(tone: FocusTone) {
  if (tone === 'danger') return 'dawaa-badge--danger';
  if (tone === 'warning') return 'dawaa-badge--warning';
  if (tone === 'success') return 'dawaa-badge--success';
  return 'dawaa-badge--info';
}

export default function DoctorTodayFocus({
  staffId,
  userId,
  doctorName,
  onNavigate,
}: {
  staffId: string;
  userId: string;
  doctorName: string;
  onNavigate: (tab: TabTarget) => void;
}) {
  const [sources, setSources] = useState<Record<SourceKey, SourceState>>(initialSources);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [followups, setFollowups] = useState<Row[]>([]);
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSources({ assignments: 'loading', followups: 'loading', notifications: 'loading', reviews: 'loading' });
    setReviewCount(null);
    const today = new Date().toISOString().slice(0, 10);

    const settle = (key: SourceKey, state: SourceState) => {
      if (!cancelled) setSources((prev) => ({ ...prev, [key]: state }));
    };

    Promise.all([
      supabase
        .from('stagnant_medicines')
        .select('*')
        .order('nearest_expiry_date', { ascending: true })
        .limit(250),
      supabase
        .from('incentive_medicines')
        .select('*')
        .eq('active', true)
        .order('expiry_date', { ascending: true })
        .limit(250),
    ])
      .then(([stagnantResult, incentiveResult]) => {
        if (cancelled) return;
        if (stagnantResult.error) throw stagnantResult.error;
        if (incentiveResult.error) throw incentiveResult.error;
        const stagnantRows = ((stagnantResult.data || []) as Row[])
          .filter((row) => matchesDoctor(row, staffId, doctorName))
          .filter((row) => num(row.remaining_quantity ?? row.quantity_available ?? row.total_quantity) > 0)
          .map((row) => ({ ...row, requirement_source: 'stagnant' }));
        const incentiveRows = ((incentiveResult.data || []) as Row[])
          .filter((row) => matchesDoctor(row, staffId, doctorName))
          .map((row) => ({ ...row, requirement_source: 'incentive' }));
        setAssignments([...stagnantRows, ...incentiveRows]);
        settle('assignments', 'ready');
      })
      .catch((error) => {
        console.error('[DoctorTodayFocus] requirements failed', error);
        settle('assignments', 'error');
      });

    fetchMyRequestedFollowups({ staffId, userId, doctorName }, { closure: 'open' })
      .then((rows) => {
        if (cancelled) return;
        setFollowups(rows as unknown as Row[]);
        settle('followups', 'ready');
      })
      .catch((error) => {
        console.error('[DoctorTodayFocus] followups failed', error);
        settle('followups', 'error');
      });

    listStaffNotifications(staffId, 80)
      .then((rows) => {
        if (cancelled) return;
        setNotifications(rows);
        settle('notifications', 'ready');
      })
      .catch((error) => {
        console.error('[DoctorTodayFocus] notifications failed', error);
        settle('notifications', 'error');
      });

    const reviewQueries: PromiseLike<{ data: Row[] | null; error: { message?: string } | null }>[] = [];
    if (staffId) {
      reviewQueries.push(
        supabase.from('conversation_sales_reviews').select('id,staff_id,doctor_id,doctor_name,staff_name').eq('staff_id', staffId).gte('created_at', `${today}T00:00:00`).limit(100) as any,
        supabase.from('conversation_sales_reviews').select('id,staff_id,doctor_id,doctor_name,staff_name').eq('doctor_id', staffId).gte('created_at', `${today}T00:00:00`).limit(100) as any,
      );
      void supabase.rpc('get_doctor_today_review_count', { p_doctor_id: staffId }).then(({ data }) => {
        if (!cancelled && typeof data === 'number') setReviewCount((prev) => Math.max(prev ?? 0, data));
      });
    }
    if (doctorName) {
      reviewQueries.push(
        supabase.from('conversation_sales_reviews').select('id,staff_id,doctor_id,doctor_name,staff_name').eq('doctor_name', doctorName).gte('created_at', `${today}T00:00:00`).limit(100) as any,
      );
    }
    Promise.all(reviewQueries.map((query) => Promise.resolve(query)))
      .then((results) => {
        if (cancelled) return;
        const failed = results.find((result) => result.error);
        if (failed?.error) throw new Error(failed.error.message || 'reviews query failed');
        const unique = new Set<string>();
        results.forEach((result) => {
          (result.data || []).forEach((row) => {
            if (matchesDoctor(row, staffId, doctorName)) unique.add(text(row.id) || `${text(row.doctor_name)}-${unique.size}`);
          });
        });
        setReviewCount((prev) => Math.max(prev ?? 0, unique.size));
        settle('reviews', 'ready');
      })
      .catch((error) => {
        console.error('[DoctorTodayFocus] reviews failed', error);
        settle('reviews', 'error');
      });

    return () => { cancelled = true; };
  }, [staffId, userId, doctorName, reloadKey]);

  const loading = Object.values(sources).some((state) => state === 'loading');
  const failedSources = Object.entries(sources).filter(([, state]) => state === 'error').map(([key]) => key as SourceKey);
  const openAssignments = assignments;
  const overdueAssignments = useMemo(() => openAssignments.filter(isNearExpiry), [openAssignments]);
  const dueTodayFollowups = useMemo(() => followups.filter((row) => isDueToday(row.followup_datetime || row.followup_date || row.next_followup_date)), [followups]);
  const unreadNotifications = useMemo(() => notifications.filter((row) => !row.isRead), [notifications]);
  const urgentNotifications = useMemo(() => unreadNotifications.filter((row) => row.priority === 'urgent' || row.priority === 'high'), [unreadNotifications]);

  const sourceValue = (key: SourceKey, value: number) => {
    if (sources[key] === 'loading' || sources[key] === 'idle') return '…';
    if (sources[key] === 'error') return '—';
    return value;
  };
  const sourceNote = (key: SourceKey, readyText: string) => sources[key] === 'error' ? 'تعذر تحميل هذا المصدر — لا يتم اعتباره صفرًا' : readyText;

  const cards = [
    { key: 'requirements' as const, source: 'assignments' as const, title: 'المطلوب المفتوح', value: sourceValue('assignments', openAssignments.length), note: sourceNote('assignments', overdueAssignments.length ? `${overdueAssignments.length} صنف قريب من الانتهاء` : 'الرواكد واللستة المسندة لك'), icon: ClipboardCheck, tone: (overdueAssignments.length ? 'danger' : 'info') as FocusTone },
    { key: 'followups' as const, source: 'followups' as const, title: 'متابعات اليوم', value: sourceValue('followups', dueTodayFollowups.length), note: sourceNote('followups', `${followups.length} متابعة مفتوحة إجمالًا`), icon: Headphones, tone: (dueTodayFollowups.length ? 'warning' : 'info') as FocusTone },
    { key: 'notifications' as const, source: 'notifications' as const, title: 'تنبيهات تحتاج انتباهك', value: sourceValue('notifications', unreadNotifications.length), note: sourceNote('notifications', urgentNotifications.length ? `${urgentNotifications.length} تنبيه مهم` : 'لا توجد تنبيهات عاجلة'), icon: Bell, tone: (urgentNotifications.length ? 'danger' : 'info') as FocusTone },
    { key: 'reviews' as const, source: 'reviews' as const, title: 'تقييمات اليوم', value: sourceValue('reviews', reviewCount || 0), note: sourceNote('reviews', reviewCount ? 'راجع نقاط القوة وفرص التحسين' : 'لا يوجد تقييم جديد اليوم'), icon: Star, tone: 'info' as FocusTone },
  ];

  const allReady = Object.values(sources).every((state) => state === 'ready');
  const nothingUrgent = allReady && !openAssignments.length && !followups.length && !unreadNotifications.length && !reviewCount;

  return (
    <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="dawaa-icon-tile h-9 w-9"><Target size={19} /></div>
            <span className="dawaa-title text-sm">ماذا أفعل اليوم؟</span>
          </div>
          <h2 className="dawaa-title mt-2 text-2xl">أولوياتك اليومية في مكان واحد</h2>
          <p className="dawaa-caption mt-1">
            كل بطاقة تقرأ نفس المصدر الحقيقي الموجود داخل تبويبها؛ تعطل مصدر لا يتحول إلى صفر ولا يوقف باقي البطاقات.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading}
          className="dawaa-button dawaa-button--secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث الأولويات
        </button>
      </div>

      {failedSources.length ? (
        <div className="dawaa-alert dawaa-alert--warning mt-4 text-xs font-bold">
          <AlertTriangle size={16} /> بعض المصادر تعذر تحميلها مؤقتًا؛ الشرطات (—) تعني «غير متاح» وليست صفرًا.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onNavigate(card.key)}
            className={`dawaa-card dawaa-card--interactive p-4 text-right ${sources[card.source] === 'error' ? 'border-dashed opacity-85' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="dawaa-title text-sm">{card.title}</div>
                <div className="dawaa-title mt-2 text-3xl">{card.value}</div>
                <div className="dawaa-caption mt-1 text-xs">{card.note}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="dawaa-icon-tile h-9 w-9"><card.icon size={18} /></div>
                <span className={`dawaa-badge ${toneBadge(card.tone)}`}>
                  {sources[card.source] === 'error' ? 'غير متاح' : card.tone === 'danger' ? 'عاجل' : card.tone === 'warning' ? 'اليوم' : 'متابعة'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {nothingUrgent ? (
        <div className="dawaa-alert dawaa-alert--success mt-4 text-sm font-bold">
          <CheckCircle2 size={18} /> لا توجد عناصر عاجلة مرتبطة بحسابك الآن.
        </div>
      ) : null}
      {sources.assignments === 'ready' && overdueAssignments.length ? (
        <div className="dawaa-alert dawaa-alert--danger mt-4 text-sm font-bold">
          <AlertTriangle size={18} /> لديك أصناف مسندة قريبة من الانتهاء؛ ابدأ بها من تبويب «المطلوب مني».
        </div>
      ) : null}

      {staffId ? (
        <div className="mt-5">
          <h3 className="dawaa-title mb-2 text-sm">ملاحظات موجّهة لك من الإدارة</h3>
          <CoachingNotesFeed scope={{ mode: 'staff', staffId }} limit={10} />
        </div>
      ) : null}
    </section>
  );
}
