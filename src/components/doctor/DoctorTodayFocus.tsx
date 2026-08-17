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

function text(value: unknown) { return String(value ?? '').trim(); }
function isClosedStatus(value: unknown) { return /closed|completed|resolved|cancelled|مغلق|تم الحل|مكتمل|ملغي/i.test(text(value)); }
function isDueToday(value: unknown) {
  if (!value) return false;
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function initialSources(): Record<SourceKey, SourceState> {
  return { assignments: 'idle', followups: 'idle', notifications: 'idle', reviews: 'idle' };
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

    const assignmentsPromise = staffId
      ? supabase.from('staff_assignments').select('*').eq('assigned_to_staff_id', staffId).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as Row[], error: null });
    Promise.resolve(assignmentsPromise)
      .then((result: any) => {
        if (cancelled) return;
        if (result.error) throw result.error;
        setAssignments((result.data || []) as Row[]);
        settle('assignments', 'ready');
      })
      .catch((error) => {
        console.error('[DoctorTodayFocus] assignments failed', error);
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

    const reviewsPromise = staffId
      ? supabase.from('conversation_sales_reviews').select('id', { count: 'exact', head: true }).eq('staff_id', staffId).gte('created_at', `${today}T00:00:00`)
      : Promise.resolve({ count: 0, error: null });
    Promise.resolve(reviewsPromise)
      .then((result: any) => {
        if (cancelled) return;
        if (result.error) throw result.error;
        setReviewCount(Number(result.count || 0));
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
  const openAssignments = useMemo(() => assignments.filter((row) => !isClosedStatus(row.status)), [assignments]);
  const overdueAssignments = useMemo(() => openAssignments.filter((row) => row.due_at && new Date(text(row.due_at)) < new Date()), [openAssignments]);
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
    { key: 'requirements' as const, source: 'assignments' as const, title: 'المهام المفتوحة', value: sourceValue('assignments', openAssignments.length), note: sourceNote('assignments', overdueAssignments.length ? `${overdueAssignments.length} مهمة متأخرة` : 'لا توجد مهام متأخرة'), icon: ClipboardCheck, tone: overdueAssignments.length ? 'red' : 'teal' },
    { key: 'followups' as const, source: 'followups' as const, title: 'متابعات اليوم', value: sourceValue('followups', dueTodayFollowups.length), note: sourceNote('followups', `${followups.length} متابعة مفتوحة إجمالًا`), icon: Headphones, tone: dueTodayFollowups.length ? 'amber' : 'sky' },
    { key: 'notifications' as const, source: 'notifications' as const, title: 'تنبيهات تحتاج انتباهك', value: sourceValue('notifications', unreadNotifications.length), note: sourceNote('notifications', urgentNotifications.length ? `${urgentNotifications.length} تنبيه مهم` : 'لا توجد تنبيهات عاجلة'), icon: Bell, tone: urgentNotifications.length ? 'red' : 'teal' },
    { key: 'reviews' as const, source: 'reviews' as const, title: 'تقييمات اليوم', value: sourceValue('reviews', reviewCount || 0), note: sourceNote('reviews', reviewCount ? 'راجع نقاط القوة وفرص التحسين' : 'لا يوجد تقييم جديد اليوم'), icon: Star, tone: 'sky' },
  ];

  const toneClass: Record<string, string> = {
    red: 'border-red-400/30 bg-red-500/10 text-red-100',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    teal: 'border-teal-400/30 bg-teal-500/10 text-teal-100',
    sky: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  };

  const allReady = Object.values(sources).every((state) => state === 'ready');
  const nothingUrgent = allReady && !openAssignments.length && !followups.length && !unreadNotifications.length && !reviewCount;

  return <section className="rounded-3xl border border-teal-400/20 bg-slate-900/80 p-5" dir="rtl">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-teal-300"><Target size={20} /><span className="font-black">ماذا أفعل اليوم؟</span></div>
        <h2 className="mt-1 text-2xl font-black text-white">أولوياتك اليومية في مكان واحد</h2>
        <p className="mt-1 text-sm text-slate-400">كل بطاقة لها مصدر مستقل؛ تعطل مصدر لا يحول الرقم إلى صفر ولا يوقف باقي البطاقات.</p>
      </div>
      <button type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading} className="btn-secondary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث الأولويات</button>
    </div>

    {failedSources.length ? <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs font-bold text-amber-100"><AlertTriangle size={16} /> بعض المصادر تعذر تحميلها مؤقتًا؛ الشرطات (—) تعني «غير متاح» وليست صفرًا.</div> : null}

    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <button key={card.key} type="button" onClick={() => onNavigate(card.key)} className={`rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 ${toneClass[card.tone]} ${sources[card.source] === 'error' ? 'border-dashed opacity-85' : ''}`}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black">{card.title}</div><div className="mt-2 text-3xl font-black text-white">{card.value}</div><div className="mt-1 text-xs opacity-80">{card.note}</div></div><card.icon size={22} /></div>
      </button>)}
    </div>

    {nothingUrgent ? <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-100"><CheckCircle2 size={18} /> لا توجد عناصر عاجلة مرتبطة بحسابك الآن.</div> : null}
    {sources.assignments === 'ready' && overdueAssignments.length ? <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm font-bold text-red-100"><AlertTriangle size={18} /> لديك مهام متأخرة؛ ابدأ بها أو أضف تحديثًا واضحًا للمسؤول.</div> : null}

    {staffId ? <div className="mt-5">
      <h3 className="mb-2 text-sm font-black text-slate-300">ملاحظات موجّهة لك من الإدارة</h3>
      <CoachingNotesFeed scope={{ mode: 'staff', staffId }} limit={10} />
    </div> : null}
  </section>;
}
