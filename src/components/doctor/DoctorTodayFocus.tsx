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

    const settle = (key: SourceKey, state: SourceState) => {
      if (!cancelled) setSources((prev) => ({ ...prev, [key]: state }));
    };

    supabase
      .rpc('get_doctor_today_requirements_v1', {
        p_staff_id: staffId,
        p_doctor_name: doctorName || null,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw error;
        setAssignments(Array.isArray(data) ? (data as Row[]) : []);
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

    if (staffId) {
      supabase
        .rpc('get_doctor_today_review_count', { p_doctor_id: staffId })
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) throw error;
          setReviewCount(Number(data || 0));
          settle('reviews', 'ready');
        })
        .catch((error) => {
          console.error('[DoctorTodayFocus] reviews failed', error);
          settle('reviews', 'error');
        });
    } else {
      setReviewCount(0);
      settle('reviews', 'ready');
    }

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
