import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Award, CheckCircle2, Download, FileText, Loader2, Save, Search, Send, Star, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { canViewAllBranches, isDoctorRole } from '@/lib/security/userDataScope';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';

type StaffRow = { id: string; name: string; role?: string | null; job_title?: string | null; branch?: string | null; status?: string | null; user_id?: string | null };
type Section = { key: string; title: string; description: string; weight: number; score: number; notes: string };
type EvaluationRow = Record<string, any>;

const BASE_SECTIONS: Section[] = [
  { key: 'policies', title: 'الالتزام بالسياسات والسلوك المهني', description: 'الالتزام بسياسات وتعليمات الصيدلية • الحضور والانضباط • الوقوف عند التعامل مع العميل • الالتزام بالزي والنظافة والمظهر المهني • احترام خصوصية العميل والفرع', weight: 15, score: 0, notes: '' },
  { key: 'customer_service', title: 'خدمة العميل وسرعة الاستجابة', description: 'سرعة الرد على العميل • الترحيب والأسلوب المحترم • فهم الطلب وعدم التسرع • حل المشكلة ومتابعة العميل • إنهاء المحادثة بصورة احترافية', weight: 12, score: 0, notes: '' },
  { key: 'dispensing', title: 'دقة صرف الدواء والإرشاد', description: 'دقة صرف الأدوية للعملاء • مراجعة الاسم والتركيز والكمية • شرح الجرعة وطريقة الاستخدام • شرح تاريخ الصلاحية والحفظ • التنبيه على الاحتياطات المهمة والبدائل الآمنة', weight: 15, score: 0, notes: '' },
  { key: 'transactions', title: 'دقة التسجيل والفواتير', description: 'الدقة في تسجيل المشتريات • الدقة في تسجيل فواتير البيع • مراجعة الكميات والأسعار والخصومات • ربط الفاتورة بالعميل الصحيح • منع السهو أو التكرار أو التعديل غير الموثق', weight: 10, score: 0, notes: '' },
  { key: 'requests_followups', title: 'طلبات العملاء والمتابعات', description: 'تسجيل طلبات العملاء والنواقص فورًا • تنفيذ المتابعات المطلوبة • توثيق نتيجة التواصل • تحديد الموعد التالي عند الحاجة • عدم ترك طلب أو متابعة بدون نتيجة واضحة', weight: 8, score: 0, notes: '' },
  { key: 'shift_handover', title: 'تسليم الشيفت وملاحظاته', description: 'الدقة في تسليم الشيفت • مراجعة ملاحظات الشيفتات • تسجيل المشكلات والطلبات المفتوحة • تسليم النقدية والعهدة والمعلومات المهمة • متابعة ما تم استلامه من الشيفت السابق', weight: 10, score: 0, notes: '' },
  { key: 'inventory', title: 'المخزون والنواقص والصلاحية', description: 'التبليغ عن العجز أو الزيادة في الأصناف • متابعة النواقص والرواكد • مراجعة الصلاحية • الدقة في الجرد والترتيب • التصعيد السريع عند وجود مشكلة مخزون', weight: 8, score: 0, notes: '' },
  { key: 'teamwork', title: 'التعاون والتشغيل بين الفرق', description: 'التعامل الجيد مع الفريق • التعاون مع الدليفري • سرعة التعاون مع الفروع والمخزن • تحمل المسؤولية وقت الضغط • احترام الأدوار وعدم تعطيل سير العمل', weight: 8, score: 0, notes: '' },
  { key: 'sales_quality', title: 'جودة البيع وتنمية الفاتورة', description: 'رفع متوسط الفاتورة بصورة مناسبة للعميل • زيادة عدد الأصناف المفيدة في الفاتورة • البيع الإضافي والبدائل بدون ضغط أو تضليل • اكتشاف الاحتياج الكامل • جودة العرض وليس تحقيق تارجت المبيعات', weight: 8, score: 0, notes: '' },
  { key: 'development', title: 'التعلم والتطوير والتحسن', description: 'تقبل الملاحظات • تنفيذ خطة التطوير • حضور التدريب • عدم تكرار الأخطاء • التحسن مقارنة بالشهر السابق • مشاركة المعرفة والمبادرة في التعلم', weight: 6, score: 0, notes: '' },
];

