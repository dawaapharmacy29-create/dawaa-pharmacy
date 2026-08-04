import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Award, Calendar, ClipboardList, CreditCard, Gift, Heart, MessageCircle, Package,
  Sparkles, Star, TrendingDown, TrendingUp, Trophy, Users, Wand2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';

const WORK_VERSES = [
  'وَقُلِ اعْمَلُوا فَسَيَرَى اللَّهُ عَمَلَكُمْ وَرَسُولُهُ وَالْمُؤْمِنُونَ',
  'إِنَّ اللَّهَ يُحِبُّ إِذَا عَمِلَ أَحَدُكُمْ عَمَلًا أَنْ يُتْقِنَهُ',
  'وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ',
  'فَإِذَا فَرَغْتَ فَانصَبْ',
  'مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ',
  'خَيْرُ النَّاسِ أَنْفَعُهُمْ لِلنَّاسِ',
];

const CONFETTI_COLORS = ['#f472b6', '#2dd4bf', '#fbbf24', '#a78bfa', '#38bdf8', '#fb7185'];

function ConfettiBurst() {
  const pieces = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 0.6,
      duration: 2.2 + Math.random() * 1.6,
      size: 7 + Math.random() * 8,
      rotate: Math.random() * 360,
    })),
    []
  );
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: '1.5rem' }}>
      <style>{`@keyframes csConfettiFall { 0% { transform: translateY(-30px) rotate(0deg); opacity: 1; } 85% { opacity: 1; } 100% { transform: translateY(260px) rotate(420deg); opacity: 0; } }`}</style>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute', top: 0, left: `${p.left}%`, width: p.size, height: p.size * 0.5,
            background: p.color, borderRadius: 2,
            animation: `csConfettiFall ${p.duration}s ease-in ${p.delay}s forwards`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

const QUICK_LINKS = [
  { label: 'متابعة العملاء', icon: ClipboardList, color: '#f472b6', path: '/customer-service' },
  { label: 'تقييم المحادثات', icon: Star, color: '#fbbf24', path: '/reviews' },
  { label: 'رسائل الترحيب', icon: MessageCircle, color: '#2dd4bf', path: '/welcome-messages' },
  { label: 'طلبات العملاء', icon: Package, color: '#38bdf8', path: '/customer-requests' },
  { label: 'نقاط العملاء', icon: Gift, color: '#a78bfa', path: '/customer-points-ledger' },
  { label: 'جدولي', icon: Calendar, color: '#fb7185', path: '/schedule' },
  { label: 'كريدت خدمة العملاء', icon: CreditCard, color: '#22c55e', path: '/customer-service-credit' },
  { label: 'تقييمي الشهري', icon: Award, color: '#eab308', path: '/staff-monthly-evaluation' },
];

const card = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const softCard = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

type FollowupBreakdown = {
  total_count: number; completed_count: number; exceptional_count: number;
  app_assigned_count: number; doctor_requested_count: number; self_initiated_count: number;
};
type NamedCount = { customer_name?: string; doctor_name?: string; followups_count?: number; requests_count?: number };
type DoctorRating = { doctor_name: string; avg_score: number; review_count: number; total_incentive_impact: number };
type TeamRow = { rep_name: string; review_count: number; avg_score_given: number };
type ShiftRow = { shift_date: string; day_name?: string; shift_name?: string; start_time?: string; end_time?: string };

interface PersonalDashboardData {
  cycle: { start: string; end: string };
  my_followups: FollowupBreakdown;
  top_followed_customers: NamedCount[];
  top_doctor_requesters: NamedCount[];
  my_reviews_this_cycle: { review_count: number; avg_score_given: number | null };
  doctor_ratings: DoctorRating[];
  branch_reviews: { branch_avg_score: number | null; branch_review_count: number };
  branch_sales: { invoices: number; total_sales: number };
  points_summary: { points_earned: number | null; points_redeemed: number | null };
  my_welcome_messages: { sent_count: number; delivered_count: number };
  my_customer_requests: { logged_count: number; open_count: number };
  my_upcoming_shifts: ShiftRow[];
  team_ranking: TeamRow[];
  active_customers: { last_3_months: number; previous_3_months: number; trend: number | null };
  recovery_stats: { total_followups: number; recovered_count: number; recovery_rate: number | null };
}

