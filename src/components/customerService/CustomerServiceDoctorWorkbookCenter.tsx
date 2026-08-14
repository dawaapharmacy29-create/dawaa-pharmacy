import { useMemo, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, ShieldCheck, Upload, Workflow, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { parseMatrix, type SmartQueueImportRow } from '@/components/customerService/SmartQueueExcelImportModal';

type ImportSummary = { total: number; imported: number; updated?: number; duplicates: number; skipped: number };
type Preview = { fileName: string; sourceSheets: string[]; rows: SmartQueueImportRow[] };
type Raw = Record<string, unknown>;

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => text(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\s_\-/—–]+/g, '');
const num = (value: unknown) => Number(value || 0) || 0;
const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function isResultsSheet(matrix: unknown[][]) {
  return matrix.some((row) => { const cells = row.map(norm); return cells.includes(norm('اسم العميل')) && cells.includes(norm('تمت المتابعة')); });
}
function rowIdentity(row: SmartQueueImportRow) {
  return `${row.branch}|${row.sourceFollowupId || `${row.queueType}|${row.customerCode || row.phone || row.customerName}`}`.toLowerCase();
}
function openExceptional(row: Raw) {
  return !row.completed_at && !row.closed_at && !row.cancelled_at;
}

export default function CustomerServiceDoctorWorkbookCenter({ onImported }: { onImported?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const readyRows = useMemo(() => preview?.rows.filter((row) => row.followedUp) || [], [preview]);
  const incompleteRows = useMemo(() => readyRows.filter((row) => row.notes.trim().length < 10 || (row.needsNextFollowup && !row.nextFollowupDate)), [readyRows]);
  const safeRows = useMemo(() => readyRows.filter((row) => row.notes.trim().length >= 10 && (!row.needsNextFollowup || Boolean(row.nextFollowupDate))), [readyRows]);

  async function readFile(file: File) {
    setLoading(true); setSummary(null);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const matrices = book.SheetNames.map((name) => ({ name, matrix: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true }) }));
      const master = matrices.find((sheet) => ['خطهاليوم', 'تنفيذاليوم', 'المتابعهاليوميه'].includes(norm(sheet.name)) && isResultsSheet(sheet.matrix));
      const selected = master ? [master] : matrices.filter((sheet) => isResultsSheet(sheet.matrix));
      if (!selected.length) throw new Error('لم يتم العثور على شيت تنفيذ يحتوي على: اسم العميل + تمت المتابعة.');
      const parsed = selected.flatMap(({ matrix }) => parseMatrix(matrix));
      const branchFallback = managerView ? '' : userBranch;
      const normalized = parsed.map((row) => ({ ...row, branch: normalizeBranchName(row.branch || branchFallback) }));
      const deduped = [...new Map(normalized.map((row) => [rowIdentity(row), row])).values()];
      if (deduped.some((row) => !['فرع الشامي', 'فرع شكري'].includes(row.branch))) throw new Error('يوجد صف بدون فرع صحيح. استخدم ملف فرع منفصل أو تأكد من عدم حذف عمود الفرع.');
      setPreview({ fileName: file.name, sourceSheets: selected.map((sheet) => sheet.name), rows: deduped });
      toast.success(`تمت قراءة ${deduped.length} مهمة بدون تكرار من ${selected.map((s) => s.name).join('، ')}`);
    } catch (error) {
      setPreview(null); toast.error(`تعذر قراءة الملف: ${(error as Error).message}`);
    } finally { setLoading(false); }
  }

  async function importReadyRows() {
    if (!user?.id || !preview || !safeRows.length) return;
    if (incompleteRows.length) return toast.error(`يوجد ${incompleteRows.length} متابعة منفذة ناقصة البيانات. أكمل الملاحظات/الموعد ثم أعد رفع الملف.`);
    if (!window.confirm(`سيتم تسجيل ${safeRows.length} متابعة منفذة فقط. هل تريد الاستمرار؟`)) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('import_customer_service_queue_results_v4', {
        p_actor_id: user.id, p_branch: managerView ? 'كل الفروع' : userBranch, p_file_name: preview.fileName, p_rows: safeRows,
      });
      if (error) throw error;
      const result = data as ImportSummary; setSummary(result);
      toast.success(`تم تسجيل ${result.imported} · تحديث ${result.updated || 0} · مكرر ${result.duplicates} · متوقف ${result.skipped}`);
      window.dispatchEvent(new CustomEvent('customer-followup-imported')); onImported?.();
    } catch (error) { toast.error(`تعذر الاستيراد: ${(error as Error).message}`); }
    finally { setLoading(false); }
  }

  async function exportBranchWorkbook(branch: 'فرع الشامي' | 'فرع شكري') {
    if (!user?.id) return;
    setLoading(true);
    try {
      const today = ymd(new Date());
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const saleDay = ymd(yesterday);
      const actorId = user.id;
      const [topResult, intelligenceResult, vipResult, plusResult, pointsResult, exceptionalResult] = await Promise.all([
        supabase.rpc('get_customer_service_recent_top50_v2', { p_days: 90, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_three_cycle_intelligence_v1', { p_as_of: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_daily_vip7_v2', { p_date: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_plus500_v2', { p_date: saleDay, p_actor_id: actorId }),
        supabase.rpc('get_customer_points_daily20_v2', { p_date: today, p_actor_id: actorId }),
        supabase.from('daily_followups').select('id,customer_name,customer_code,customer_phone,phone,branch,priority,followup_reason,request_details,assigned_doctor,created_by_name,followup_datetime,request_type,request_source,completed_at,closed_at,cancelled_at').eq('branch', branch).order('created_at', { ascending: false }).limit(500),
      ]);
      const rpcErrors = [topResult, intelligenceResult, vipResult, plusResult, pointsResult].map((r) => r.error).filter(Boolean);
      if (rpcErrors.length) throw new Error(rpcErrors[0]?.message || 'تعذر تحميل بيانات الملف');
      if (exceptionalResult.error) throw exceptionalResult.error;

      const top = ((topResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const intelligence = ((intelligenceResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const vip = ((vipResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const plus500 = ((plusResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const points = ((pointsResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const exceptional = ((exceptionalResult.data || []) as Raw[]).filter((r) => openExceptional(r) && ['exceptional_followup','doctor_requested_followup','طلب متابعة'].includes(text(r.request_type)) || openExceptional(r) && ['exceptional_followup','doctor_requested_followup'].includes(text(r.request_source)));
      const intelByCode = new Map(intelligence.map((r) => [text(r.customer_code), r]));

      type MasterRow = Record<string, unknown> & { __priority: number; __sources: string[] };
      const master = new Map<string, MasterRow>();
      const resultColumns = { 'تمت المتابعة': '', 'تم الرد': '', 'رد العميل': '', 'عملية شراء': '', 'قيمة عملية الشراء': '', 'هل يحتاج متابعة أخرى': '', 'موعد المتابعة القادمة': '', 'ملاحظات': '' };
      const upsert = (input: { code: string; name: string; phone: string; type: string; source: string; priority: number; sourceId?: string; reason?: string; trend?: string; recentSales?: number; currentSales?: number; baselineSales?: number; invoiceAmount?: number; pointsBalance?: number; doctor?: string; requestedBy?: string }) => {
        const key = `${branch}|${input.code || input.phone || input.name}`.toLowerCase();
        const current = master.get(key);
        const base: MasterRow = current || {
          'نوع القائمة': input.type, 'الفرع': branch, 'اسم العميل': input.name, 'كود العميل': input.code, 'الهاتف': input.phone,
          'معرف المتابعة': input.sourceId || '', 'مصادر المتابعة': input.source, 'الأولوية': input.priority,
          'سبب التواصل': input.reason || '', 'حالة الاتجاه': input.trend || '', 'مبيعات آخر 3 شهور': input.recentSales || '',
          'الفترة الحالية': input.currentSales ?? '', 'المعتاد': input.baselineSales ?? '', 'قيمة الفاتورة': input.invoiceAmount || '',
          'رصيد النقاط': input.pointsBalance || '', 'الدكتور المسؤول': input.doctor || '', 'طلب المتابعة بواسطة': input.requestedBy || '',
          ...resultColumns, __priority: input.priority, __sources: [input.source],
        };
        if (!base.__sources.includes(input.source)) base.__sources.push(input.source);
        base['مصادر المتابعة'] = base.__sources.join(' + ');
        if (input.priority > base.__priority) { base.__priority = input.priority; base['الأولوية'] = input.priority; base['نوع القائمة'] = input.type; }
        if (input.sourceId) base['معرف المتابعة'] = input.sourceId;
        if (input.reason && !text(base['سبب التواصل'])) base['سبب التواصل'] = input.reason;
        if (input.trend) base['حالة الاتجاه'] = input.trend;
        if (input.recentSales) base['مبيعات آخر 3 شهور'] = input.recentSales;
        if (input.currentSales != null) base['الفترة الحالية'] = input.currentSales;
        if (input.baselineSales != null) base['المعتاد'] = input.baselineSales;
        if (input.invoiceAmount) base['قيمة الفاتورة'] = input.invoiceAmount;
        if (input.pointsBalance) base['رصيد النقاط'] = input.pointsBalance;
        if (input.doctor) base['الدكتور المسؤول'] = input.doctor;
        if (input.requestedBy) base['طلب المتابعة بواسطة'] = input.requestedBy;
        master.set(key, base);
      };

      exceptional.forEach((r) => upsert({ code:text(r.customer_code), name:text(r.customer_name), phone:text(r.customer_phone || r.phone), type:'متابعة استثنائية', source:'استثنائي', priority:1000, sourceId:text(r.id), reason:text(r.followup_reason || r.request_details), doctor:text(r.assigned_doctor), requestedBy:text(r.created_by_name) }));
      intelligence.forEach((r) => { const trend=text(r.trend_state); const risk=['خطر فقد','تراجع قوي','تراجع'].includes(trend); const growth=['نمو قوي','نمو','عميل صاعد جديد'].includes(trend); upsert({ code:text(r.customer_code), name:text(r.customer_name), phone:text(r.customer_phone), type:trend || 'نشاط', source:risk?'تراجع النشاط':growth?'نمو':'نشط', priority:risk?900+num(r.priority_score):growth?550:400, reason:risk?'استرجاع عميل انخفض نشاطه':growth?'الحفاظ على سبب النمو':'الحفاظ على العلاقة', trend, recentSales:num(r.recent_sales), currentSales:num(r.current_period_sales), baselineSales:num(r.baseline_sales) }); });
      plus500.forEach((r) => upsert({ code:text(r.customer_code), name:text(r.customer_name), phone:text(r.customer_phone), type:'+500', source:'+500', priority:700, reason:'متابعة بعد فاتورة كبيرة', invoiceAmount:num(r.qualifying_total) }));
      points.forEach((r) => upsert({ code:text(r.customer_code), name:text(r.customer_name), phone:text(r.customer_phone), type:'نقاط', source:'نقاط', priority:300, reason:'إبلاغ العميل برصيد النقاط', pointsBalance:num(r.points_balance) }));
      vip.forEach((r) => { const signal=intelByCode.get(text(r.customer_code)); upsert({ code:text(r.customer_code), name:text(r.customer_name), phone:text(r.customer_phone), type:'VIP آخر 3 شهور', source:'VIP', priority:500, reason:'الحفاظ على أهم العملاء', trend:text(signal?.trend_state), recentSales:num(r.recent_sales), currentSales:num(signal?.current_period_sales), baselineSales:num(signal?.baseline_sales) }); });

      const executionRows = [...master.values()].sort((a,b)=>b.__priority-a.__priority).map((row, index) => { const clean={...row}; delete clean.__priority; delete clean.__sources; return { 'ترتيب التنفيذ': index+1, ...clean }; });
      const reference = (rows: Raw[], mapper: (r: Raw) => Record<string, unknown>) => rows.map(mapper);
      const riskRows = intelligence.filter((r)=>['خطر فقد','تراجع قوي','تراجع'].includes(text(r.trend_state)));
      const activeRows = intelligence.filter((r)=>!['خطر فقد','تراجع قوي','تراجع'].includes(text(r.trend_state)));
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      const add = (name: string, rows: Record<string, unknown>[], widths: number[]) => { const sheet=XLSX.utils.json_to_sheet(rows.length?rows:[{'ملاحظة':'لا توجد بيانات'}]); (sheet as any)['!cols']=widths.map((wch)=>({wch})); if(rows.length)(sheet as any)['!autofilter']={ref:sheet['!ref']}; (sheet as any)['!views']=[{RTL:true}]; XLSX.utils.book_append_sheet(book,sheet,name.slice(0,31)); };
      add('تعليمات', [
        {'الخطوة':'1','الشرح':'اشتغل فقط في شيت «تنفيذ اليوم» وابدأ من ترتيب التنفيذ 1.'},
        {'الخطوة':'2','الشرح':'املأ تمت المتابعة وتم الرد ورد العميل والشراء والمتابعة القادمة والملاحظات.'},
        {'الخطوة':'3','الشرح':'الملاحظات لا تقل عن 10 حروف، وإذا يحتاج متابعة أخرى لازم تحدد الموعد.'},
        {'الخطوة':'4','الشرح':'لا تحذف أعمدة الفرع أو كود العميل أو معرف المتابعة.'},
        {'الخطوة':'5','الشرح':'بعد التنفيذ ارفع نفس الملف من «استيراد نتائج ملف الدكاترة» في التطبيق.'},
      ], [12,100]);
      add('تنفيذ اليوم', executionRows, [12,18,14,28,14,16,38,14,32,16,20,18,18,18,18,18,18,18,16,16,30,14,18,20,30]);
      add('إبلاغ النقاط', reference(points,r=>({'اسم العميل':r.customer_name,'كود العميل':r.customer_code,'الهاتف':r.customer_phone,'رصيد النقاط':r.points_balance})), [28,14,16,18]);
      add('+500', reference(plus500,r=>({'اسم العميل':r.customer_name,'كود العميل':r.customer_code,'الهاتف':r.customer_phone,'عدد الفواتير':r.qualifying_invoice_count,'إجمالي +500':r.qualifying_total,'أعلى فاتورة':r.highest_invoice})), [28,14,16,18,20,18]);
      add('متابعة استثنائية', reference(exceptional,r=>({'معرف المتابعة':r.id,'اسم العميل':r.customer_name,'كود العميل':r.customer_code,'الهاتف':r.customer_phone||r.phone,'الأولوية':r.priority,'السبب':r.followup_reason,'التفاصيل':r.request_details,'الدكتور المسؤول':r.assigned_doctor,'طلب بواسطة':r.created_by_name,'موعد المتابعة':r.followup_datetime})), [38,28,14,16,14,24,50,20,20,22]);
      add('تراجع النشاط', reference(riskRows,r=>({'الحالة':r.trend_state,'الترتيب':r.customer_rank,'اسم العميل':r.customer_name,'كود العميل':r.customer_code,'الهاتف':r.customer_phone,'مبيعات 3 شهور':r.recent_sales,'الحالي':r.current_period_sales,'المعتاد':r.baseline_sales,'التغير %':r.change_vs_baseline_pct,'درجة الأولوية':r.priority_score,'آخر شراء':r.last_purchase})), [16,10,28,14,16,20,18,18,16,18,16]);
      add('نشط ونمو', reference(activeRows,r=>({'الحالة':r.trend_state,'الترتيب':r.customer_rank,'اسم العميل':r.customer_name,'كود العميل':r.customer_code,'الهاتف':r.customer_phone,'مبيعات 3 شهور':r.recent_sales,'الحالي':r.current_period_sales,'المعتاد':r.baseline_sales,'التغير %':r.change_vs_baseline_pct,'آخر شراء':r.last_purchase})), [16,10,28,14,16,20,18,18,16,16]);
      add('أفضل 50', reference(top,r=>({'الترتيب':r.customer_rank,'اسم العميل':r.customer_name,'كود العميل':r.customer_code,'الهاتف':r.customer_phone,'مبيعات 3 شهور':r.recent_sales,'عدد الفواتير':r.invoice_count,'متوسط الفاتورة':r.avg_invoice,'آخر شراء':r.last_purchase,'درجة الأهمية':r.importance_score})), [10,28,14,16,20,16,18,16,16]);
      (book as any).Workbook={Views:[{RTL:true}]};
      XLSX.writeFile(book, `متابعة_خدمة_العملاء_${branch.replace('فرع ','')}_${today}.xlsx`);
      toast.success(`تم تجهيز ملف ${branch} — ${executionRows.length} مهمة تنفيذ`);
    } catch (error) { toast.error(`تعذر تجهيز الملف: ${(error as Error).message}`); }
    finally { setLoading(false); }
  }

  const exportBranches: Array<'فرع الشامي'|'فرع شكري'> = managerView ? ['فرع الشامي','فرع شكري'] : userBranch === 'فرع الشامي' || userBranch === 'فرع شكري' ? [userBranch] : [];

  return <section className="mx-4 mt-4 rounded-3xl border border-cyan-300/15 bg-[#0b2035] p-4 shadow-xl md:p-5" dir="rtl">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div><p className="text-xs font-black text-cyan-300">مسار عمل الدكاترة</p><h2 className="mt-1 text-xl font-black text-white">تصدير ملف الفرع → تنفيذ → مراجعة → استيراد النتائج</h2><p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-slate-400">كل فرع له ملف مستقل. الدكتور يشتغل في «تنفيذ اليوم» فقط، بينما النقاط و+500 والاستثنائي والتراجع والنشاط صفحات مرجعية واضحة.</p></div>
      <div className="flex flex-wrap gap-2">{exportBranches.map((branch)=><button key={branch} type="button" onClick={()=>void exportBranchWorkbook(branch)} disabled={loading} className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:opacity-50"><Download className="ml-1 inline" size={17}/> تصدير {branch}</button>)}<label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300"><Upload size={17}/>{loading ? 'جارٍ المعالجة...' : 'استيراد نتائج ملف الدكاترة'}<input type="file" accept=".xlsx,.xls" className="hidden" disabled={loading} onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}/></label></div>
    </div>
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{[[Workflow,'1. ابدأ بالأولوية','الاستثنائي ثم خطر الفقد والتراجع ثم +500 ثم النمو والنقاط.'],[FileSpreadsheet,'2. سجّل النتيجة فقط','تمت المتابعة، الرد، الشراء، المتابعة القادمة والملاحظات.'],[ShieldCheck,'3. راجع الجاهزية','ملاحظة 10 حروف على الأقل، وموعد لو توجد متابعة أخرى.'],[CheckCircle2,'4. استورد للتطبيق','المنفذ فقط يُسجل، والطلب الاستثنائي الأصلي يتم تحديثه.']].map(([Icon,title,desc])=>{const I=Icon as typeof Workflow;return <div key={String(title)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="flex items-center gap-2 text-sm font-black text-white"><I size={17} className="text-cyan-300"/>{String(title)}</div><p className="mt-2 text-xs font-bold leading-5 text-slate-400">{String(desc)}</p></div>})}</div>
    {preview ? <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-black text-white">{preview.fileName}</div><div className="mt-1 text-xs font-bold text-slate-400">مصدر القراءة: {preview.sourceSheets.join('، ')}</div></div><button type="button" onClick={()=>setPreview(null)} className="rounded-xl border border-white/10 p-2 text-slate-300"><XCircle size={17}/></button></div><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4"><div className="rounded-xl bg-white/5 p-3 text-center"><div className="text-[11px] font-bold text-slate-400">كل المهام</div><div className="mt-1 text-xl font-black text-white">{preview.rows.length}</div></div><div className="rounded-xl bg-emerald-400/10 p-3 text-center"><div className="text-[11px] font-bold text-emerald-200">منفذ</div><div className="mt-1 text-xl font-black text-white">{readyRows.length}</div></div><div className="rounded-xl bg-rose-400/10 p-3 text-center"><div className="text-[11px] font-bold text-rose-200">ناقص بيانات</div><div className="mt-1 text-xl font-black text-white">{incompleteRows.length}</div></div><div className="rounded-xl bg-cyan-400/10 p-3 text-center"><div className="text-[11px] font-bold text-cyan-200">جاهز للتسجيل</div><div className="mt-1 text-xl font-black text-white">{safeRows.length}</div></div></div>{incompleteRows.length?<div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">لن يتم الاستيراد قبل استكمال {incompleteRows.length} صف منفذ ناقص الملاحظات أو موعد المتابعة القادمة.</div>:null}<div className="mt-3 flex justify-end"><button type="button" onClick={()=>void importReadyRows()} disabled={loading||!safeRows.length||!!incompleteRows.length} className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="ml-1 inline" size={16}/> تسجيل النتائج في التطبيق</button></div>{summary?<div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-black text-emerald-100">تم: {summary.imported} · تحديث: {summary.updated||0} · مكرر: {summary.duplicates} · متوقف: {summary.skipped}</div>:null}</div>:null}
  </section>;
}
