import { useEffect, useMemo, useRef, useState } from 'react';
import { Award, CheckCircle2, Download, FileText, Loader2, Save, Search, Send, Star, UserCheck } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { canViewAllBranches, isDoctorRole } from '@/lib/security/userDataScope';

type StaffRow = { id: string; name: string; role?: string | null; job_title?: string | null; branch?: string | null; status?: string | null; user_id?: string | null };
type Section = { key: string; title: string; description: string; weight: number; score: number; notes: string };
type EvaluationRow = Record<string, any>;

const BASE_SECTIONS: Section[] = [
  { key: 'sales', title: 'الأداء البيعي وتحقيق الهدف', description: 'المبيعات، متوسط الفاتورة، جودة البيع، وربط العملاء', weight: 20, score: 0, notes: '' },
  { key: 'customer_service', title: 'خدمة العملاء والمحادثات', description: 'الأسلوب، سرعة الرد، فهم الطلب، وحل المشكلات', weight: 15, score: 0, notes: '' },
  { key: 'attendance', title: 'الحضور والانضباط', description: 'الالتزام بالمواعيد، الغياب، الأذونات، والزي', weight: 15, score: 0, notes: '' },
  { key: 'accuracy', title: 'الدقة والمسؤولية المهنية', description: 'أخطاء الصرف، مراجعة الروشتات، والتعامل الآمن', weight: 15, score: 0, notes: '' },
  { key: 'operations', title: 'التشغيل والمخزون', description: 'النواقص، الرواكد، الصلاحية، الجرد، وترتيب الفرع', weight: 10, score: 0, notes: '' },
  { key: 'followups', title: 'المتابعات والمبادرة', description: 'طلبات المتابعة، متابعة العملاء، وتنفيذ المهام', weight: 10, score: 0, notes: '' },
  { key: 'teamwork', title: 'التعاون والقيادة', description: 'التعاون مع الفريق، تحمل المسؤولية، ودعم الشيفت', weight: 10, score: 0, notes: '' },
  { key: 'development', title: 'التطوير والتعلم', description: 'التدريب، تقبل الملاحظات، وتحسن الأداء', weight: 5, score: 0, notes: '' },
];

function monthStart(value: string) { return `${value}-01`; }
function safeNumber(value: unknown) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function gradeFor(score: number) { if (score >= 90) return 'ممتاز'; if (score >= 80) return 'جيد جدًا'; if (score >= 70) return 'جيد'; if (score >= 60) return 'مقبول'; return 'يحتاج خطة تحسين'; }
function scoreColor(score: number) { if (score >= 90) return 'text-emerald-300'; if (score >= 75) return 'text-cyan-300'; if (score >= 60) return 'text-amber-300'; return 'text-rose-300'; }
function isManager(role: string) { return ['general_manager','executive_manager','branches_manager','branch_manager','branch_manager_shamy','branch_manager_shokry'].includes(role); }