function StatPill({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string | number; accent: string }) {
  return (
    <div className="rounded-2xl border p-4" style={card}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${accent}22`, color: accent }}>
        <Icon size={18} />
      </div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs font-bold" style={mutedText}>{label}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children, accent }: { icon: any; children: any; accent: string }) {
  return (
    <div className="flex items-center gap-2 font-black" style={{ color: accent }}>
      <Icon size={18} /> {children}
    </div>
  );
}

function generateTips(data: PersonalDashboardData, myName: string): string[] {
  const tips: string[] = [];
  const f = data.my_followups;
  if (f.total_count && f.completed_count / f.total_count < 0.6) {
    tips.push('نسبة إنجاز المتابعات أقل من 60% — جرّبي تقفلي المتابعات القديمة الأول قبل ما تفتحي جديد.');
  }
  if (data.active_customers.trend != null && data.active_customers.trend < 0) {
    tips.push(`عدد العملاء النشطين نازل ${Math.abs(data.active_customers.trend)}% عن آخر 3 شهور — ركزي على العملاء المهددين بالتوقف الأول.`);
  }
  if (f.exceptional_count > f.self_initiated_count && f.self_initiated_count === 0) {
    tips.push('كل متابعاتك استثنائية أو مطلوبة من حد تاني — جرّبي تبدئي متابعات بنفسك لعملاء تشوفيهم محتاجين اهتمام.');
  }
  const myRank = data.team_ranking.findIndex((t) => t.rep_name === myName);
  if (myRank === 0 && data.team_ranking.length > 1) {
    tips.push('أنتِ الأولى في عدد التقييمات بين زميلاتك الشهر ده — استمري!');
  }
  if (data.my_customer_requests.open_count > 5) {
    tips.push(`عندك ${data.my_customer_requests.open_count} طلب عميل لسه مفتوح — يستاهل مراجعة سريعة.`);
  }
  if (!tips.length) tips.push('أداءك متوازن الشهر ده — استمري على نفس المستوى.');
  return tips.slice(0, 4);
}

export default function CustomerServicePersonalDashboard({ branch, staffName }: { branch: string; staffName: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<PersonalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [showConfetti] = useState(() => {
    if (typeof window === 'undefined') return false;
    const key = `cs_dashboard_welcomed_${new Date().toISOString().slice(0, 10)}_${staffName}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });

  useEffect(() => {
    if (!branch || !staffName) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    const cycle = getPharmacyCycleRange(new Date());

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setError('اللوحة الشخصية بتاخد وقت أطول من المتوقع. جرّبي تحدّثي الصفحة.');
      setLoading(false);
    }, 15000);

    supabase
      .rpc('get_cs_personal_dashboard', {
        p_branch: branch, p_staff_name: staffName, p_cycle_start: cycle.start, p_cycle_end: cycle.end,
      })
      .then(({ data: rpcData, error: rpcError }) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        if (rpcError) {
          console.error('[CustomerServicePersonalDashboard] rpc error', rpcError);
          setError('تعذر تحميل لوحتك الشخصية دلوقتي.');
          setErrorDetail(rpcError.message || rpcError.code || JSON.stringify(rpcError).slice(0, 200));
          setLoading(false);
          return;
        }
        setData(rpcData as PersonalDashboardData);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        console.error('[CustomerServicePersonalDashboard] rpc rejected', err);
        setError('تعذر تحميل لوحتك الشخصية دلوقتي.');
        setErrorDetail(err instanceof Error ? `${err.name}: ${err.message}` : String(err).slice(0, 200));
        setLoading(false);
      });

    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [branch, staffName, retryKey]);

  if (loading) {
    return <div className="rounded-3xl border p-6 text-center text-sm font-bold" style={{ ...card, color: 'var(--dawaa-theme-muted)' }}>جارٍ تحميل لوحتك الشخصية...</div>;
  }
  if (error || !data) {
    return (
      <div className="rounded-3xl border p-6 text-center" style={card}>
        <p className="text-sm font-bold text-rose-300">{error || 'لا توجد بيانات كافية بعد.'}</p>
        {errorDetail ? (
          <p className="mt-1 break-words font-mono text-[10px]" style={{ color: 'var(--dawaa-theme-muted)' }} dir="ltr">{errorDetail}</p>
        ) : null}
        {error ? (
          <button
            type="button"
            onClick={() => setRetryKey((v) => v + 1)}
            className="mt-3 rounded-xl border px-4 py-2 text-xs font-black text-teal-200"
            style={softCard}
          >
            إعادة المحاولة
          </button>
        ) : null}
      </div>
    );
  }

  const f = data.my_followups;
  const completionRate = f.total_count ? Math.round((f.completed_count / f.total_count) * 100) : 0;
  const tips = generateTips(data, staffName);
  const trend = data.active_customers.trend;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const todaysVerse = WORK_VERSES[dayOfYear % WORK_VERSES.length];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="relative overflow-hidden rounded-3xl border" style={{ background: 'linear-gradient(135deg, rgba(244,114,182,0.1), rgba(45,212,191,0.08))', borderColor: 'var(--dawaa-theme-border)' }}>
        {showConfetti ? <ConfettiBurst /> : null}
        <div className="border-b p-4 text-center" style={{ borderColor: 'rgba(244,114,182,0.2)' }}>
          <div className="flex items-center justify-center gap-2">
            <Sparkles size={18} className="text-pink-300" />
            <span className="text-base font-black leading-relaxed text-white sm:text-lg">{todaysVerse}</span>
            <Sparkles size={18} className="text-pink-300" />
          </div>
        </div>
        <div className="p-5">
          <h2 className="text-xl font-black text-white">أهلًا يا {staffName} 🌸</h2>
          <p className="mt-1 text-xs font-bold" style={mutedText}>الدورة الحالية: {data.cycle.start} — {data.cycle.end}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2.5 sm:gap-3 lg:grid-cols-7">
        {QUICK_LINKS.map((link) => (
          <button
            key={link.path}
            type="button"
            onClick={() => navigate(link.path)}
            className="flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center transition hover:brightness-110 active:scale-95"
            style={{ background: link.color }}
          >
            <link.icon size={28} className="text-white" strokeWidth={2} />
            <span className="text-[11px] font-black leading-tight text-white">{link.label}</span>
          </button>
        ))}
      </div>


      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill icon={ClipboardList} label="متابعاتي هذه الدورة" value={f.total_count} accent="#f472b6" />
        <StatPill icon={Award} label="نسبة إنجازي" value={`${completionRate}%`} accent="#2dd4bf" />
        <StatPill icon={Star} label="مراجعاتي للمحادثات" value={data.my_reviews_this_cycle.review_count} accent="#fbbf24" />
        <StatPill icon={Users} label="عملاء نشطون آخر 3 شهور" value={data.active_customers.last_3_months} accent="#38bdf8" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-pink-400/40" style={card} onClick={() => navigate('/customer-service')}>
          <SectionTitle icon={ClipboardList} accent="#f472b6">تفصيل متابعاتي</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>استثنائية</div><div className="font-black text-white">{f.exceptional_count}</div></div>
            <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>محددة من التطبيق</div><div className="font-black text-white">{f.app_assigned_count}</div></div>
            <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>بطلب من دكتور</div><div className="font-black text-white">{f.doctor_requested_count}</div></div>
            <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>بمبادرتي</div><div className="font-black text-white">{f.self_initiated_count}</div></div>
          </div>
        </div>

        <div className="rounded-3xl border p-5" style={card}>
          <SectionTitle icon={Users} accent="#38bdf8">نشاط العملاء آخر 3 شهور</SectionTitle>
          <div className="mt-3 flex items-center gap-3">
            <div className="text-3xl font-black text-white">{data.active_customers.last_3_months}</div>
            {trend != null ? (
              <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black ${trend >= 0 ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
                {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {Math.abs(trend)}%
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs" style={mutedText}>مقارنة بـ {data.active_customers.previous_3_months} عميل في الـ3 شهور اللي قبلها</p>
        </div>
      </div>

      <div className="rounded-3xl border p-5" style={card}>
        <SectionTitle icon={Heart} accent="#f472b6">فعالية متابعتي للعملاء المهددين بالتوقف</SectionTitle>
        {data.recovery_stats.total_followups > 0 ? (
          <div className="mt-3 flex items-center gap-4">
            <div>
              <div className="text-3xl font-black text-white">{data.recovery_stats.recovery_rate}%</div>
              <p className="mt-1 text-xs" style={mutedText}>نسبة رجوع العملاء للشراء خلال 14 يوم من متابعتي</p>
            </div>
            <div className="text-xs font-bold" style={mutedText}>
              رجع منهم <span className="text-emerald-300">{data.recovery_stats.recovered_count}</span> من أصل <span className="text-white">{data.recovery_stats.total_followups}</span> عميل تابعتهم
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm" style={mutedText}>لسه معنديش متابعات مكتملة لعملاء مهددين بالتوقف في الدورة دي — أول ما تنفذي متابعة هتظهر النتيجة هنا.</p>
        )}
      </div>

      <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-amber-400/40" style={card} onClick={() => navigate('/reviews')}>
        <SectionTitle icon={Trophy} accent="#fbbf24">تقييم وحافز كل دكتور من خدمة العملاء</SectionTitle>
        {data.doctor_ratings.length ? (
          <div className="mt-3 space-y-2">
            {data.doctor_ratings.slice(0, 8).map((d, i) => (
              <div key={d.doctor_name} className="flex items-center justify-between rounded-xl border p-3 text-sm" style={softCard}>
                <div className="flex items-center gap-2">
                  {i === 0 ? <Trophy size={15} className="text-amber-300" /> : <span className="w-4 text-center text-xs" style={mutedText}>{i + 1}</span>}
                  <span className="font-black text-white">{d.doctor_name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs font-bold">
                  <span className="text-amber-200">{d.avg_score}/100 · {d.review_count} مراجعة</span>
                  <span className={d.total_incentive_impact >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{d.total_incentive_impact >= 0 ? '+' : ''}{d.total_incentive_impact} نقطة</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm" style={mutedText}>مفيش بيانات كافية للدورة دي.</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-pink-400/40" style={card} onClick={() => navigate('/customer-service')}>
          <SectionTitle icon={Heart} accent="#f472b6">أكتر العملاء متابعة</SectionTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.top_followed_customers.length
              ? data.top_followed_customers.map((c) => (
                <span key={c.customer_name} className="rounded-full border px-3 py-1 text-xs font-bold text-pink-200" style={{ borderColor: 'rgba(244,114,182,0.3)', background: 'rgba(244,114,182,0.1)' }}>
                  {c.customer_name} · {c.followups_count}
                </span>
              ))
              : <p className="text-sm" style={mutedText}>لا يوجد بعد.</p>}
          </div>
        </div>
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-violet-400/40" style={card} onClick={() => navigate('/customer-service?quickFollowup=1')}>
          <SectionTitle icon={Wand2} accent="#a78bfa">أكتر دكتور بيطلب متابعات</SectionTitle>
          <div className="mt-3 space-y-2">
            {data.top_doctor_requesters.length
              ? data.top_doctor_requesters.map((d) => (
                <div key={d.doctor_name} className="flex items-center justify-between text-sm">
                  <span className="font-bold text-white">{d.doctor_name}</span>
                  <span className="font-black text-violet-300">{d.requests_count} طلب</span>
                </div>
              ))
              : <p className="text-sm" style={mutedText}>لا يوجد بعد.</p>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-teal-400/40" style={card} onClick={() => navigate('/welcome-messages')}>
          <SectionTitle icon={MessageCircle} accent="#2dd4bf">الرسائل الترحيبية</SectionTitle>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span style={mutedText}>مُرسلة</span><span className="font-black text-white">{data.my_welcome_messages.sent_count}</span></div>
            <div className="flex justify-between"><span style={mutedText}>وصلت</span><span className="font-black text-teal-300">{data.my_welcome_messages.delivered_count}</span></div>
          </div>
        </div>
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-sky-400/40" style={card} onClick={() => navigate('/customer-requests')}>
          <SectionTitle icon={Package} accent="#38bdf8">طلبات العملاء</SectionTitle>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span style={mutedText}>سجلتها</span><span className="font-black text-white">{data.my_customer_requests.logged_count}</span></div>
            <div className="flex justify-between"><span style={mutedText}>لسه مفتوحة</span><span className="font-black text-amber-300">{data.my_customer_requests.open_count}</span></div>
          </div>
        </div>
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-amber-400/40" style={card} onClick={() => navigate('/customer-points-ledger')}>
          <SectionTitle icon={Gift} accent="#fbbf24">نقاط العملاء (الفرع)</SectionTitle>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span style={mutedText}>مكتسبة</span><span className="font-black text-emerald-300">{data.points_summary.points_earned ?? 0}</span></div>
            <div className="flex justify-between"><span style={mutedText}>مستبدلة</span><span className="font-black text-rose-300">{Math.abs(data.points_summary.points_redeemed ?? 0)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-pink-400/40" style={card} onClick={() => navigate('/schedule')}>
          <SectionTitle icon={Calendar} accent="#f472b6">جدولي القادم</SectionTitle>
          {data.my_upcoming_shifts.length ? (
            <div className="mt-3 space-y-2 text-sm">
              {data.my_upcoming_shifts.map((s) => (
                <div key={`${s.shift_date}-${s.start_time}`} className="flex justify-between rounded-xl border p-2" style={softCard}>
                  <span className="font-bold text-white">{s.day_name || s.shift_date}</span>
                  <span style={mutedText}>{s.start_time?.slice(0, 5)} — {s.end_time?.slice(0, 5)}</span>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-sm" style={mutedText}>مفيش جدول مسجل قدام حاليًا.</p>}
        </div>
        <div className="rounded-3xl border p-5 cursor-pointer transition hover:border-amber-400/40" style={card} onClick={() => navigate('/reviews')}>
          <SectionTitle icon={Trophy} accent="#fbbf24">ترتيبي بين الزميلات (بعدد المراجعات)</SectionTitle>
          <div className="mt-3 space-y-2 text-sm">
            {data.team_ranking.map((t, i) => (
              <div key={t.rep_name} className={`flex items-center justify-between rounded-xl border p-2 ${t.rep_name === staffName ? 'ring-1 ring-pink-400/40' : ''}`} style={softCard}>
                <span className="flex items-center gap-2 font-bold text-white">{i === 0 ? <Trophy size={14} className="text-amber-300" /> : <span className="w-3.5 text-center text-xs" style={mutedText}>{i + 1}</span>} {t.rep_name}</span>
                <span style={mutedText}>{t.review_count} مراجعة · {t.avg_score_given}/100</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border p-5" style={{ background: 'linear-gradient(135deg, rgba(167,139,250,0.08), rgba(244,114,182,0.06))', borderColor: 'var(--dawaa-theme-border)' }}>
        <SectionTitle icon={Sparkles} accent="#a78bfa">نصايح ذكية ليكي</SectionTitle>
        <ul className="mt-3 space-y-2">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-sm font-bold text-white/90"><span className="mt-1 text-violet-300">•</span>{tip}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
