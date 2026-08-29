import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Save, Search, Send, Star, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { getStaffPointsDashboardV3, type StaffPointsDashboardV3 } from '@/lib/staff/staffPointsDashboardService';
import {
  currentEvaluationCycleLabel,
  previousEvaluationCycleLabel,
  evaluationCycleRangeFromLabel,
  evaluationCycleQueryBounds,
} from '@/lib/evaluations/monthlyEvaluationCycle';
import { Panel, SectionTitle, KpiCard, MiniBox } from '@/components/dashboard/DashboardPrimitives';

type DoctorRow = { id: string; name: string; role?: string | null; branch?: string | null; status?: string | null };
type Section = { key: string; title: string; description: string; weight: number; score: number; notes: string };
type Metrics = { review_count: number; review_average: number; followup_count: number; completed_followups: number };

const DEFAULT_SECTIONS: Section[] = [
  { key: 'service_style', title: 'أسلوب وسرعة خدمة العميل', description: 'الترحيب، سرعة الاستجابة، الاحترام والاحتواء حتى مع ضغط العمل.', weight: 30, score: 0, notes: '' },
  { key: 'need_understanding', title: 'فهم احتياج العميل وإغلاق المحادثة', description: 'فهم الطلب بدقة، تقديم الحل المناسب، التأكد من رضا العميل وإغلاق المحادثة بشكل مهني.', weight: 25, score: 0, notes: '' },
  { key: 'followups_requests', title: 'المتابعات وطلبات العملاء', description: 'تسجيل الطلب والمتابعة في موعدها، تحديث الحالة، وعدم ترك العميل بدون نتيجة واضحة.', weight: 20, score: 0, notes: '' },
  { key: 'complaints_escalation', title: 'الشكاوى والتصعيد', description: 'التعامل الهادئ مع الشكوى، تحمل المسؤولية، والتصعيد السريع عند الحاجة.', weight: 15, score: 0, notes: '' },
  { key: 'team_cooperation', title: 'التعاون مع خدمة العملاء', description: 'الاستجابة لطلبات فريق خدمة العملاء، وضوح المعلومات، وتسليم المتابعة بدون تعطيل.', weight: 10, score: 0, notes: '' },
];

const EMPTY_METRICS: Metrics = { review_count: 0, review_average: 0, followup_count: 0, completed_followups: 0 };

function n(value: unknown) { const x = Number(value || 0); return Number.isFinite(x) ? x : 0; }
function pointsForScore(score: number) {
  if (score >= 95) return 20;
  if (score >= 90) return 10;
  if (score >= 80) return 5;
  if (score >= 70) return 0;
  if (score >= 60) return -5;
  return -10;
}
function grade(score: number) {
  if (score >= 95) return 'ممتاز جدًا';
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  if (score >= 60) return 'مقبول';
  return 'يحتاج تحسين عاجل';
}
function savedSections(value: unknown) {
  if (!Array.isArray(value) || !value.length) return DEFAULT_SECTIONS.map((item) => ({ ...item }));
  const byKey = new Map((value as Record<string, unknown>[]).map((row) => [String(row.key || ''), row]));
  return DEFAULT_SECTIONS.map((item) => {
    const row = byKey.get(item.key);
    return row ? { ...item, score: n(row.score), notes: String(row.notes || '') } : { ...item };
  });
}

