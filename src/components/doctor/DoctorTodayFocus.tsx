import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, ClipboardCheck, Headphones, RefreshCw, Star, Target } from 'lucide-react';
import { fetchMyRequestedFollowups } from '@/lib/api/doctorRequestedFollowups';
import { listStaffNotifications, type StaffNotification } from '@/lib/staffNotificationService';
import { supabase } from '@/lib/supabase';

type Row = Record<string, unknown>;
type TabTarget = 'requirements' | 'followups' | 'reviews' | 'notifications' | 'performance';

function text(value: unknown) { return String(value ?? '').trim(); }
function isClosedStatus(value: unknown) { return /closed|completed|resolved|cancelled|مغلق|تم الحل|مكتمل|ملغي/i.test(text(value)); }
function isDueToday(value: unknown) {
  if (!value) return false;
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
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
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [followups, setFollowups] = useState<Row[]>([]);
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [reviewCount, setReviewCount] = useState(0);

  const load = async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [assignmentResult, myFollowups, staffNotifications, reviewsByStaff] = await Promise.all([
      staffId
        ? supabase.from('staff_assignments').select('*').eq('assigned_to_staff_id', staffId).order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      fetchMyRequestedFollowups({ staffId, userId, doctorName }, { closure: 'open' }).catch(() => []),
      listStaffNotifications(staffId, 80).catch(() => []),
      staffId
        ? supabase.from('conversation_sales_reviews').select('id', { count: 'exact', head: true }).eq('staff_id', staffId).gte('created_at', `${today}T00:00:00`)
        : Promise.resolve({ count: 0, error: null }),
    ]);
    setAssignments((assignmentResult.data || []) as Row[]);
    setFollowups(myFollowups as unknown as Row[]);
    setNotifications(staffNotifications);
    setReviewCount(Number(reviewsByStaff.count || 0));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [staffId, userId, doctorName]);

  const openAssignments = useMemo(() => assignments.filter((row) => !isClosedStatus(row.status)), [assignments]);
  const overdueAssignments = useMemo(() => openAssignments.filter((row) => row.due_at && new Date(text(row.due_at)) < new Date()), [openAssignments]);
  const dueTodayFollowups = useMemo(() => followups.filter((row) => isDueToday(row.followup_datetime || row.followup_date || row.next_followup_date)), [followups]);
  const unreadNotifications = useMemo(() => notifications.filter((row) => !row.isRead), [notifications]);
  const urgentNotifications = useMemo(() => unreadNotifications.filter((row) => row.priority === 'urgent' || row.priority === 'high'), [unreadNotifications]);

  const cards = [
    { key: 'requirements' as const, title: 'المهام المفتوحة', value: openAssignments.length, note: overdueAssignments.length ? `${overdueAssignments.length} مهمة متأخرة` : 'لا توجد مهام متأخرة', icon: ClipboardCheck, tone: overdueAssignments.length ? 'red' : 'teal' },
    { key: 'followups' as const, title: 'متابعات اليوم', value: dueTodayFollowups.length, note: `${followups.length} متابعة مفتوحة إجمالًا`, icon: Headphones, tone: dueTodayFollowups.length ? 'amber' : 'sky' },
    { key: 'notifications' as const, title: 'تنبيهات تحتاج انتباهك', value: unreadNotifications.length, note: urgentNotifications.length ? `${urgentNotifications.length} تنبيه مهم` : 'لا توجد تنبيهات عاجلة', icon: Bell, tone: urgentNotifications.length ? 'red' : 'teal' },
    { key: 'reviews' as const, title: 'تقييمات اليوم', value: reviewCount, note: reviewCount ? 'راجع نقاط القوة وفرص التحسين' : 'لا يوجد تقييم جديد اليوم', icon: Star, tone: 'sky' },
  ];

  const toneClass: Record<string, string> = {
    red: 'border-red-400/30 bg-red-500/10 text-red-100',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    teal: 'border-teal-400/30 bg-teal-500/10 text-teal-100',
    sky: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  };

  return <section className="rounded-3xl border border-teal-400/20 bg-slate-900/80 p-5" dir="rtl">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-teal-300"><Target size={20} /><span className="font-black">ماذا أفعل اليوم؟</span></div>
        <h2 className="mt-1 text-2xl font-black text-white">أولوياتك اليومية في مكان واحد</h2>
        <p className="mt-1 text-sm text-slate-400">المهام والمتابعات والتقييمات والتنبيهات المرتبطة بحسابك فقط.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث الأولويات</button>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <button key={card.key} type="button" onClick={() => onNavigate(card.key)} className={`rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 ${toneClass[card.tone]}`}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black">{card.title}</div><div className="mt-2 text-3xl font-black text-white">{loading ? '…' : card.value}</div><div className="mt-1 text-xs opacity-80">{card.note}</div></div><card.icon size={22} /></div>
      </button>)}
    </div>

    {!loading && !openAssignments.length && !followups.length && !unreadNotifications.length && !reviewCount ? <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-100"><CheckCircle2 size={18} /> لا توجد عناصر عاجلة مرتبطة بحسابك الآن.</div> : null}
    {!loading && overdueAssignments.length ? <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm font-bold text-red-100"><AlertTriangle size={18} /> لديك مهام متأخرة؛ ابدأ بها أو أضف تحديثًا واضحًا للمسؤول.</div> : null}
  </section>;
}