export default function StaffMonthlyEvaluation() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const managerMode = isManager(role) || canViewAllBranches(user);
  const selfMode = isDoctorRole(user) && !managerMode;
  const ownBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(canViewAllBranches(user) ? 'فرع الشامي' : ownBranch);
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
  const overallScore = useMemo(() => Math.round(sections.reduce((sum, item) => sum + (item.score / 5) * item.weight, 0) * 10) / 10, [sections]);
  const suggestedIncentive = Math.round((overallScore / 100) * 1500);
  const grade = gradeFor(overallScore);

  useEffect(() => {
    const loadStaff = async () => {
      setLoading(true);
      try {
        let query = supabase.from('staff').select('id,name,role,job_title,branch,status,user_id').order('name').limit(250);
        if (!canViewAllBranches(user) && ownBranch) query = query.eq('branch', ownBranch);
        else if (branch) query = query.eq('branch', branch);
        const { data, error } = await query;
        if (error) throw error;
        const rows = ((data || []) as StaffRow[]).filter((row) => !/inactive|disabled|موقوف|غير نشط/i.test(String(row.status || '')));
        const doctors = rows.filter((row) => /pharmac|صيدل|دكتور|doctor|shift_supervisor|branch_manager/i.test(`${row.role || ''} ${row.job_title || ''}`));
        setStaff(doctors);
        if (selfMode) {
          const own = doctors.find((row) => row.id === user?.staff_id || row.user_id === user?.id || row.name === user?.name);
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
        const [{ data: saved }, pointResult, reviewResult, followupResult, attendanceResult] = await Promise.all([
          supabase.from('staff_monthly_manager_evaluations').select('*').eq('staff_id', selectedId).eq('evaluation_month', monthStart(month)).maybeSingle(),
          supabase.from('points_transactions').select('points_delta,points,created_at,status').eq('staff_id', selectedId).gte('created_at', `${month}-01`).lt('created_at', `${month}-32`).limit(500),
          supabase.from('conversation_sales_reviews').select('score,total_score,created_at').eq('staff_id', selectedId).gte('created_at', `${month}-01`).lt('created_at', `${month}-32`).limit(500),
          supabase.from('daily_followups').select('status,followup_status,completed_at,created_at,assigned_staff_id').or(`assigned_staff_id.eq.${selectedId},requested_by_staff_id.eq.${selectedId}`).gte('created_at', `${month}-01`).lt('created_at', `${month}-32`).limit(1000),
          supabase.from('attendance').select('status,check_in,check_out,date,staff_id').eq('staff_id', selectedId).gte('date', `${month}-01`).lt('date', `${month}-32`).limit(100),
        ]);
        const pointRows = pointResult.data || [];
        const reviewRows = reviewResult.data || [];
        const followupRows = followupResult.data || [];
        const attendanceRows = attendanceResult.data || [];
        const reviewAverage = reviewRows.length ? reviewRows.reduce((s: number, r: any) => s + safeNumber(r.score || r.total_score), 0) / reviewRows.length : 0;
        const completedFollowups = followupRows.filter((r: any) => r.completed_at || /completed|مكتمل|تم/.test(String(r.status || r.followup_status || ''))).length;
        const positivePoints = pointRows.filter((r: any) => safeNumber(r.points_delta ?? r.points) > 0).reduce((s: number, r: any) => s + safeNumber(r.points_delta ?? r.points), 0);
        const negativePoints = pointRows.filter((r: any) => safeNumber(r.points_delta ?? r.points) < 0).reduce((s: number, r: any) => s + Math.abs(safeNumber(r.points_delta ?? r.points)), 0);
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
          setEvaluationId(null); setSections(BASE_SECTIONS.map((x) => ({ ...x }))); setStrengths([]); setDevelopmentPoints([]); setManagerNotes(''); setApprovedIncentive(0); setPointsDelta(0); setStatus('draft');
        }
      } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحميل التقييم'); }
      finally { setLoading(false); }
    };
    void loadEvaluation();
  }, [month, selectedId]);

  const updateSection = (key: string, patch: Partial<Section>) => setSections((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  const toggleTag = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => setter((current) => current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);

  async function save(nextStatus = status) {
    if (!selected) return;
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
      const { data, error } = await supabase.from('staff_monthly_manager_evaluations').upsert(payload, { onConflict: 'staff_id,evaluation_month' }).select('id').single();
      if (error) throw error;
      setEvaluationId(data.id); setStatus(nextStatus);
      if (nextStatus === 'sent') {
        await supabase.from('notifications').insert({ staff_id: selected.id, title: 'تم إرسال تقييمك الشهري', message: `تقييم شهر ${month}: ${overallScore}/100 - ${grade}`, type: 'staff_monthly_evaluation', is_read: false }).then(() => undefined);
      }
      toast.success(nextStatus === 'sent' ? 'تم إرسال التقييم للموظف' : 'تم حفظ التقييم');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'فشل حفظ التقييم'); }
    finally { setSaving(false); }
  }

  async function downloadPdf() {
    if (!printRef.current || !selected) return;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const image = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const width = 190; const height = canvas.height * width / canvas.width;
    let position = 10; let remaining = height;
    pdf.addImage(image, 'PNG', 10, position, width, height);
    remaining -= 277;
    while (remaining > 0) { position = remaining - height + 10; pdf.addPage(); pdf.addImage(image, 'PNG', 10, position, width, height); remaining -= 277; }
    pdf.save(`تقييم-${selected.name}-${month}.pdf`);
  }

  const filteredStaff = staff.filter((item) => item.name.includes(search));
  const strengthOptions = ['ملتزم بالمواعيد','خدمة عملاء ممتازة','بيع احترافي','دقيق في العمل','متعاون مع الفريق','مبادر','يتحمل المسؤولية','سريع التعلم'];
  const developmentOptions = ['زيادة متوسط الفاتورة','تحسين سرعة الرد','تقليل الأخطاء','تحسين الحضور','تطوير البيع الإضافي','زيادة المتابعات','تحسين التوثيق','تطوير القيادة'];

  return <div className="min-h-screen space-y-5 bg-slate-950 p-4 text-white" dir="rtl">
    <section className="rounded-3xl border border-cyan-300/20 bg-gradient-to-l from-cyan-950/50 to-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-black"><UserCheck className="text-cyan-300"/> تقييم الدكاترة الشهري</h1><p className="mt-2 text-sm font-bold text-slate-300">نموذج موحّد يعتمد على بيانات التطبيق وتقييم مدير الفرع، ويربط النتيجة بالحافز وخطة التطوير.</p></div><div className="flex gap-2"><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} className="input-dark"/>{managerMode && canViewAllBranches(user) ? <select value={branch} onChange={(e)=>setBranch(e.target.value)} className="input-dark"><option>فرع الشامي</option><option>فرع شكري</option></select> : null}</div></div>
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

          <section className="space-y-3">{sections.map((item)=><article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">({item.weight}%)</span></h3><p className="mt-1 text-xs text-slate-400">{item.description}</p></div><div className="flex gap-1">{[1,2,3,4,5].map((score)=><button disabled={!managerMode} key={score} onClick={()=>updateSection(item.key,{score})} className="p-1"><Star className={score<=item.score?'fill-amber-400 text-amber-400':'text-slate-600'} size={25}/></button>)}</div></div><textarea disabled={!managerMode} value={item.notes} onChange={(e)=>updateSection(item.key,{notes:e.target.value})} placeholder="ملاحظات مدير الفرع على هذا المحور" className="input-dark mt-3 min-h-20 w-full"/></article>)}</section>

          <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-3xl border border-emerald-300/20 bg-emerald-500/5 p-4"><h3 className="font-black text-emerald-200">نقاط القوة</h3><div className="mt-3 flex flex-wrap gap-2">{strengthOptions.map((x)=><button disabled={!managerMode} key={x} onClick={()=>toggleTag(x,setStrengths)} className={`rounded-full border px-3 py-2 text-xs font-bold ${strengths.includes(x)?'border-emerald-300 bg-emerald-500/20':'border-white/10'}`}>{x}</button>)}</div></div><div className="rounded-3xl border border-amber-300/20 bg-amber-500/5 p-4"><h3 className="font-black text-amber-200">نقاط التطوير</h3><div className="mt-3 flex flex-wrap gap-2">{developmentOptions.map((x)=><button disabled={!managerMode} key={x} onClick={()=>toggleTag(x,setDevelopmentPoints)} className={`rounded-full border px-3 py-2 text-xs font-bold ${developmentPoints.includes(x)?'border-amber-300 bg-amber-500/20':'border-white/10'}`}>{x}</button>)}</div></div></section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><label className="font-black">التقييم النهائي وخطة الشهر القادم</label><textarea disabled={!managerMode} value={managerNotes} onChange={(e)=>setManagerNotes(e.target.value)} className="input-dark mt-3 min-h-28 w-full" placeholder="ملخص واضح للدكتور: ما الذي تميز فيه؟ وما المطلوب منه الشهر القادم؟"/>{managerMode ? <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm font-bold">الحافز المعتمد<input type="number" value={approvedIncentive} onChange={(e)=>setApprovedIncentive(Number(e.target.value))} className="input-dark mt-1 w-full"/></label><label className="text-sm font-bold">تعديل النقاط<input type="number" value={pointsDelta} onChange={(e)=>setPointsDelta(Number(e.target.value))} className="input-dark mt-1 w-full"/></label></div> : null}</section>

          <div className="flex flex-wrap gap-2">{managerMode ? <><button disabled={saving} onClick={()=>void save('draft')} className="btn-secondary flex items-center gap-2"><Save size={17}/> حفظ مسودة</button><button disabled={saving} onClick={()=>void save('approved')} className="rounded-xl bg-cyan-600 px-4 py-2 font-black"><CheckCircle2 className="ml-1 inline" size={17}/> اعتماد التقييم</button><button disabled={saving} onClick={()=>void save('sent')} className="rounded-xl bg-emerald-600 px-4 py-2 font-black"><Send className="ml-1 inline" size={17}/> إرسال للموظف</button></> : null}<button onClick={()=>void downloadPdf()} className="rounded-xl bg-amber-500 px-4 py-2 font-black text-slate-950"><Download className="ml-1 inline" size={17}/> إصدار PDF</button></div>

          <div ref={printRef} className="bg-white p-8 text-slate-900" dir="rtl"><div className="text-center"><h1 className="text-2xl font-black">صيدليات دواء — تقييم شهري</h1><p className="mt-2 font-bold">{selected.name} · {selected.branch} · {month}</p></div><div className="mt-5 grid grid-cols-3 gap-3 text-center"><div className="border p-3"><b>النتيجة</b><div>{overallScore}/100</div></div><div className="border p-3"><b>التقدير</b><div>{grade}</div></div><div className="border p-3"><b>الحافز</b><div>{approvedIncentive || suggestedIncentive} جنيه</div></div></div><table className="mt-5 w-full border-collapse text-sm"><thead><tr><th className="border p-2">المحور</th><th className="border p-2">الوزن</th><th className="border p-2">التقييم</th><th className="border p-2">الملاحظات</th></tr></thead><tbody>{sections.map((x)=><tr key={x.key}><td className="border p-2">{x.title}</td><td className="border p-2">{x.weight}%</td><td className="border p-2">{x.score}/5</td><td className="border p-2">{x.notes || '-'}</td></tr>)}</tbody></table><div className="mt-5 grid grid-cols-2 gap-4"><div className="border p-3"><b>نقاط القوة</b><p className="mt-2">{strengths.join('، ') || '-'}</p></div><div className="border p-3"><b>نقاط التطوير</b><p className="mt-2">{developmentPoints.join('، ') || '-'}</p></div></div><div className="mt-4 border p-3"><b>ملاحظات مدير الفرع</b><p className="mt-2 whitespace-pre-wrap">{managerNotes || '-'}</p></div><div className="mt-8 flex justify-between"><span>توقيع مدير الفرع: __________</span><span>توقيع الموظف: __________</span></div></div>
        </> : <div className="rounded-3xl border border-dashed border-white/15 p-12 text-center text-slate-400"><FileText className="mx-auto mb-3"/> اختر دكتورًا لبدء التقييم</div>}
      </main>
    </div>
  </div>;
}