// مديرة خدمة العملاء مش مسؤولة عن البيع أو المخزون، فمعندهاش داعي تتقيّم على بنود
// "الأداء البيعي" أو "التشغيل والمخزون" زي الصيدلي بالظبط. استبدلتهم ببنود تخص
// شغلها الفعلي (جودة المتابعات وإدارة فريق خدمة العملاء)، والوزن الإجمالي لسه 100%.
const CS_MANAGER_SECTIONS: Section[] = [
  { key: 'customer_service', title: 'خدمة العملاء والمحادثات', description: 'الأسلوب، سرعة الرد، فهم الطلب، وحل المشكلات', weight: 25, score: 0, notes: '' },
  { key: 'attendance', title: 'الحضور والانضباط', description: 'الالتزام بالمواعيد، الغياب، الأذونات، والزي', weight: 15, score: 0, notes: '' },
  { key: 'accuracy', title: 'الدقة والمسؤولية المهنية', description: 'دقة تسجيل الطلبات والشكاوى، والتعامل الآمن مع بيانات العملاء', weight: 15, score: 0, notes: '' },
  { key: 'team_management', title: 'إدارة فريق خدمة العملاء', description: 'متابعة أداء الفريق، توزيع المهام، وجودة تقييمات المحادثات الصادرة منها', weight: 15, score: 0, notes: '' },
  { key: 'followups', title: 'المتابعات والمبادرة', description: 'سرعة إغلاق المتابعات، متابعة العملاء، وتنفيذ المهام', weight: 15, score: 0, notes: '' },
  { key: 'teamwork', title: 'التعاون والقيادة', description: 'التعاون مع باقي الفروع والإدارة، وتحمل المسؤولية', weight: 10, score: 0, notes: '' },
  { key: 'development', title: 'التطوير والتعلم', description: 'التدريب، تقبل الملاحظات، وتحسن الأداء', weight: 5, score: 0, notes: '' },
];

function sectionsForRole(role: string): Section[] {
  return (role === 'customer_service_manager' ? CS_MANAGER_SECTIONS : BASE_SECTIONS).map((x) => ({ ...x }));
}

function monthStart(value: string) { return `${value}-01`; }
function nextMonthStart(value: string) { const [year, month] = value.split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); }
function safeNumber(value: unknown) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function gradeFor(score: number) { if (score >= 90) return 'ممتاز'; if (score >= 80) return 'جيد جدًا'; if (score >= 70) return 'جيد'; if (score >= 60) return 'مقبول'; return 'يحتاج خطة تحسين'; }
function incentiveFor(score: number) { if (score >= 95) return 1500; if (score >= 90) return 1350; if (score >= 85) return 1200; if (score >= 80) return 1000; if (score >= 75) return 750; if (score >= 70) return 500; if (score >= 60) return 250; return 0; }
function scoreColor(score: number) { if (score >= 90) return 'text-emerald-300'; if (score >= 75) return 'text-cyan-300'; if (score >= 60) return 'text-amber-300'; return 'text-rose-300'; }
function sectionPoints(item: Section) { return Math.round(((item.score / 5) * item.weight) * 10) / 10; }
function starMeaning(score: number) { return ['', 'ضعيف جدًا', 'يحتاج تحسين', 'مقبول', 'جيد جدًا', 'ممتاز'][score] || 'لم يتم التقييم'; }
function isManager(role: string) { return ['general_manager','executive_manager','branches_manager','branch_manager','branch_manager_shamy','branch_manager_shokry','customer_service_manager'].includes(role); }

