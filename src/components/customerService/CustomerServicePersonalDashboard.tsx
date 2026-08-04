import { useEffect, useState } from 'react';
import {
  Award, Calendar, ClipboardList, Gift, Heart, MessageCircle, Package,
  Sparkles, Star, TrendingDown, TrendingUp, Trophy, Users, Wand2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';

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
  const [data, setData] = useState<PersonalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branch || !staffName) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const cycle = getPharmacyCycleRange(new Date());
    supabase
      .rpc('get_cs_personal_dashboard', {
        p_branch: branch, p_staff_name: staffName, p_cycle_start: cycle.start, p_cycle_end: cycle.end,
      })
      .then(({ data: rpcData, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) { setError('تعذر تحميل لوحتك الشخصية دلوقتي.'); setLoading(false); return; }
        setData(rpcData as PersonalDashboardData);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [branch, staffName]);

  if (loading) {
    return <div className="rounded-3xl border p-6 text-center text-sm font-bold" style={{ ...card, color: 'var(--dawaa-theme-muted)' }}>جارٍ تحميل لوحتك الشخصية...</div>;
  }
  if (error || !data) {
    return <div className="rounded-3xl border p-6 text-center text-sm font-bold text-rose-300" style={card}>{error || 'لا توجد بيانات كافية بعد.'}</div>;
  }

  const f = data.my_followups;
  const completionRate = f.total_count ? Math.round((f.completed_count / f.total_count) * 100) : 0;
  const tips = generateTips(data, staffName);
  const trend = data.active_customers.trend;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-3xl border p-5" style={{ background: 'linear-gradient(135deg, rgba(244,114,182,0.08), rgba(45,212,191,0.06))', borderColor: 'var(--dawaa-theme-border)' }}>
        <div className="flex items-center gap-2 text-pink-300"><Sparkles size={18} /><span className="text-xs font-black">لوحتي الشخصية</span></div>
        <h2 className="mt-1 text-xl font-black text-white">أهلًا يا {staffName} 🌸</h2>
        <p className="mt-1 text-xs font-bold" style={mutedText}>الدورة الحالية: {data.cycle.start} — {data.cycle.end}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill icon={ClipboardList} label="متابعاتي هذه الدورة" value={f.total_count} accent="#f472b6" />
        <StatPill icon={Award} label="نسبة إنجازي" value={`${completionRate}%`} accent="#2dd4bf" />
        <StatPill icon={Star} label="مراجعاتي للمحادثات" value={data.my_reviews_this_cycle.review_count} accent="#fbbf24" />
        <StatPill icon={Users} label="عملاء نشطون آخر 3 شهور" value={data.active_customers.last_3_months} accent="#38bdf8" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border p-5" style={card}>
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
        <div className="rounded-3xl border p-5" style={card}>
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
        <div className="rounded-3xl border p-5" style={card}>
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
        <div className="rounded-3xl border p-5" style={card}>
          <SectionTitle icon={MessageCircle} accent="#2dd4bf">الرسائل الترحيبية</SectionTitle>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span style={mutedText}>مُرسلة</span><span className="font-black text-white">{data.my_welcome_messages.sent_count}</span></div>
            <div className="flex justify-between"><span style={mutedText}>وصلت</span><span className="font-black text-teal-300">{data.my_welcome_messages.delivered_count}</span></div>
          </div>
        </div>
        <div className="rounded-3xl border p-5" style={card}>
          <SectionTitle icon={Package} accent="#38bdf8">طلبات العملاء</SectionTitle>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span style={mutedText}>سجلتها</span><span className="font-black text-white">{data.my_customer_requests.logged_count}</span></div>
            <div className="flex justify-between"><span style={mutedText}>لسه مفتوحة</span><span className="font-black text-amber-300">{data.my_customer_requests.open_count}</span></div>
          </div>
        </div>
        <div className="rounded-3xl border p-5" style={card}>
          <SectionTitle icon={Gift} accent="#fbbf24">نقاط العملاء (الفرع)</SectionTitle>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span style={mutedText}>مكتسبة</span><span className="font-black text-emerald-300">{data.points_summary.points_earned ?? 0}</span></div>
            <div className="flex justify-between"><span style={mutedText}>مستبدلة</span><span className="font-black text-rose-300">{Math.abs(data.points_summary.points_redeemed ?? 0)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border p-5" style={card}>
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
        <div className="rounded-3xl border p-5" style={card}>
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
