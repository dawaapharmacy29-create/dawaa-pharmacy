import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ListChecks,
  PhoneMissed,
  ShieldCheck,
  ShoppingCart,
  Upload,
  Workflow,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { parseMatrix, type SmartQueueImportRow } from '@/components/customerService/SmartQueueExcelImportModal';

type ImportSummary = { total: number; imported: number; updated?: number; duplicates: number; skipped: number };
type Preview = { fileName: string; sourceSheets: string[]; rows: SmartQueueImportRow[] };
type Raw = Record<string, unknown>;
type BranchName = 'فرع الشامي' | 'فرع شكري';

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => text(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\s_\-/—–]+/g, '');
const num = (value: unknown) => Number(value || 0) || 0;
const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const money = (value: number) => `${Math.round(value).toLocaleString('ar-EG')} ج.م`;

function isResultsSheet(matrix: unknown[][]) {
  return matrix.some((row) => {
    const cells = row.map(norm);
    return cells.includes(norm('اسم العميل')) && cells.includes(norm('تمت المتابعة'));
  });
}
function rowIdentity(row: SmartQueueImportRow) {
  return `${row.branch}|${row.sourceFollowupId || `${row.queueType}|${row.customerCode || row.phone || row.customerName}`}`.toLowerCase();
}
function openExceptional(row: Raw) {
  return !row.completed_at && !row.closed_at && !row.cancelled_at;
}
function queueLabel(type: string) {
  if (type === 'exceptional') return 'متابعة استثنائية';
  if (type === 'vip_recent') return 'VIP';
  if (type === 'plus500') return '+500';
  if (type === 'points') return 'نقاط';
  if (type === 'activity') return 'نشاط العميل';
  return type || 'متابعة';
}
function issueForRow(row: SmartQueueImportRow) {
  const issues: string[] = [];
  if (row.notes.trim().length < 10) issues.push('الملاحظات أقل من 10 حروف');
  if (row.needsNextFollowup && !row.nextFollowupDate) issues.push('موعد المتابعة القادمة غير محدد');
  return issues.join(' · ');
}
function stageFor(type: string, trend = '') {
  if (type === 'متابعة استثنائية') return '1 — تنفيذ استثنائي';
  if (['خطر فقد', 'تراجع قوي'].includes(trend)) return '2 — استرجاع عاجل';
  if (trend === 'تراجع') return '3 — استرجاع';
  if (type === '+500') return '4 — ما بعد شراء كبير';
  if (['نمو قوي', 'نمو', 'عميل صاعد جديد'].includes(trend)) return '5 — تعزيز النمو';
  if (type === 'VIP آخر 3 شهور') return '6 — حماية العلاقة';
  if (type === 'نقاط') return '7 — تنشيط النقاط';
  return '8 — متابعة العلاقة';
}
function actionFor(input: { type: string; trend?: string; invoiceAmount?: number; pointsBalance?: number; currentSales?: number; baselineSales?: number }) {
  if (input.type === 'متابعة استثنائية') return 'اقرأ سبب طلب الدكتور أولًا، ثم نفّذ المطلوب وسجّل النتيجة بدقة.';
  if (['خطر فقد', 'تراجع قوي', 'تراجع'].includes(input.trend || '')) return 'اسأل عن سبب انخفاض التعامل وحدد احتياجًا واضحًا يمكن للصيدلية خدمته.';
  if (input.type === '+500') return `متابعة رضا العميل بعد شراء كبير${input.invoiceAmount ? ` بقيمة ${money(input.invoiceAmount)}` : ''} وفرصة إعادة الشراء.`;
  if (input.type === 'نقاط') return `أبلغ العميل برصيده${input.pointsBalance ? ` (${Math.round(input.pointsBalance).toLocaleString('ar-EG')} نقطة)` : ''} واربطه باستخدام مناسب.`;
  if (['نمو قوي', 'نمو', 'عميل صاعد جديد'].includes(input.trend || '')) return 'اعرف سبب زيادة التعامل وحافظ على التجربة التي أدت للنمو.';
  return 'تواصل للحفاظ على العلاقة وتأكد من عدم وجود احتياج غير مخدوم.';
}