export default function CustomerServiceDoctorEvaluation() {
  const { user } = useAuth();
  const [cycleLabel, setCycleLabel] = useState(() => currentEvaluationCycleLabel());
  const cycleRange = useMemo(() => evaluationCycleRangeFromLabel(cycleLabel), [cycleLabel]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [sections, setSections] = useState<Section[]>(DEFAULT_SECTIONS.map((item) => ({ ...item })));
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [points, setPoints] = useState<StaffPointsDashboardV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => doctors.find((item) => item.id === selectedId) || null, [doctors, selectedId]);
  const overallScore = useMemo(() => Math.round(sections.reduce((sum, item) => sum + (item.score / 5) * item.weight, 0) * 10) / 10, [sections]);
  const pointsDelta = pointsForScore(overallScore);
  const estimatedEgp = points?.point_rate_egp == null ? null : Math.round(pointsDelta * points.point_rate_egp * 100) / 100;

  useEffect(() => {
    if (!user?.id) return;
    const loadDoctors = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('list_doctors_for_customer_service_evaluation_safe', { p_actor_id: user.id });
      if (error) { toast.error(error.message); setLoading(false); return; }
      const rows = (data || []) as DoctorRow[];
      setDoctors(rows);
      setSelectedId((current) => current || rows[0]?.id || '');
      setLoading(false);
    };
    void loadDoctors();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !selectedId) return;
    const load = async () => {
      setLoading(true);
      const { startDate, endDateExclusive } = evaluationCycleQueryBounds(cycleLabel);
      const cycleKeyDate = `${cycleLabel}-01`;
      const [savedResult, pointsResult, reviewsResult, followupsResult] = await Promise.all([
        supabase.rpc('get_doctor_customer_service_evaluation_safe', { p_actor_id: user.id, p_doctor_id: selectedId, p_month: cycleKeyDate }),
        getStaffPointsDashboardV3(selectedId, cycleLabel).catch(() => null),
        supabase.from('conversation_sales_reviews').select('total_score,final_score').eq('staff_id', selectedId).gte('created_at', startDate).lt('created_at', endDateExclusive).limit(500),
        supabase.from('daily_followups').select('status,followup_status,completed_at').or(`assigned_staff_id.eq.${selectedId},requested_by_staff_id.eq.${selectedId}`).gte('created_at', startDate).lt('created_at', endDateExclusive).limit(1000),
      ]);
      if (savedResult.error) toast.error(savedResult.error.message);
      const saved = savedResult.data as Record<string, unknown> | null;
      setSections(savedSections(saved?.sections));
      setNotes(String(saved?.notes || ''));
      setStatus(String(saved?.status || 'draft'));
      setPoints(pointsResult);
      const reviewRows = reviewsResult.data || [];
      const followupRows = followupsResult.data || [];
      const avg = reviewRows.length ? reviewRows.reduce((sum, row) => sum + n(row.final_score ?? row.total_score), 0) / reviewRows.length : 0;
      const completed = followupRows.filter((row) => row.completed_at || /completed|مكتمل|تم/i.test(String(row.status || row.followup_status || ''))).length;
      setMetrics({ review_count: reviewRows.length, review_average: Math.round(avg * 10) / 10, followup_count: followupRows.length, completed_followups: completed });
      setLoading(false);
    };
    void load();
  }, [cycleLabel, selectedId, user?.id]);

  function updateSection(key: string, patch: Partial<Section>) {
    setSections((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function save(nextStatus: 'draft' | 'sent') {
    if (!user?.id || !selected) return;
    if (sections.some((item) => item.score < 1)) { toast.error('يجب تقييم كل محاور خدمة العملاء قبل الإرسال.'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('save_doctor_customer_service_evaluation_safe', {
      p_actor_id: user.id,
      p_payload: {
        doctor_id: selected.id,
        evaluation_month: `${cycleLabel}-01`,
        sections,
        metrics_snapshot: metrics,
        overall_score: overallScore,
        notes,
        status: nextStatus,
      },
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    setStatus(nextStatus);
    const refreshed = await getStaffPointsDashboardV3(selected.id, cycleLabel).catch(() => null);
    setPoints(refreshed);
    toast.success(nextStatus === 'sent' ? 'تم اعتماد تقييم خدمة العملاء وإرساله إلى محرك النقاط.' : 'تم حفظ التقييم كمسودة.');
    setSaving(false);
  }

  const filtered = doctors.filter((item) => item.name.includes(search));

  return (
    <div className="min-h-screen space-y-5 p-4" dir="rtl" style={{ background: 'var(--dawaa-theme-bg)' }}>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}><Users style={{ color: 'var(--dawaa-theme-primary-strong)' }} /> تقييم خدمة العملاء للدكاترة</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>تقييم مستقل من جانب خدمة العملاء لدكاترة الفرع فقط. عند الإرسال يتحول إلى نقاط داخل Points V3، ولا ينشئ مبلغ حافز منفصل.</p>
          </div>
          <div className="flex overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <button
              type="button"
              onClick={() => setCycleLabel(previousEvaluationCycleLabel(currentEvaluationCycleLabel()))}
              className="px-3 py-2 text-xs font-black"
              style={cycleLabel === previousEvaluationCycleLabel(currentEvaluationCycleLabel())
                ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                : { color: 'var(--dawaa-theme-muted)' }}
            >
              الدورة السابقة
            </button>
            <button
              type="button"
              onClick={() => setCycleLabel(currentEvaluationCycleLabel())}
              className="px-3 py-2 text-xs font-black"
              style={cycleLabel === currentEvaluationCycleLabel()
                ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                : { color: 'var(--dawaa-theme-muted)' }}
            >
              الدورة الحالية
            </button>
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
          فترة الدورة: {cycleRange.displayLabel}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-3xl border p-4" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
          <div className="relative"><Search className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الدكتور" className="input-dark w-full pr-10" /></div>
          <div className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className="w-full rounded-2xl border p-3 text-right"
                style={selectedId === item.id
                  ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)' }
                  : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
              >
                <div className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.name}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.branch}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-4">
          {loading ? (
            <Panel className="p-10 text-center"><Loader2 className="mx-auto animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /> جاري التحميل...</Panel>
          ) : selected ? <>
            <section className="grid gap-3 md:grid-cols-5">
              <KpiCard title="نتيجة خدمة العملاء" value={`${overallScore}/100`} subtitle="" icon={<Star size={20} />} tone={overallScore >= 80 ? 'green' : overallScore >= 60 ? 'amber' : 'red'} />
              <MiniBox label="التقدير" value={grade(overallScore)} tone="cyan" />
              <MiniBox label="تأثير التقييم على النقاط" value={`${pointsDelta > 0 ? '+' : ''}${pointsDelta} نقطة`} tone={pointsDelta >= 0 ? 'green' : 'red'} />
              <MiniBox label="قيمة النقاط التقريبية" value={estimatedEgp == null ? '—' : `${estimatedEgp > 0 ? '+' : ''}${estimatedEgp.toLocaleString('ar-EG')} ج`} tone="amber" />
              <MiniBox label="الحافز المركزي الحالي (نظام النقاط)" value={points?.final_incentive_egp == null ? '—' : `${points.final_incentive_egp.toLocaleString('ar-EG')} ج`} tone="green" />
            </section>

            <Panel className="p-4">
              <SectionTitle title="مؤشرات مساعدة من خدمة العملاء" />
              <div className="grid gap-2 sm:grid-cols-4">
                <MiniBox label="محادثات مقيمة" value={String(metrics.review_count)} tone="cyan" />
                <MiniBox label="متوسط المحادثات" value={`${metrics.review_average}%`} tone="cyan" />
                <MiniBox label="متابعات" value={String(metrics.followup_count)} tone="cyan" />
                <MiniBox label="متابعات مكتملة" value={String(metrics.completed_followups)} tone="cyan" />
              </div>
            </Panel>

            <Panel className="p-4" style={{ background: 'var(--dawaa-theme-accent-soft)', borderColor: 'var(--dawaa-theme-accent-border)' }}>
              <p className="text-sm font-bold leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>قاعدة التأثير: 95–100 = +20 نقطة، 90–94 = +10، 80–89 = +5، 70–79 = 0، 60–69 = -5، أقل من 60 = -10. القيمة بالجنيه تعتمد على Compensation Profile المركزي للدكتور.</p>
            </Panel>

            <section className="space-y-3">
              {sections.map((item) => (
                <Panel key={item.key} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-3xl">
                      <h3 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.title} <span className="text-xs" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>الوزن {item.weight}%</span></h3>
                      <p className="mt-1 text-xs leading-6" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.description}</p>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button key={score} type="button" onClick={() => updateSection(item.key, { score })} className="rounded-lg p-1">
                          <Star size={27} className={score <= item.score ? 'fill-current' : ''} style={{ color: score <= item.score ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-border)' }} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea value={item.notes} onChange={(event) => updateSection(item.key, { notes: event.target.value })} rows={2} placeholder="ملاحظة على هذا المحور" className="input-dark mt-3 w-full" />
                </Panel>
              ))}
            </section>

            <Panel className="p-4">
              <h3 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>ملاحظات عامة / خطة تحسين</h3>
              <textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} className="input-dark mt-3 w-full" />
            </Panel>

            <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}><CheckCircle2 style={{ color: 'var(--dawaa-theme-primary-strong)' }} size={18} /> الحالة: {status}</div>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void save('draft')} className="btn-secondary inline-flex items-center gap-2"><Save size={16} /> حفظ مسودة</button>
                <button type="button" disabled={saving} onClick={() => void save('sent')} className="btn-primary inline-flex items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} اعتماد وإرسال للنقاط</button>
              </div>
            </Panel>
          </> : <div className="rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>لا يوجد دكاترة متاحون داخل نطاق الفرع.</div>}
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <MiniBox label={label} value={String(value)} tone="cyan" />;
}