export default function StaffMonthlyEvaluation() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const managerMode = isManager(role);
  const selfMode = isDoctorRole(user) && !managerMode;
  const ownBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(role === 'general_manager' || role === 'branches_manager' ? 'فرع الشامي' : ownBranch);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [sections, setSections] = useState<Section[]>(BASE_SECTIONS.map((x) => ({ ...x })));
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [strengths, setStrengths] = useState<string[]>([]);
  const [developmentPoints, setDevelopmentPoints] = useState<string[]>([]);
  const [managerNotes, setManagerNotes] = useState('');
  const [approvedIncentive, setApprovedIncentive] = useState(0);
  const [pointsDelta, setPointsDelta] = useState(0);
  const [status, setStatus] = useState('draft');
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => staff.find((item) => item.id === selectedId) || null, [selectedId, staff]);
  const isEditingSelf = Boolean(selected && (selected.id === user?.staffId || selected.id === user?.id));
  const canEdit = managerMode && !isEditingSelf;
  const overallScore = useMemo(() => Math.round(sections.reduce((sum, item) => sum + (item.score / 5) * item.weight, 0) * 10) / 10, [sections]);
  const suggestedIncentive = incentiveFor(overallScore);
  const grade = gradeFor(overallScore);

  useEffect(() => {
    const loadStaff = async () => {
      setLoading(true);
      try {
        if (!user?.id) throw new Error('الحساب الحالي غير مرتبط بمعرف دخول');
        const { data, error } = await supabase.rpc('list_staff_for_monthly_evaluation_safe', {
          p_actor_id: user.id,
          p_branch: role === 'general_manager' || role === 'branches_manager' ? branch : null,
        });
        if (error) throw error;
        const doctors = ((data || []) as StaffRow[]);
        setStaff(doctors);
        if (selfMode) {
          const own = doctors.find((row) => row.id === user?.staffId || row.name === user?.name);
          setSelectedId(own?.id || '');
        } else if (!selectedId && doctors[0]) setSelectedId(doctors[0].id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'تعذر تحميل دكاترة الفرع');
      } finally { setLoading(false); }
    };
    void loadStaff();
  }, [branch, ownBranch, selfMode, user]);

  useEffect(() => {
    if (!selectedId) return;
    const loadEvaluation = async () => {
      setLoading(true);
      try {
        if (!user?.id) throw new Error('الحساب الحالي غير مرتبط بمعرف دخول');
        const endDate = nextMonthStart(month);
        const [{ data: saved }, reviewResult, followupResult, attendanceResult] = await Promise.all([
          supabase.rpc('get_staff_monthly_evaluation_safe', { p_actor_id: user.id, p_staff_id: selectedId, p_month: monthStart(month) }),
          supabase.from('conversation_sales_reviews').select('total_score,final_score,doctor_points_impact,point_impact,created_at').eq('staff_id', selectedId).gte('created_at', monthStart(month)).lt('created_at', endDate).limit(500),
          supabase.from('daily_followups').select('status,followup_status,completed_at,created_at,assigned_staff_id,requested_by_staff_id').or(`assigned_staff_id.eq.${selectedId},requested_by_staff_id.eq.${selectedId}`).gte('created_at', monthStart(month)).lt('created_at', endDate).limit(1000),
          readAttendanceRange({
            staffId: selectedId,
            startDate: monthStart(month),
            endDateExclusive: endDate,
            limit: 100,
          }),
        ]);
        const reviewRows = reviewResult.data || [];
        const followupRows = followupResult.data || [];
        if (attendanceResult.status === 'unavailable') throw new Error(attendanceResult.error);
        const attendanceRows = attendanceResult.rows;
        const reviewAverage = reviewRows.length ? reviewRows.reduce((s: number, r: any) => s + safeNumber(r.final_score || r.total_score), 0) / reviewRows.length : 0;
        const completedFollowups = followupRows.filter((r: any) => r.completed_at || /completed|مكتمل|تم/.test(String(r.status || r.followup_status || ''))).length;
        const reviewImpacts = reviewRows.map((r: any) => safeNumber(r.doctor_points_impact ?? r.point_impact));
        const positivePoints = reviewImpacts.filter((value: number) => value > 0).reduce((sum: number, value: number) => sum + value, 0);
        const negativePoints = reviewImpacts.filter((value: number) => value < 0).reduce((sum: number, value: number) => sum + Math.abs(value), 0);
        const presentDays = attendanceRows.filter((r: any) => /present|حاضر|late|متأخر/i.test(String(r.status || ''))).length;
        setMetrics({ review_count: reviewRows.length, review_average: Math.round(reviewAverage * 10) / 10, completed_followups: completedFollowups, followup_count: followupRows.length, positive_points: positivePoints, negative_points: negativePoints, attendance_days: attendanceRows.length, present_days: presentDays });
        if (saved) {
          const row = saved as EvaluationRow;
          setEvaluationId(row.id);
          setSections(Array.isArray(row.sections) ? row.sections : BASE_SECTIONS.map((x) => ({ ...x })));
          setStrengths(row.strengths || []);
          setDevelopmentPoints(row.development_points || []);
          setManagerNotes(row.manager_notes || '');
          setApprovedIncentive(safeNumber(row.approved_incentive));
          setPointsDelta(safeNumber(row.points_delta));
          setStatus(row.status || 'draft');
        } else {
          setEvaluationId(null); setSections(sectionsForRole(normalizeRole(selected?.role))); setStrengths([]); setDevelopmentPoints([]); setManagerNotes(''); setApprovedIncentive(0); setPointsDelta(0); setStatus('draft');
        }
      } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحميل التقييم'); }
      finally { setLoading(false); }
    };
    void loadEvaluation();
  }, [month, selectedId]);

  const updateSection = (key: string, patch: Partial<Section>) => setSections((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  const toggleTag = (value: string, setter: Dispatch<SetStateAction<string[]>>) => setter((current) => current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);

  async function save(nextStatus = status) {
    if (!selected) return;
    if (isEditingSelf) { toast.error('لا يمكنك اعتماد أو تعديل تقييمك الشهري لنفسك.'); return; }
    if (managerMode && sections.some((item) => item.score === 0)) { toast.error('يجب تقييم كل المحاور قبل الاعتماد'); return; }
    setSaving(true);
    try {
      const payload = {
        staff_id: selected.id, staff_name: selected.name, staff_role: selected.job_title || selected.role, branch: selected.branch || branch,
        evaluation_month: monthStart(month), evaluator_id: user?.id || null, evaluator_name: user?.name || 'مدير الفرع', evaluator_role: user?.role || null,
        sections, metrics_snapshot: metrics, strengths, development_points: developmentPoints, manager_notes: managerNotes,
        overall_score: overallScore, grade, suggested_incentive: suggestedIncentive, approved_incentive: approvedIncentive,
        points_delta: pointsDelta, status: nextStatus, sent_at: nextStatus === 'sent' ? new Date().toISOString() : null,
      };
      const { data, error } = await supabase.rpc('save_staff_monthly_evaluation_safe', { p_actor_id: user?.id, p_payload: payload });
      if (error) throw error;
      setEvaluationId(String(data)); setStatus(nextStatus);
      if (nextStatus === 'sent') {
        await createStaffNotification({
          recipientStaffId: selected.id,
          title: 'تم إرسال تقييمك الشهري',
          message: `تقييم شهر ${month}: ${overallScore}/100 - ${grade}`,
          type: 'staff_monthly_evaluation',
          entityType: 'staff_monthly_evaluation',
          entityId: String(data),
          actionUrl: '/staff-dashboard',
        }).catch(() => null);
      }
      toast.success(nextStatus === 'sent' ? 'تم إرسال التقييم للموظف' : 'تم حفظ التقييم');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'فشل حفظ التقييم'); }
    finally { setSaving(false); }
  }

  async function downloadPdf() {
    if (!printRef.current || !selected) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const pages = Array.from(printRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    if (!pages.length) return;
    const pdf = new jsPDF('p', 'mm', 'a4');
    for (let index = 0; index < pages.length; index += 1) {
      const canvas = await html2canvas(pages[index], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const image = canvas.toDataURL('image/png');
      if (index > 0) pdf.addPage();
      pdf.addImage(image, 'PNG', 0, 0, 210, 297);
    }
    const safeName = selected.name.replace(/[/:*?"<>|]/g, '-');
    pdf.save(`تقييم-تطوير-${safeName}-${month}.pdf`);
    toast.success('تم إصدار تقرير التقييم التفصيلي');
  }

  const filteredStaff = staff.filter((item) => item.name.includes(search));
  const strengthOptions = ['ملتزم بالسياسات','مظهر مهني ممتاز','خدمة عميل ممتازة','سريع الاستجابة','دقيق في صرف الدواء','دقيق في الفواتير','يسجل الطلبات والمتابعات','يسلم الشيفت بدقة','متعاون مع الفريق والدليفري','مبادر في حل المشكلات','يطور متوسط الفاتورة باحتراف','سريع التعلم ويتحسن'];
  const developmentOptions = ['الالتزام بالسياسات والتعليمات','الالتزام بالوقوف والزي','تحسين سرعة الرد','تقليل أخطاء الصرف','تحسين شرح الجرعة والصلاحية','زيادة دقة تسجيل المشتريات','زيادة دقة فواتير البيع','تسجيل طلبات العملاء فورًا','تحسين تسليم الشيفت','متابعة ملاحظات الشيفتات','تحسين التعاون مع الدليفري','تحسين التعاون مع الفروع والمخزن','رفع متوسط الفاتورة','زيادة عدد الأصناف المناسبة','منع تكرار الأخطاء'];

  return <div className="min-h-screen space-y-5 bg-slate-950 p-4 text-white" dir="rtl">
    <section className="rounded-3xl border border-cyan-300/20 bg-gradient-to-l from-cyan-950/50 to-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-black"><UserCheck className="text-cyan-300"/> تقييم الدكاترة الشهري</h1><p className="mt-2 text-sm font-bold text-slate-300">نموذج تطوير وتشغيل موحّد بقيمة حافز قصوى 1500 جنيه، مستقل تمامًا عن حافز تارجت المبيعات.</p></div><div className="flex gap-2"><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} className="input-dark"/>{managerMode && canViewAllBranches(user) ? <select value={branch} onChange={(e)=>setBranch(e.target.value)} className="input-dark"><option>فرع الشامي</option><option>فرع شكري</option></select> : null}</div></div>
    </section>

    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
        <div className="relative"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث باسم الدكتور" className="input-dark w-full pr-10"/></div>
        <div className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto">{filteredStaff.map((item)=><button key={item.id} onClick={()=>setSelectedId(item.id)} className={`w-full rounded-2xl border p-3 text-right ${selectedId===item.id?'border-cyan-300/60 bg-cyan-400/15':'border-white/10 bg-white/[0.03]'}`}><div className="font-black">{item.name}</div><div className="mt-1 text-xs text-slate-400">{item.job_title || item.role} · {item.branch}</div></button>)}</div>
      </aside>

      <main className="space-y-4">
        {loading ? <div className="rounded-3xl border border-white/10 p-10 text-center"><Loader2 className="mx-auto animate-spin"/> جاري التحميل...</div> : selected ? <>
          <section className="grid gap-3 md:grid-cols-4"><div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">النتيجة</div><div className={`mt-1 text-3xl font-black ${scoreColor(overallScore)}`}>{overallScore}/100</div></div><div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">التقدير</div><div className="mt-1 text-xl font-black">{grade}</div></div><div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">الحافز المقترح</div><div className="mt-1 text-xl font-black text-emerald-300">{suggestedIncentive.toLocaleString('ar-EG')} جنيه</div></div><div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">الحالة</div><div className="mt-1 text-xl font-black">{status}</div></div></section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><h2 className="font-black">ملخص البيانات الفعلية</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(metrics).map(([key,value])=><div key={key} className="rounded-xl bg-white/[0.04] p-3 text-sm font-bold"><span className="text-slate-400">{key.replaceAll('_',' ')}:</span> {value}</div>)}</div></section>

          <section className="rounded-3xl border border-amber-300/25 bg-amber-500/5 p-4"><h2 className="font-black text-amber-200">سياسة التقييم والحافز</h2><p className="mt-2 text-sm leading-7 text-slate-300">هذا التقييم هدفه التعليم والتطوير ورفع جودة تشغيل الفرع بالكامل. حافز الـ1500 جنيه مستقل عن تارجت المبيعات. يتم تقييم كل محور من 1 إلى 5، وتُحسب نقاطه حسب وزنه. يجب كتابة ملاحظة واضحة عند منح 1 أو 2 نجمة، وتحديد خطوة تطوير قابلة للقياس للشهر التالي. الأخطاء الجسيمة في صرف الدواء أو التلاعب في الفواتير تستوجب مراجعة إدارية مستقلة ولا يعوضها ارتفاع باقي الدرجات.</p></section>

          <section className="space-y-3">{sections.map((item)=>{ const earned = sectionPoints(item); return <article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">الوزن: {item.weight} نقطة</span></h3><p className="mt-1 text-xs text-slate-400">{item.description}</p></div><div className="min-w-[230px]"><div className="flex justify-end gap-1">{[1,2,3,4,5].map((score)=><button type="button" aria-label={`اختيار ${score} نجوم`} disabled={!canEdit} key={score} onClick={()=>updateSection(item.key,{score})} className="rounded-lg p-1 transition hover:bg-amber-400/10 disabled:cursor-default"><Star className={score<=item.score?'fill-amber-400 text-amber-400':'text-slate-600'} size={27}/></button>)}</div><div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-center text-sm font-black text-cyan-100">{item.score ? `${item.score} نجوم — ${starMeaning(item.score)} — ${earned} من ${item.weight}` : `لم يتم التقييم — 0 من ${item.weight}`}</div></div></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-white/[0.04] p-3 text-center"><div className="text-[11px] text-slate-400">عدد النجوم</div><div className="mt-1 font-black">{item.score}/5</div></div><div className="rounded-xl bg-white/[0.04] p-3 text-center"><div className="text-[11px] text-slate-400">الوزن</div><div className="mt-1 font-black">{item.weight} نقطة</div></div><div className="rounded-xl bg-emerald-400/10 p-3 text-center"><div className="text-[11px] text-emerald-200">الدرجة المكتسبة</div><div className="mt-1 font-black text-emerald-200">{earned} من {item.weight}</div></div></div><textarea disabled={!canEdit} value={item.notes} onChange={(e)=>updateSection(item.key,{notes:e.target.value})} placeholder="ملاحظات مدير الفرع على هذا المحور — اذكر مثالًا أو نتيجة فعلية" className="input-dark mt-3 min-h-20 w-full"/></article>})}</section>

          <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-3xl border border-emerald-300/20 bg-emerald-500/5 p-4"><h3 className="font-black text-emerald-200">نقاط القوة</h3><div className="mt-3 flex flex-wrap gap-2">{strengthOptions.map((x)=><button disabled={!canEdit} key={x} onClick={()=>toggleTag(x,setStrengths)} className={`rounded-full border px-3 py-2 text-xs font-bold ${strengths.includes(x)?'border-emerald-300 bg-emerald-500/20':'border-white/10'}`}>{x}</button>)}</div></div><div className="rounded-3xl border border-amber-300/20 bg-amber-500/5 p-4"><h3 className="font-black text-amber-200">نقاط التطوير</h3><div className="mt-3 flex flex-wrap gap-2">{developmentOptions.map((x)=><button disabled={!canEdit} key={x} onClick={()=>toggleTag(x,setDevelopmentPoints)} className={`rounded-full border px-3 py-2 text-xs font-bold ${developmentPoints.includes(x)?'border-amber-300 bg-amber-500/20':'border-white/10'}`}>{x}</button>)}</div></div></section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><label className="font-black">التقييم النهائي وخطة الشهر القادم</label><textarea disabled={!canEdit} value={managerNotes} onChange={(e)=>setManagerNotes(e.target.value)} className="input-dark mt-3 min-h-28 w-full" placeholder="ملخص واضح للدكتور: ما الذي تميز فيه؟ وما المطلوب منه الشهر القادم؟"/>{canEdit ? <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm font-bold">الحافز المعتمد<input type="number" value={approvedIncentive} onChange={(e)=>setApprovedIncentive(Number(e.target.value))} className="input-dark mt-1 w-full"/><span className="mt-1 block text-[11px] font-normal text-amber-300">الرقم ده بقى بيتصرف فعليًا للدكتور بمجرد الاعتماد أو الإرسال — مش عرض بس.</span>{approvedIncentive !== suggestedIncentive ? <button type="button" onClick={()=>setApprovedIncentive(suggestedIncentive)} className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-black text-emerald-300"><CheckCircle2 size={14}/> اعتمد الحافز المقترح ({suggestedIncentive.toLocaleString('ar-EG')} ج)</button> : null}</label><label className="text-sm font-bold">تعديل النقاط<input type="number" value={pointsDelta} onChange={(e)=>setPointsDelta(Number(e.target.value))} className="input-dark mt-1 w-full"/></label></div> : null}</section>

          <div className="flex flex-wrap gap-2">{canEdit ? <><button disabled={saving} onClick={()=>void save('draft')} className="btn-secondary flex items-center gap-2"><Save size={17}/> حفظ مسودة</button><button disabled={saving} onClick={()=>void save('approved')} className="rounded-xl bg-cyan-600 px-4 py-2 font-black"><CheckCircle2 className="ml-1 inline" size={17}/> اعتماد التقييم</button><button disabled={saving} onClick={()=>void save('sent')} className="rounded-xl bg-emerald-600 px-4 py-2 font-black"><Send className="ml-1 inline" size={17}/> إرسال للموظف</button></> : null}<button onClick={()=>void downloadPdf()} className="rounded-xl bg-amber-500 px-4 py-2 font-black text-slate-950"><Download className="ml-1 inline" size={17}/> إصدار PDF</button></div>

          <div ref={printRef} className="fixed -left-[10000px] top-0 w-[794px] bg-white text-slate-900" dir="rtl">
            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-5 text-center">
                <h1 className="text-[28px] font-black text-slate-900">صيدليات دواء</h1>
                <p className="mt-2 text-[21px] font-black text-slate-800">تقرير التقييم والتطوير الشهري</p>
                <p className="mt-3 text-[16px] font-bold text-slate-600">{selected.name} — {selected.branch} — {month}</p>
                <p className="mt-2 text-[12px] font-bold text-teal-700">حافز تطوير وتشغيل مستقل تمامًا عن تارجت المبيعات</p>
              </header>

              <div className="mt-6 grid grid-cols-4 gap-3 text-center">
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">النتيجة</div><div className="mt-2 text-[24px] font-black text-slate-900">{overallScore}/100</div></div>
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">التقدير</div><div className="mt-2 text-[20px] font-black text-slate-900">{grade}</div></div>
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">الحافز المقترح</div><div className="mt-2 text-[20px] font-black text-teal-700">{suggestedIncentive.toLocaleString('ar-EG')} ج</div></div>
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">الحافز المعتمد</div><div className="mt-2 text-[20px] font-black text-slate-900">{approvedIncentive.toLocaleString('ar-EG')} ج</div></div>
              </div>

              <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-5">
                <h2 className="text-[18px] font-black text-slate-900">هدف التقييم</h2>
                <p className="mt-2 text-[13px] leading-7 text-slate-700">تحسين أداء الدكتور وتطوير الفريق والفرع، ورفع جودة الخدمة والدقة والتعاون والالتزام. هذا الحافز لا يعتمد على تحقيق تارجت المبيعات، لأن تارجت المبيعات له نظام وحافز منفصل.</p>
              </div>

              <h2 className="mt-7 text-[18px] font-black text-slate-900">ملخص المحاور والأوزان</h2>
              <table className="mt-3 w-full table-fixed border-collapse text-[11px]">
                <thead><tr className="bg-slate-800 text-white"><th className="w-[38%] border border-slate-500 p-2">المحور</th><th className="w-[12%] border border-slate-500 p-2">الوزن</th><th className="w-[14%] border border-slate-500 p-2">التقييم</th><th className="w-[14%] border border-slate-500 p-2">النقاط</th><th className="w-[22%] border border-slate-500 p-2">الملاحظة المختصرة</th></tr></thead>
                <tbody>{sections.map((x,index)=><tr key={x.key} className={index%2===0?'bg-white':'bg-slate-50'}><td className="border border-slate-300 p-2 font-bold">{x.title}</td><td className="border border-slate-300 p-2 text-center">{x.weight}%</td><td className="border border-slate-300 p-2 text-center">{x.score}/5</td><td className="border border-slate-300 p-2 text-center font-black">{Math.round((x.score/5)*x.weight*10)/10}</td><td className="border border-slate-300 p-2 text-[10px] leading-5">{x.notes || '—'}</td></tr>)}</tbody>
                <tfoot><tr className="bg-slate-100 font-black"><td className="border border-slate-300 p-2" colSpan={3}>الإجمالي النهائي</td><td className="border border-slate-300 p-2 text-center">{overallScore}/100</td><td className="border border-slate-300 p-2"></td></tr></tfoot>
              </table>

              <footer className="mt-6 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>صيدليات دواء — تقرير داخلي للتطوير</span><span>صفحة 1 من 4</span></footer>
            </section>

            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-4"><h2 className="text-[24px] font-black text-slate-900">تفاصيل محاور التقييم — الجزء الأول</h2><p className="mt-2 text-[13px] font-bold text-slate-500">{selected.name} — {month}</p></header>
              <div className="mt-6 space-y-4">{sections.slice(0,5).map((x)=><article key={x.key} className="rounded-xl border border-slate-300 bg-white p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="text-[17px] font-black text-slate-900">{x.title}</h3><p className="mt-2 text-[11px] leading-6 text-slate-600">{x.description}</p></div><div className="shrink-0 rounded-lg bg-teal-50 px-4 py-3 text-center"><div className="text-[11px] font-bold text-teal-800">{x.weight}%</div><div className="mt-1 text-[18px] font-black text-slate-900">{x.score}/5</div><div className="mt-1 text-[10px] text-slate-500">{Math.round((x.score/5)*x.weight*10)/10} نقطة</div></div></div><div className="mt-3 border-t border-slate-200 pt-3"><div className="text-[11px] font-black text-slate-700">ملاحظات المدير</div><p className="mt-1 min-h-[28px] text-[11px] leading-6 text-slate-600">{x.notes || 'لا توجد ملاحظات مسجلة.'}</p></div></article>)}</div>
              <footer className="mt-5 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>تفاصيل المحاور 1–5</span><span>صفحة 2 من 4</span></footer>
            </section>

            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-4"><h2 className="text-[24px] font-black text-slate-900">تفاصيل محاور التقييم — الجزء الثاني</h2><p className="mt-2 text-[13px] font-bold text-slate-500">{selected.name} — {month}</p></header>
              <div className="mt-6 space-y-4">{sections.slice(5,10).map((x)=><article key={x.key} className="rounded-xl border border-slate-300 bg-white p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="text-[17px] font-black text-slate-900">{x.title}</h3><p className="mt-2 text-[11px] leading-6 text-slate-600">{x.description}</p></div><div className="shrink-0 rounded-lg bg-teal-50 px-4 py-3 text-center"><div className="text-[11px] font-bold text-teal-800">{x.weight}%</div><div className="mt-1 text-[18px] font-black text-slate-900">{x.score}/5</div><div className="mt-1 text-[10px] text-slate-500">{Math.round((x.score/5)*x.weight*10)/10} نقطة</div></div></div><div className="mt-3 border-t border-slate-200 pt-3"><div className="text-[11px] font-black text-slate-700">ملاحظات المدير</div><p className="mt-1 min-h-[28px] text-[11px] leading-6 text-slate-600">{x.notes || 'لا توجد ملاحظات مسجلة.'}</p></div></article>)}</div>
              <footer className="mt-5 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>تفاصيل المحاور 6–10</span><span>صفحة 3 من 4</span></footer>
            </section>

            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-4"><h2 className="text-[24px] font-black text-slate-900">خطة التطوير والاعتماد</h2><p className="mt-2 text-[13px] font-bold text-slate-500">{selected.name} — {selected.branch} — {month}</p></header>
              <div className="mt-6 grid grid-cols-2 gap-4"><div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5"><h3 className="text-[17px] font-black text-emerald-900">نقاط القوة</h3><p className="mt-3 text-[12px] leading-7 text-slate-700">{strengths.join('، ') || 'لم يتم تحديد نقاط قوة.'}</p></div><div className="rounded-xl border border-amber-300 bg-amber-50 p-5"><h3 className="text-[17px] font-black text-amber-900">نقاط التطوير</h3><p className="mt-3 text-[12px] leading-7 text-slate-700">{developmentPoints.join('، ') || 'لم يتم تحديد نقاط تطوير.'}</p></div></div>
              <div className="mt-5 rounded-xl border border-slate-300 p-5"><h3 className="text-[17px] font-black text-slate-900">خطة الشهر القادم وملاحظات المدير</h3><p className="mt-3 min-h-[110px] whitespace-pre-wrap text-[12px] leading-7 text-slate-700">{managerNotes || 'لا توجد ملاحظات مسجلة.'}</p></div>
              <div className="mt-5 rounded-xl border border-slate-300 p-5"><h3 className="text-[17px] font-black text-slate-900">مؤشرات مساندة من التطبيق</h3><div className="mt-4 grid grid-cols-4 gap-3 text-center">{Object.entries(metrics).map(([key,value])=>{ const labels: Record<string,string> = { review_count:'عدد تقييمات المحادثات', review_average:'متوسط تقييم المحادثات', completed_followups:'المتابعات المكتملة', followup_count:'إجمالي المتابعات', positive_points:'النقاط الموجبة', negative_points:'النقاط السالبة', attendance_days:'أيام الحضور المسجلة', present_days:'أيام الالتزام' }; return <div key={key} className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold leading-4 text-slate-500">{labels[key] || key}</div><div className="mt-2 text-[18px] font-black text-slate-900">{value}</div></div>})}</div></div>
              <div className="mt-5 rounded-xl border border-teal-300 bg-teal-50 p-5"><h3 className="text-[16px] font-black text-teal-900">سياسة الحافز التطويري</h3><p className="mt-2 text-[11px] leading-6 text-slate-700">95–100 = 1500 ج، 90–94 = 1350 ج، 85–89 = 1200 ج، 80–84 = 1000 ج، 75–79 = 750 ج، 70–74 = 500 ج، 60–69 = 250 ج، وأقل من 60 بدون حافز مع خطة تحسين. الأخطاء الجسيمة تخضع لمراجعة إدارية مستقلة.</p></div>
              <div className="mt-12 flex justify-between text-[13px] font-bold text-slate-700"><span>توقيع مدير الفرع: __________________</span><span>توقيع الموظف: __________________</span></div>
              <footer className="mt-10 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>خطة التطوير والاعتماد</span><span>صفحة 4 من 4</span></footer>
            </section>
          </div>
        </> : <div className="rounded-3xl border border-dashed border-white/15 p-12 text-center text-slate-400"><FileText className="mx-auto mb-3"/> اختر دكتورًا لبدء التقييم</div>}
      </main>
    </div>
  </div>;
}