export default function CustomerServiceDoctorWorkbookCenter({ onImported }: { onImported?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const readyRows = useMemo(() => preview?.rows.filter((row) => row.followedUp) || [], [preview]);
  const incompleteRows = useMemo(
    () => readyRows.filter((row) => row.notes.trim().length < 10 || (row.needsNextFollowup && !row.nextFollowupDate)),
    [readyRows],
  );
  const safeRows = useMemo(
    () => readyRows.filter((row) => row.notes.trim().length >= 10 && (!row.needsNextFollowup || Boolean(row.nextFollowupDate))),
    [readyRows],
  );
  const previewStats = useMemo(() => {
    const responded = readyRows.filter((row) => row.responded).length;
    const purchases = readyRows.filter((row) => row.purchaseAfterFollowup).length;
    const purchaseAmount = readyRows.reduce((sum, row) => sum + Number(row.purchaseAmount || 0), 0);
    const next = readyRows.filter((row) => row.needsNextFollowup).length;
    const noAnswer = readyRows.filter((row) => !row.responded).length;
    return {
      responded,
      purchases,
      purchaseAmount,
      next,
      noAnswer,
      responseRate: readyRows.length ? Math.round((responded / readyRows.length) * 100) : 0,
      conversionRate: responded ? Math.round((purchases / responded) * 100) : 0,
    };
  }, [readyRows]);
  const branchBreakdown = useMemo(() => {
    const rows = preview?.rows || [];
    return (['فرع الشامي', 'فرع شكري'] as BranchName[])
      .map((branch) => ({
        branch,
        total: rows.filter((row) => row.branch === branch).length,
        executed: rows.filter((row) => row.branch === branch && row.followedUp).length,
      }))
      .filter((item) => item.total > 0);
  }, [preview]);

  async function readFile(file: File) {
    setLoading(true);
    setSummary(null);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const matrices = book.SheetNames.map((name) => ({
        name,
        matrix: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true }),
      }));
      const master = matrices.find(
        (sheet) => ['خطهاليوم', 'تنفيذاليوم', 'المتابعهاليوميه'].includes(norm(sheet.name)) && isResultsSheet(sheet.matrix),
      );
      const selected = master ? [master] : matrices.filter((sheet) => isResultsSheet(sheet.matrix));
      if (!selected.length) throw new Error('لم يتم العثور على شيت تنفيذ يحتوي على: اسم العميل + تمت المتابعة.');
      const parsed = selected.flatMap(({ matrix }) => parseMatrix(matrix));
      const branchFallback = managerView ? '' : userBranch;
      const normalized = parsed.map((row) => ({ ...row, branch: normalizeBranchName(row.branch || branchFallback) }));
      const deduped = [...new Map(normalized.map((row) => [rowIdentity(row), row])).values()];
      if (deduped.some((row) => !['فرع الشامي', 'فرع شكري'].includes(row.branch))) {
        throw new Error('يوجد صف بدون فرع صحيح. استخدم ملف فرع منفصل أو تأكد من عدم حذف عمود الفرع.');
      }
      setPreview({ fileName: file.name, sourceSheets: selected.map((sheet) => sheet.name), rows: deduped });
      toast.success(`تمت قراءة ${deduped.length} مهمة بدون تكرار من ${selected.map((s) => s.name).join('، ')}`);
    } catch (error) {
      setPreview(null);
      toast.error(`تعذر قراءة الملف: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function importReadyRows() {
    if (!user?.id || !preview || !safeRows.length) return;
    if (incompleteRows.length) {
      return toast.error(`يوجد ${incompleteRows.length} متابعة منفذة ناقصة البيانات. أكمل الملاحظات/الموعد ثم أعد رفع الملف.`);
    }
    if (!window.confirm(`سيتم تسجيل ${safeRows.length} متابعة منفذة فقط. هل تريد الاستمرار؟`)) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('import_customer_service_queue_results_v4', {
        p_actor_id: user.id,
        p_branch: managerView ? 'كل الفروع' : userBranch,
        p_file_name: preview.fileName,
        p_rows: safeRows,
      });
      if (error) throw error;
      const result = data as ImportSummary;
      setSummary(result);
      toast.success(`تم تسجيل ${result.imported} · تحديث ${result.updated || 0} · مكرر ${result.duplicates} · متوقف ${result.skipped}`);
      window.dispatchEvent(new CustomEvent('customer-followup-imported'));
      onImported?.();
    } catch (error) {
      toast.error(`تعذر الاستيراد: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function exportBranchWorkbook(branch: BranchName) {
    if (!user?.id) return;
    setLoading(true);
    try {
      const today = ymd(new Date());
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const saleDay = ymd(yesterday);
      const actorId = user.id;
      const [topResult, intelligenceResult, vipResult, plusResult, pointsResult, exceptionalResult] = await Promise.all([
        supabase.rpc('get_customer_service_recent_top50_v2', { p_days: 90, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_three_cycle_intelligence_v1', { p_as_of: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_daily_vip7_v2', { p_date: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_plus500_v2', { p_date: saleDay, p_actor_id: actorId }),
        supabase.rpc('get_customer_points_daily20_v2', { p_date: today, p_actor_id: actorId }),
        supabase
          .from('daily_followups')
          .select('id,customer_name,customer_code,customer_phone,phone,branch,priority,followup_reason,request_details,assigned_doctor,created_by_name,followup_datetime,request_type,request_source,completed_at,closed_at,cancelled_at')
          .eq('branch', branch)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      const rpcErrors = [topResult, intelligenceResult, vipResult, plusResult, pointsResult].map((r) => r.error).filter(Boolean);
      if (rpcErrors.length) throw new Error(rpcErrors[0]?.message || 'تعذر تحميل بيانات الملف');
      if (exceptionalResult.error) throw exceptionalResult.error;

      const top = ((topResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const intelligence = ((intelligenceResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const vip = ((vipResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const plus500 = ((plusResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const points = ((pointsResult.data || []) as Raw[]).filter((r) => text(r.branch) === branch);
      const exceptional = ((exceptionalResult.data || []) as Raw[]).filter(
        (r) =>
          (openExceptional(r) && ['exceptional_followup', 'doctor_requested_followup', 'طلب متابعة'].includes(text(r.request_type))) ||
          (openExceptional(r) && ['exceptional_followup', 'doctor_requested_followup'].includes(text(r.request_source))),
      );
      const intelByCode = new Map(intelligence.map((r) => [text(r.customer_code), r]));
      const topByCode = new Map(top.map((r) => [text(r.customer_code), r]));

      type MasterRow = Record<string, unknown> & { __priority: number; __sources: string[] };
      const master = new Map<string, MasterRow>();
      const resultColumns = {
        'تمت المتابعة': '',
        'تم الرد': '',
        'رد العميل': '',
        'عملية شراء': '',
        'قيمة عملية الشراء': '',
        'هل يحتاج متابعة أخرى': '',
        'موعد المتابعة القادمة': '',
        'ملاحظات': '',
      };
      const upsert = (input: {
        code: string;
        name: string;
        phone: string;
        type: string;
        source: string;
        priority: number;
        sourceId?: string;
        reason?: string;
        trend?: string;
        recentSales?: number;
        currentSales?: number;
        baselineSales?: number;
        invoiceAmount?: number;
        pointsBalance?: number;
        doctor?: string;
        requestedBy?: string;
        lastPurchase?: string;
      }) => {
        const key = `${branch}|${input.code || input.phone || input.name}`.toLowerCase();
        const current = master.get(key);
        const gap = Math.max(0, Number(input.baselineSales || 0) - Number(input.currentSales || 0));
        const base: MasterRow = current || {
          'نوع القائمة': input.type,
          'المرحلة': stageFor(input.type, input.trend),
          'الفرع': branch,
          'اسم العميل': input.name,
          'كود العميل': input.code,
          'الهاتف': input.phone,
          'معرف المتابعة': input.sourceId || '',
          'مصادر المتابعة': input.source,
          'الأولوية': input.priority,
          'سبب التواصل': input.reason || '',
          'الإجراء المقترح': actionFor(input),
          'حالة الاتجاه': input.trend || '',
          'آخر شراء': input.lastPurchase || '',
          'مبيعات آخر 3 شهور': input.recentSales || '',
          'الفترة الحالية': input.currentSales ?? '',
          'المعتاد': input.baselineSales ?? '',
          'فجوة الاسترجاع': gap || '',
          'قيمة الفاتورة': input.invoiceAmount || '',
          'رصيد النقاط': input.pointsBalance || '',
          'الدكتور المسؤول': input.doctor || '',
          'طلب المتابعة بواسطة': input.requestedBy || '',
          ...resultColumns,
          __priority: input.priority,
          __sources: [input.source],
        };
        if (!base.__sources.includes(input.source)) base.__sources.push(input.source);
        base['مصادر المتابعة'] = base.__sources.join(' + ');
        if (input.priority > base.__priority) {
          base.__priority = input.priority;
          base['الأولوية'] = input.priority;
          base['نوع القائمة'] = input.type;
          base['المرحلة'] = stageFor(input.type, input.trend);
          base['الإجراء المقترح'] = actionFor(input);
        }
        if (input.sourceId) base['معرف المتابعة'] = input.sourceId;
        if (input.reason && !text(base['سبب التواصل'])) base['سبب التواصل'] = input.reason;
        if (input.trend) base['حالة الاتجاه'] = input.trend;
        if (input.lastPurchase) base['آخر شراء'] = input.lastPurchase;
        if (input.recentSales) base['مبيعات آخر 3 شهور'] = input.recentSales;
        if (input.currentSales != null) base['الفترة الحالية'] = input.currentSales;
        if (input.baselineSales != null) base['المعتاد'] = input.baselineSales;
        if (gap) base['فجوة الاسترجاع'] = gap;
        if (input.invoiceAmount) base['قيمة الفاتورة'] = input.invoiceAmount;
        if (input.pointsBalance) base['رصيد النقاط'] = input.pointsBalance;
        if (input.doctor) base['الدكتور المسؤول'] = input.doctor;
        if (input.requestedBy) base['طلب المتابعة بواسطة'] = input.requestedBy;
        master.set(key, base);
      };

      exceptional.forEach((r) => {
        const intelligenceRow = intelByCode.get(text(r.customer_code));
        const topRow = topByCode.get(text(r.customer_code));
        upsert({
          code: text(r.customer_code),
          name: text(r.customer_name),
          phone: text(r.customer_phone || r.phone),
          type: 'متابعة استثنائية',
          source: 'استثنائي',
          priority: 1000,
          sourceId: text(r.id),
          reason: text(r.followup_reason || r.request_details),
          doctor: text(r.assigned_doctor),
          requestedBy: text(r.created_by_name),
          trend: text(intelligenceRow?.trend_state),
          recentSales: num(intelligenceRow?.recent_sales || topRow?.recent_sales),
          currentSales: num(intelligenceRow?.current_period_sales),
          baselineSales: num(intelligenceRow?.baseline_sales),
          lastPurchase: text(intelligenceRow?.last_purchase || topRow?.last_purchase),
        });
      });
      intelligence.forEach((r) => {
        const trend = text(r.trend_state);
        const risk = ['خطر فقد', 'تراجع قوي', 'تراجع'].includes(trend);
        const growth = ['نمو قوي', 'نمو', 'عميل صاعد جديد'].includes(trend);
        upsert({
          code: text(r.customer_code),
          name: text(r.customer_name),
          phone: text(r.customer_phone),
          type: trend || 'نشاط',
          source: risk ? 'تراجع النشاط' : growth ? 'نمو' : 'نشط',
          priority: risk ? 900 + num(r.priority_score) : growth ? 550 : 400,
          reason: risk ? 'استرجاع عميل انخفض نشاطه' : growth ? 'الحفاظ على سبب النمو' : 'الحفاظ على العلاقة',
          trend,
          recentSales: num(r.recent_sales),
          currentSales: num(r.current_period_sales),
          baselineSales: num(r.baseline_sales),
          lastPurchase: text(r.last_purchase),
        });
      });
      plus500.forEach((r) => {
        const signal = intelByCode.get(text(r.customer_code));
        upsert({
          code: text(r.customer_code),
          name: text(r.customer_name),
          phone: text(r.customer_phone),
          type: '+500',
          source: '+500',
          priority: 700,
          reason: 'متابعة بعد فاتورة كبيرة',
          invoiceAmount: num(r.qualifying_total),
          trend: text(signal?.trend_state),
          currentSales: num(signal?.current_period_sales),
          baselineSales: num(signal?.baseline_sales),
          recentSales: num(signal?.recent_sales),
          lastPurchase: text(signal?.last_purchase),
        });
      });
      points.forEach((r) => {
        const signal = intelByCode.get(text(r.customer_code));
        upsert({
          code: text(r.customer_code),
          name: text(r.customer_name),
          phone: text(r.customer_phone),
          type: 'نقاط',
          source: 'نقاط',
          priority: 300,
          reason: 'إبلاغ العميل برصيد النقاط',
          pointsBalance: num(r.points_balance),
          trend: text(signal?.trend_state),
          currentSales: num(signal?.current_period_sales),
          baselineSales: num(signal?.baseline_sales),
          recentSales: num(signal?.recent_sales),
          lastPurchase: text(signal?.last_purchase),
        });
      });
      vip.forEach((r) => {
        const signal = intelByCode.get(text(r.customer_code));
        upsert({
          code: text(r.customer_code),
          name: text(r.customer_name),
          phone: text(r.customer_phone),
          type: 'VIP آخر 3 شهور',
          source: 'VIP',
          priority: 500,
          reason: 'الحفاظ على أهم العملاء',
          trend: text(signal?.trend_state),
          recentSales: num(r.recent_sales),
          currentSales: num(signal?.current_period_sales),
          baselineSales: num(signal?.baseline_sales),
          lastPurchase: text(signal?.last_purchase || r.last_purchase),
        });
      });

      const executionRows = [...master.values()]
        .sort((a, b) => b.__priority - a.__priority)
        .map((row, index) => {
          const clean = { ...row };
          delete clean.__priority;
          delete clean.__sources;
          return { 'ترتيب التنفيذ': index + 1, ...clean };
        });
      const reference = (rows: Raw[], mapper: (r: Raw) => Record<string, unknown>) => rows.map(mapper);
      const riskRows = intelligence.filter((r) => ['خطر فقد', 'تراجع قوي', 'تراجع'].includes(text(r.trend_state)));
      const activeRows = intelligence.filter((r) => !['خطر فقد', 'تراجع قوي', 'تراجع'].includes(text(r.trend_state)));
      const recoveryGap = riskRows.reduce((sum, row) => sum + Math.max(0, num(row.baseline_sales) - num(row.current_period_sales)), 0);
      const largeInvoiceValue = plus500.reduce((sum, row) => sum + num(row.qualifying_total), 0);
      const pointsValue = points.reduce((sum, row) => sum + num(row.points_balance), 0);
      const sourceCount = (source: string) => executionRows.filter((row) => text(row['مصادر المتابعة']).includes(source)).length;

      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      const add = (name: string, rows: Record<string, unknown>[], widths: number[]) => {
        const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'ملاحظة': 'لا توجد بيانات' }]);
        (sheet as any)['!cols'] = widths.map((wch) => ({ wch }));
        if (rows.length) (sheet as any)['!autofilter'] = { ref: sheet['!ref'] };
        (sheet as any)['!views'] = [{ RTL: true }];
        XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
      };

      add('لوحة اليوم', [
        { 'المؤشر': 'إجمالي مهام التنفيذ', 'القيمة': executionRows.length, 'المعنى': 'عدد العملاء الفعلي بعد دمج التكرارات بين القوائم.' },
        { 'المؤشر': 'متابعات استثنائية', 'القيمة': sourceCount('استثنائي'), 'المعنى': 'طلبات الدكاترة والحالات الخاصة — تبدأ بها أولًا.' },
        { 'المؤشر': 'عملاء خطر/تراجع', 'القيمة': riskRows.length, 'المعنى': 'عملاء مطلوب استرجاعهم بسبب انخفاض النشاط.' },
        { 'المؤشر': 'فجوة استرجاع تقديرية', 'القيمة': recoveryGap, 'المعنى': 'الفرق التقريبي بين الحالي والمعتاد للعملاء المتراجعين.' },
        { 'المؤشر': 'عملاء +500', 'القيمة': plus500.length, 'المعنى': 'عملاء قاموا بفواتير كبيرة ويحتاجون متابعة رضا وإعادة شراء.' },
        { 'المؤشر': 'قيمة فواتير +500', 'القيمة': largeInvoiceValue, 'المعنى': 'إجمالي قيمة الفواتير الكبيرة داخل قائمة اليوم.' },
        { 'المؤشر': 'عملاء النقاط', 'القيمة': points.length, 'المعنى': 'عملاء مطلوب إبلاغهم برصيد النقاط.' },
        { 'المؤشر': 'إجمالي رصيد النقاط', 'القيمة': pointsValue, 'المعنى': 'إجمالي النقاط داخل قائمة الإبلاغ.' },
        { 'المؤشر': 'نشط / نمو', 'القيمة': activeRows.length, 'المعنى': 'عملاء نريد الحفاظ على علاقتهم وتعزيز النمو.' },
        { 'المؤشر': 'أفضل 50', 'القيمة': top.length, 'المعنى': 'مرجع لأهم عملاء الفرع آخر 90 يومًا.' },
      ], [30, 22, 90]);
      add('تعليمات', [
        { 'الخطوة': '1', 'الشرح': 'اشتغل فقط في شيت «تنفيذ اليوم» وابدأ من ترتيب التنفيذ 1. لا تحتاج الكتابة في الشيتات المرجعية.' },
        { 'الخطوة': '2', 'الشرح': 'اقرأ «المرحلة» و«سبب التواصل» و«الإجراء المقترح» قبل الاتصال — هذه الأعمدة تلخص لماذا العميل موجود اليوم.' },
        { 'الخطوة': '3', 'الشرح': 'املأ فقط: تمت المتابعة، تم الرد، رد العميل، عملية شراء، قيمة الشراء، هل يحتاج متابعة أخرى، الموعد، الملاحظات.' },
        { 'الخطوة': '4', 'الشرح': 'الملاحظات لا تقل عن 10 حروف، وإذا يحتاج متابعة أخرى لازم تحدد الموعد.' },
        { 'الخطوة': '5', 'الشرح': 'لا تحذف أعمدة الفرع أو كود العميل أو معرف المتابعة؛ هذه الأعمدة تحفظ الربط الصحيح عند الاستيراد.' },
        { 'الخطوة': '6', 'الشرح': 'قبل التسجيل النهائي: ارفع الملف في التطبيق. شاشة المراجعة ستعرض المنفذ والناقص والردود والمبيعات قبل الحفظ.' },
      ], [12, 115]);
      add('تنفيذ اليوم', executionRows, [
        12, 20, 20, 14, 28, 14, 16, 38, 24, 14, 34, 52, 16, 16, 20, 18, 18, 18, 18, 18, 18, 20, 20, 18, 18, 18, 18, 18, 20, 34,
      ]);
      add('إبلاغ النقاط', reference(points, (r) => ({
        'اسم العميل': r.customer_name,
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone,
        'رصيد النقاط': r.points_balance,
      })), [28, 14, 16, 18]);
      add('+500', reference(plus500, (r) => ({
        'اسم العميل': r.customer_name,
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone,
        'عدد الفواتير': r.qualifying_invoice_count,
        'إجمالي +500': r.qualifying_total,
        'أعلى فاتورة': r.highest_invoice,
      })), [28, 14, 16, 18, 20, 18]);
      add('متابعة استثنائية', reference(exceptional, (r) => ({
        'معرف المتابعة': r.id,
        'اسم العميل': r.customer_name,
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone || r.phone,
        'الأولوية': r.priority,
        'السبب': r.followup_reason,
        'التفاصيل': r.request_details,
        'الدكتور المسؤول': r.assigned_doctor,
        'طلب بواسطة': r.created_by_name,
        'موعد المتابعة': r.followup_datetime,
      })), [38, 28, 14, 16, 14, 24, 50, 20, 20, 22]);
      add('تراجع النشاط', reference(riskRows, (r) => ({
        'الحالة': r.trend_state,
        'الترتيب': r.customer_rank,
        'اسم العميل': r.customer_name,
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone,
        'مبيعات 3 شهور': r.recent_sales,
        'الحالي': r.current_period_sales,
        'المعتاد': r.baseline_sales,
        'فجوة الاسترجاع': Math.max(0, num(r.baseline_sales) - num(r.current_period_sales)),
        'التغير %': r.change_vs_baseline_pct,
        'درجة الأولوية': r.priority_score,
        'آخر شراء': r.last_purchase,
      })), [16, 10, 28, 14, 16, 20, 18, 18, 20, 16, 18, 16]);
      add('نشط ونمو', reference(activeRows, (r) => ({
        'الحالة': r.trend_state,
        'الترتيب': r.customer_rank,
        'اسم العميل': r.customer_name,
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone,
        'مبيعات 3 شهور': r.recent_sales,
        'الحالي': r.current_period_sales,
        'المعتاد': r.baseline_sales,
        'التغير %': r.change_vs_baseline_pct,
        'آخر شراء': r.last_purchase,
      })), [16, 10, 28, 14, 16, 20, 18, 18, 16, 16]);
      add('أفضل 50', reference(top, (r) => ({
        'الترتيب': r.customer_rank,
        'اسم العميل': r.customer_name,
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone,
        'مبيعات 3 شهور': r.recent_sales,
        'عدد الفواتير': r.invoice_count,
        'متوسط الفاتورة': r.avg_invoice,
        'آخر شراء': r.last_purchase,
        'درجة الأهمية': r.importance_score,
      })), [10, 28, 14, 16, 20, 16, 18, 16, 16]);
      add('مراجعة قبل الرفع', [
        { 'راجع': 'تمت المتابعة', 'المطلوب': 'اكتب نعم فقط للحالات التي تم تنفيذها فعليًا. غير المنفذ لن يتم استيراده.' },
        { 'راجع': 'تم الرد', 'المطلوب': 'حدد هل العميل رد فعلًا؛ لو لم يرد سيعاد فتح المتابعة تلقائيًا.' },
        { 'راجع': 'الملاحظات', 'المطلوب': '10 حروف على الأقل تلخص ما حدث فعلًا مع العميل.' },
        { 'راجع': 'متابعة أخرى', 'المطلوب': 'لو نعم، لازم يكون موعد المتابعة القادمة محددًا.' },
        { 'راجع': 'عملية شراء', 'المطلوب': 'لو حصل شراء بعد المتابعة سجل القيمة حتى يظهر أثر خدمة العملاء.' },
        { 'راجع': 'الصفوف المكررة', 'المطلوب': 'لا تنسخ نفس العميل لصف جديد. النظام يدمج أسباب ظهوره في نفس الصف.' },
        { 'راجع': 'الاستيراد', 'المطلوب': 'ارفع الملف في التطبيق أولًا؛ شاشة المراجعة تمنع التسجيل لو فيه نقص.' },
      ], [26, 105]);
      (book as any).Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(book, `متابعة_خدمة_العملاء_${branch.replace('فرع ', '')}_${today}.xlsx`);
      toast.success(`تم تجهيز ملف ${branch} — ${executionRows.length} مهمة تنفيذ مرتبة حسب الأولوية`);
    } catch (error) {
      toast.error(`تعذر تجهيز الملف: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const exportBranches: BranchName[] = managerView
    ? ['فرع الشامي', 'فرع شكري']
    : userBranch === 'فرع الشامي' || userBranch === 'فرع شكري'
      ? [userBranch]
      : [];

  return (
    <section className="mx-4 mt-4 rounded-3xl border border-cyan-300/15 bg-[#0b2035] p-4 shadow-xl md:p-5" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black text-cyan-300">مسار عمل الدكاترة</p>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black text-emerald-200">V5 — مراجعة ذكية قبل التسجيل</span>
          </div>
          <h2 className="mt-1 text-xl font-black text-white">تصدير ملف الفرع → تنفيذ مرتب → مراجعة ذكية → استيراد النتائج</h2>
          <p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-slate-400">
            الملف أصبح يبدأ بلوحة اليوم ويشرح سبب وجود كل عميل والإجراء المقترح، والدكتور يكتب فقط نتيجة التواصل. عند الرفع نعرض الردود والمبيعات والنواقص قبل أي تسجيل.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {exportBranches.map((branch) => (
            <button
              key={branch}
              type="button"
              onClick={() => void exportBranchWorkbook(branch)}
              disabled={loading}
              className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:opacity-50"
            >
              <Download className="ml-1 inline" size={17} /> تصدير {branch}
            </button>
          ))}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300">
            <Upload size={17} />
            {loading ? 'جارٍ المعالجة...' : 'مراجعة واستيراد ملف الدكاترة'}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={loading}
              onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {[
          [Workflow, '1. الأولوية محسوبة', 'الاستثنائي → خطر الفقد → التراجع → +500 → النمو → VIP → النقاط.'],
          [FileSpreadsheet, '2. الدكتور يكتب النتيجة فقط', 'لا يحتاج تحليل الأرقام؛ الملف يعرض السبب والمرحلة والإجراء المقترح تلقائيًا.'],
          [ShieldCheck, '3. مراجعة قبل الحفظ', 'نعرض الصفوف الناقصة وسبب النقص ومعدل الرد والشراء قبل الاستيراد.'],
          [CheckCircle2, '4. تسجيل بدون تكرار', 'المنفذ فقط يُسجل، والاستثنائي يحدث طلب الدكتور الأصلي، وإعادة الرفع تعمل Update.'],
        ].map(([Icon, title, desc]) => {
          const I = Icon as typeof Workflow;
          return (
            <div key={String(title)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <div className="flex items-center gap-2 text-sm font-black text-white"><I size={17} className="text-cyan-300" />{String(title)}</div>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-400">{String(desc)}</p>
            </div>
          );
        })}
      </div>

      {preview ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-black text-white">{preview.fileName}</div>
                {branchBreakdown.map((item) => (
                  <span key={item.branch} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black text-slate-300">
                    {item.branch.replace('فرع ', '')}: {item.executed}/{item.total}
                  </span>
                ))}
              </div>
              <div className="mt-1 text-xs font-bold text-slate-400">مصدر القراءة: {preview.sourceSheets.join('، ')}</div>
            </div>
            <button type="button" onClick={() => setPreview(null)} className="rounded-xl border border-white/10 p-2 text-slate-300"><XCircle size={17} /></button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['كل المهام', preview.rows.length, 'bg-white/5', ListChecks],
              ['منفذ', readyRows.length, 'bg-emerald-400/10', BadgeCheck],
              ['ناقص بيانات', incompleteRows.length, 'bg-rose-400/10', AlertTriangle],
              ['جاهز للتسجيل', safeRows.length, 'bg-cyan-400/10', ShieldCheck],
              ['رد العميل', previewStats.responded, 'bg-sky-400/10', CheckCircle2],
              ['لم يرد', previewStats.noAnswer, 'bg-amber-400/10', PhoneMissed],
              ['عمليات شراء', previewStats.purchases, 'bg-violet-400/10', ShoppingCart],
              ['متابعة قادمة', previewStats.next, 'bg-fuchsia-400/10', Workflow],
            ].map(([label, value, tone, Icon]) => {
              const I = Icon as typeof Workflow;
              return (
                <div key={String(label)} className={`rounded-xl p-3 text-center ${String(tone)}`}>
                  <I size={15} className="mx-auto text-slate-300" />
                  <div className="mt-1 text-[10px] font-bold text-slate-400">{String(label)}</div>
                  <div className="mt-1 text-xl font-black text-white">{Number(value)}</div>
                </div>
              );
            })}
          </div>

          {!!readyRows.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="rounded-xl border border-sky-300/15 bg-sky-400/5 p-3"><div className="text-[11px] font-bold text-slate-400">معدل الرد</div><div className="mt-1 text-xl font-black text-sky-200">{previewStats.responseRate}%</div></div>
              <div className="rounded-xl border border-violet-300/15 bg-violet-400/5 p-3"><div className="text-[11px] font-bold text-slate-400">تحويل الرد إلى شراء</div><div className="mt-1 text-xl font-black text-violet-200">{previewStats.conversionRate}%</div></div>
              <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/5 p-3"><div className="text-[11px] font-bold text-slate-400">قيمة الشراء بعد المتابعة</div><div className="mt-1 text-xl font-black text-emerald-200">{money(previewStats.purchaseAmount)}</div></div>
            </div>
          ) : null}

          {incompleteRows.length ? (
            <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-black text-rose-100"><AlertTriangle size={17} />يوجد {incompleteRows.length} صف منفذ يحتاج تصحيح قبل التسجيل</div>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {incompleteRows.slice(0, 8).map((row) => (
                  <div key={rowIdentity(row)} className="rounded-lg border border-rose-200/10 bg-black/10 p-2 text-xs font-bold text-rose-100">
                    <div className="font-black">{row.customerName || 'عميل'} · كود {row.customerCode || '—'} · {queueLabel(row.queueType)}</div>
                    <div className="mt-1 text-rose-200/80">{issueForRow(row)}</div>
                  </div>
                ))}
              </div>
              {incompleteRows.length > 8 ? <div className="mt-2 text-[11px] font-bold text-rose-200/70">+ {incompleteRows.length - 8} صفوف أخرى ناقصة.</div> : null}
            </div>
          ) : readyRows.length ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-black text-emerald-100"><BadgeCheck size={18} />كل المتابعات المنفذة مستوفية البيانات وجاهزة للاستيراد.</div>
          ) : null}

          {!!readyRows.length ? (
            <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
              <table className="min-w-full text-right text-xs">
                <thead className="bg-white/5 text-slate-400"><tr><th className="px-3 py-2">العميل</th><th className="px-3 py-2">القائمة</th><th className="px-3 py-2">الرد</th><th className="px-3 py-2">شراء</th><th className="px-3 py-2">متابعة قادمة</th><th className="px-3 py-2">الجاهزية</th></tr></thead>
                <tbody>
                  {readyRows.slice(0, 10).map((row) => {
                    const issue = issueForRow(row);
                    return <tr key={rowIdentity(row)} className="border-t border-white/5 text-slate-200"><td className="px-3 py-2"><div className="font-black text-white">{row.customerName}</div><div className="text-[10px] text-slate-500">{row.customerCode || 'بدون كود'} · {row.branch.replace('فرع ', '')}</div></td><td className="px-3 py-2">{queueLabel(row.queueType)}</td><td className="px-3 py-2">{row.responded ? 'تم الرد' : 'لم يرد'}</td><td className="px-3 py-2">{row.purchaseAfterFollowup ? money(row.purchaseAmount) : '—'}</td><td className="px-3 py-2">{row.needsNextFollowup ? row.nextFollowupDate || 'ناقص موعد' : 'لا'}</td><td className="px-3 py-2">{issue ? <span className="font-black text-rose-200">{issue}</span> : <span className="font-black text-emerald-200">جاهز</span>}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-400">سيتم تجاهل {Math.max(0, preview.rows.length - readyRows.length)} مهمة غير منفذة تلقائيًا.</div>
            <button
              type="button"
              onClick={() => void importReadyRows()}
              disabled={loading || !safeRows.length || !!incompleteRows.length}
              className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCircle2 className="ml-1 inline" size={16} /> تسجيل النتائج في التطبيق
            </button>
          </div>
          {summary ? <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-black text-emerald-100">تم: {summary.imported} · تحديث: {summary.updated || 0} · مكرر: {summary.duplicates} · متوقف: {summary.skipped}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
