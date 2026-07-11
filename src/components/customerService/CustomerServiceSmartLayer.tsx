import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Loader2, RefreshCw, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ALL_FILTER } from '@/lib/api/customers';
import {
  fetchCustomerServiceFollowups,
  fetchCustomerServiceInsightPools,
  generateTodayFollowupsSmartReport,
  riskLevel,
  type CustomerServiceInsightPools,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';
import { rowMatchesCurrentUserScope } from '@/lib/security/userDataScope';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { normalizeBranchName } from '@/lib/branch';
import { CustomerFlagChips, getCustomerCodeSafe, resolveCustomerBranch } from '@/lib/customerDisplay';
import { BRANCHES } from '@/lib/constants';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type SmartRow = FollowupRow & {
  smart_source?: string;
  virtual?: boolean;
  smart_score?: number;
  source_type?: string | null;
};
type MixRow = { source_type: string; rows_count: number; open_count: number; completed_count: number };

const LIMIT = 220;
const EMPTY_INSIGHTS: CustomerServiceInsightPools = {
  important: [],
  reduced: [],
  stopped60: [],
  strong: [],
  source: 'not_loaded',
  warnings: [],
};

function text(value: unknown, fallback = 'غير محدد') {
  return String(value ?? '').trim() || fallback;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return `${Number.isFinite(n) ? n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '0'} ج`;
}

function customerName(row: FollowupRow) {
  return text(row.customer_name || row.name, 'عميل غير مسجل');
}

function phoneOf(row: FollowupRow) {
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}

function totalSpent(row: FollowupRow) {
  return Number(row.customer_metrics?.total_spent || row.total_spent || 0);
}

function avgMonthly(row: FollowupRow) {
  return Number(row.customer_metrics?.avg_monthly || 0);
}

function segmentOf(row: FollowupRow) {
  return text(row.customer_metrics?.segment || row.segment || row.classification, 'غير مصنف');
}

function statusOf(row: FollowupRow) {
  return text(row.followup_status || row.status || row.contact_status, 'معلق');
}

function responsibleOf(row: FollowupRow) {
  return text(row.responsible_name || row.assigned_to || row.assigned_doctor, 'غير مسند');
}

function dueAt(row: FollowupRow) {
  return row.followup_datetime || row.followup_date || row.next_followup_date || row.date || row.created_at || null;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير محدد';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function isCompleted(row: FollowupRow) {
  const status = statusOf(row);
  return Boolean(row.completed_at || ['تم', 'تم التواصل', 'تم الشراء بعد المتابعة', 'completed', 'done'].includes(status));
}

function isOverdue(row: FollowupRow) {
  if (isCompleted(row) || row.postponed_until) return false;
  const raw = dueAt(row);
  return Boolean(raw && new Date(raw).getTime() < Date.now());
}

function minutesLate(row: FollowupRow) {
  const raw = dueAt(row);
  if (!raw) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(raw).getTime()) / 60_000));
}

function hasValidPhone(row: FollowupRow) {
  const phone = phoneOf(row);
  return Boolean(phone && isValidEgyptPhone(phone, getCustomerCodeSafe(row)));
}

function canonicalKey(row: FollowupRow) {
  const digits = phoneOf(row).replace(/\D/g, '');
  return String(row.customer_id || getCustomerCodeSafe(row) || digits || customerName(row))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function smartScore(row: SmartRow) {
  let score = 0;
  if (isOverdue(row)) score += 250 + Math.min(150, minutesLate(row));
  if (row.needs_manager) score += 180;
  if (!hasValidPhone(row)) score += 120;
  if (row.virtual) score += 80;
  if (/عاجل|urgent|high/i.test(String(row.priority || ''))) score += 90;
  if (/مهم جدًا|vip/i.test(segmentOf(row))) score += 75;
  if (/متوقف/i.test(String(row.customer_status || row.customer_metrics?.customer_status || ''))) score += 70;
  if (/مهدد/i.test(String(row.customer_status || row.customer_metrics?.customer_status || ''))) score += 60;
  score += Math.min(90, Math.round(totalSpent(row) / 2200));
  score += Math.min(55, Math.round(avgMonthly(row) / 650));
  return score;
}

function dedupe(rows: SmartRow[]) {
  const map = new Map<string, SmartRow>();
  for (const row of rows) {
    const key = canonicalKey(row);
    if (!key) continue;
    const enriched = { ...row, smart_score: smartScore(row) };
    const old = map.get(key);
    if (!old || smartScore(enriched) > smartScore(old) || (!row.virtual && old.virtual)) map.set(key, enriched);
  }
  return [...map.values()].sort((a, b) => smartScore(b) - smartScore(a) || totalSpent(b) - totalSpent(a));
}

function virtualRows(insights: CustomerServiceInsightPools): SmartRow[] {
  return [
    ...insights.important.map((row) => ({ ...row, id: `smart-important-${canonicalKey(row)}`, virtual: true, smart_source: 'important' })),
    ...insights.reduced.map((row) => ({ ...row, id: `smart-reduced-${canonicalKey(row)}`, virtual: true, smart_source: 'reduced' })),
    ...insights.stopped60.map((row) => ({ ...row, id: `smart-stopped-${canonicalKey(row)}`, virtual: true, smart_source: 'stopped60' })),
  ];
}

function rowSource(row: SmartRow) {
  if (row.smart_source === 'important') return 'مقترح مهم/VIP';
  if (row.smart_source === 'reduced') return 'قلل التعامل';
  if (row.smart_source === 'stopped60') return 'متوقف أكثر من شهرين';
  if (row.source_type === 'daily_core') return 'أساسي يومي';
  if (row.source_type === 'quick_followup' || row.request_type || row.request_details) return 'سريع/طلب دكتور';
  if (row.source_type === 'scheduled_followup' || row.next_followup_date) return 'مجدول';
  if (row.source_type === 'carried_over') return 'مرحّل';
  if (isOverdue(row)) return 'متأخر';
  return 'متابعة مفتوحة';
}

function nextAction(row: SmartRow) {
  if (row.virtual) return 'حوّله لمتابعة الآن واتصل بالعميل';
  if (!hasValidPhone(row)) return 'صحّح رقم العميل قبل أي تواصل';
  if (row.needs_manager) return 'تصعيد ومراجعة مدير الفرع';
  if (isOverdue(row)) return 'تواصل عاجل وسجل نتيجة واضحة';
  if (row.postponed_until) return `انتظار الموعد المؤجل: ${formatDateTime(row.postponed_until)}`;
  if (row.next_followup_date) return `متابعة مجدولة: ${formatDateTime(row.next_followup_date)}`;
  return 'تواصل، سجل النتيجة، وحدد الخطوة القادمة';
}

function rowUrl(row: SmartRow, mode: 'details' | 'edit' = 'details') {
  if (row.virtual) return `/customer-service?tab=add&name=${encodeURIComponent(customerName(row))}&phone=${encodeURIComponent(phoneOf(row))}&code=${encodeURIComponent(getCustomerCodeSafe(row))}`;
  const url = new URL('/customer-service', window.location.origin);
  url.searchParams.set('followupId', row.id);
  url.searchParams.set('openDetails', mode === 'details' ? '1' : '0');
  if (mode === 'edit') url.searchParams.set('mode', 'edit');
  return `${url.pathname}${url.search}`;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    daily_core: 'الأساسي اليومي',
    quick_followup: 'السريع',
    scheduled_followup: 'المجدول',
    carried_over: 'المرحّل',
    doctor_requested_followup: 'طلبات الدكاترة',
    unknown: 'غير محدد',
  };
  return labels[source] || source || 'غير محدد';
}

async function fetchMix(branch: string) {
  if (!isSupabaseConfigured) return [] as MixRow[];
  try {
    let query = supabase
      .from('customer_service_daily_queue_mix_v1')
      .select('source_type,rows_count,open_count,completed_count,branch,followup_day')
      .eq('followup_day', new Date().toISOString().slice(0, 10));
    if (branch !== ALL_FILTER) query = query.eq('branch', branch);
    const { data, error } = await query;
    if (error) return [];
    const grouped = new Map<string, MixRow>();
    for (const item of (data || []) as Array<MixRow & { branch?: string }>) {
      const key = item.source_type || 'unknown';
      const current = grouped.get(key) || { source_type: key, rows_count: 0, open_count: 0, completed_count: 0 };
      current.rows_count += Number(item.rows_count || 0);
      current.open_count += Number(item.open_count || 0);
      current.completed_count += Number(item.completed_count || 0);
      grouped.set(key, current);
    }
    return [...grouped.values()];
  } catch {
    return [];
  }
}

async function generateCoreDailyQueue(branch: string, userName: string) {
  const branchArg = branch === ALL_FILTER ? null : branch;
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc('dawaa_generate_customer_service_daily_followups_v2', {
        p_branch: branchArg,
        p_created_by_name: userName || 'خدمة العملاء',
      });
      if (!error) {
        const rows = Array.isArray(data) ? data : [];
        return {
          created: rows.reduce((sum, row: any) => sum + Number(row.created_count || 0), 0),
          skipped: rows.reduce((sum, row: any) => sum + Number(row.skipped_duplicates || 0), 0),
          candidates: rows.reduce((sum, row: any) => sum + Number(row.candidate_count || 0), 0),
          source: 'rpc',
        };
      }
    } catch {
      // Fallback below.
    }
  }
  const report = await generateTodayFollowupsSmartReport(branch, userName);
  return {
    created: report.created_count,
    skipped: report.skipped_duplicates_count + report.skipped_open_followups_count,
    candidates: report.candidate_count,
    source: 'fallback',
  };
}

export default function CustomerServiceSmartLayer() {
  const { user } = useAuth();
  const userRole = user?.role || '';
  const canAllBranches = canSeeAllBranches(userRole);
  const [branch, setBranch] = useState(canAllBranches ? ALL_FILTER : normalizeBranchName(user?.branch || '') || ALL_FILTER);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [insights, setInsights] = useState<CustomerServiceInsightPools>(EMPTY_INSIGHTS);
  const [mix, setMix] = useState<MixRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('dawaa_cs_smart_layer_collapsed') === '1');

  const scopedBranch = useMemo(() => {
    const scopedUser = { role: userRole, branch: user?.branch || '' };
    return canAllBranches ? effectiveBranchFilter(scopedUser, branch, ALL_FILTER) : normalizeBranchName(user?.branch || '') || ALL_FILTER;
  }, [branch, canAllBranches, user?.branch, userRole]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [followups, pools, mixRows] = await Promise.all([
        fetchCustomerServiceFollowups({ branch: scopedBranch, status: ALL_FILTER, search: query, limit: LIMIT }),
        fetchCustomerServiceInsightPools(scopedBranch),
        fetchMix(scopedBranch),
      ]);
      setRows(followups.filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>)));
      setInsights(pools);
      setMix(mixRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل مركز التشغيل الذكي');
    } finally {
      setLoading(false);
    }
  }, [query, scopedBranch, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const smartRows = useMemo(() => dedupe([...rows, ...virtualRows(insights)]), [rows, insights]);
  const openRows = useMemo(() => smartRows.filter((row) => !isCompleted(row)), [smartRows]);
  const topPriority = useMemo(() => openRows.slice(0, 6), [openRows]);
  const overdue = useMemo(() => openRows.filter(isOverdue), [openRows]);
  const needsManager = useMemo(() => openRows.filter((row) => row.needs_manager), [openRows]);
  const dataIssues = useMemo(() => openRows.filter((row) => !hasValidPhone(row) || !getCustomerCodeSafe(row)), [openRows]);
  const scheduled = useMemo(() => openRows.filter((row) => row.next_followup_date || row.postponed_until), [openRows]);
  const suggested = useMemo(() => openRows.filter((row) => row.virtual), [openRows]);
  const completed = useMemo(() => rows.filter(isCompleted), [rows]);
  const recoveredAmount = useMemo(() => rows.reduce((sum, row) => sum + Number(row.purchase_amount || 0), 0), [rows]);

  const generateToday = async () => {
    setGenerating(true);
    try {
      const result = await generateCoreDailyQueue(scopedBranch, user?.name || 'خدمة العملاء');
      toast.success(`تم إنشاء ${result.created} متابعة · مرشحون ${result.candidates} · تكرار/مفتوح ${result.skipped}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء قائمة اليوم');
    } finally {
      setGenerating(false);
    }
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem('dawaa_cs_smart_layer_collapsed', next ? '1' : '0');
  };

  return (
    <section className="customer-service-smart-layer mb-5 rounded-3xl border border-cyan-400/30 bg-slate-950/55 p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-black text-cyan-100">
            <Sparkles className="h-4 w-4" /> طبقة الذكاء التشغيلي لخدمة العملاء
          </span>
          <h2 className="mt-2 text-2xl font-black text-white">ابدأ من أهم عميل، وسجل نتيجة، ولا تترك متابعة تفلت</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">
            هذه الطبقة لا تلغي أدوات الصفحة القديمة؛ هي ترتب العمل وتفتح لك المكان الصحيح داخل نفس الصفحة: إنشاء، تعديل، سجل، تقارير، تصدير، قوالب، وتحليل.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث ذكي
          </button>
          <button type="button" className="btn-primary flex items-center gap-2" onClick={() => void generateToday()} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} إنشاء 30/فرع
          </button>
          <button type="button" className="btn-secondary" onClick={toggleCollapsed}>{collapsed ? 'إظهار التفاصيل' : 'إخفاء التفاصيل'}</button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr_auto]">
        <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)} disabled={!canAllBranches}>
          {canAllBranches && <option value={ALL_FILTER}>كل الفروع</option>}
          {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute right-4 top-3.5 h-5 w-5 text-slate-500" />
          <input
            className="input-dark pr-12"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="بحث ذكي بالاسم / الكود / الهاتف / المسؤول / سبب المتابعة"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <SmartLink href="/customer-service?tab=today" label="متابعات اليوم" />
          <SmartLink href="/customer-service?tab=history" label="السجل" />
          <SmartLink href="/customer-service?tab=add" label="إضافة" />
          <SmartLink href="/customer-service?tab=performance" label="الأداء" />
          <SmartLink href="/customer-service?tab=scripts" label="القوالب" />
          <SmartLink href="/customer-data-review" label="مراجعة البيانات" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={<Clock className="h-5 w-5" />} label="مفتوح الآن" value={openRows.length} href="/customer-service?tab=today" />
        <MetricCard icon={<AlertTriangle className="h-5 w-5" />} label="متأخر" value={overdue.length} href="/customer-service?filter=overdue" danger />
        <MetricCard icon={<ShieldAlert className="h-5 w-5" />} label="يحتاج مدير" value={needsManager.length} href="/customer-service?tab=alerts" danger />
        <MetricCard icon={<Sparkles className="h-5 w-5" />} label="مقترحات ذكية" value={suggested.length} href="/customer-service?tab=strong" />
        <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="المكتمل" value={completed.length} href="/customer-service?tab=history" />
        <MetricCard icon={<BarChart3 className="h-5 w-5" />} label="مبيعات بعد المتابعة" value={money(recoveredAmount)} href="/customer-service?tab=impact" />
      </div>

      {!collapsed && (
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)]">
          <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-black text-white">أهم العملاء للعمل الآن</h3>
                <p className="text-xs font-bold text-slate-400">مرتب حسب التأخير، الخطورة، قيمة العميل، ومصدر المتابعة.</p>
              </div>
              {loading && <Loader2 className="h-5 w-5 animate-spin text-cyan-200" />}
            </div>
            <div className="grid gap-2 xl:grid-cols-2">
              {topPriority.map((row) => (
                <article key={`${row.id}-${canonicalKey(row)}`} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-white">{customerName(row)}</div>
                      <div className="mt-1 text-xs font-bold text-slate-400">{getCustomerCodeSafe(row) || 'بدون كود'} · {resolveCustomerBranch(row).branch}</div>
                      <CustomerFlagChips row={row} className="mt-2" />
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${isOverdue(row) ? 'border-red-400/40 bg-red-500/10 text-red-100' : row.virtual ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'}`}>
                      {rowSource(row)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs font-bold text-slate-300 sm:grid-cols-2">
                    <span>المسؤول: {responsibleOf(row)}</span>
                    <span>الأولوية: {smartScore(row)}</span>
                    <span>إجمالي: {money(totalSpent(row))}</span>
                    <span>خطورة: {riskLevel(row)}</span>
                    <span className={isOverdue(row) ? 'text-red-200' : ''}>{isOverdue(row) ? `متأخر ${minutesLate(row)} دقيقة` : formatDateTime(dueAt(row))}</span>
                    <span className={!hasValidPhone(row) ? 'text-amber-200' : ''}>{hasValidPhone(row) ? 'رقم صالح' : 'رقم يحتاج مراجعة'}</span>
                  </div>
                  <p className="mt-2 rounded-xl border border-slate-700 bg-slate-950/50 p-2 text-xs font-bold leading-6 text-slate-200">{nextAction(row)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <SmartLink href={rowUrl(row, 'edit')} label={row.virtual ? 'إنشاء متابعة' : 'تسجيل نتيجة'} primary />
                    <SmartLink href={rowUrl(row, 'details')} label="ملف العميل" />
                    <SmartLink href="/customer-service?tab=history" label="السجل" />
                  </div>
                </article>
              ))}
              {!topPriority.length && <p className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-center text-sm font-bold text-slate-400">لا توجد متابعات مفتوحة في نطاق العرض الحالي.</p>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
              <h3 className="font-black text-white">توزيع قائمة اليوم</h3>
              <p className="text-xs font-bold text-slate-400">يوضح هل العدد فوق 60 بسبب السريع/المجدول/المرحّل، وليس تكرار عشوائي.</p>
              <div className="mt-3 space-y-2">
                {mix.map((item) => (
                  <div key={item.source_type} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-bold text-slate-200">
                    <span>{sourceLabel(item.source_type)}</span>
                    <span>إجمالي {item.rows_count} · مفتوح {item.open_count} · مكتمل {item.completed_count}</span>
                  </div>
                ))}
                {!mix.length && <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">طبّق migration الخاصة بـ customer_service_daily_queue_mix_v1 لعرض التوزيع الدقيق. حتى ذلك الوقت، الصفحة تعمل من البيانات الأساسية.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
              <h3 className="font-black text-white">تنبيهات تشغيلية</h3>
              <div className="mt-3 grid gap-2 text-xs font-bold text-slate-200">
                <SmartWarning active={overdue.length > 0} text={`${overdue.length} متابعة متأخرة: افتحها وسجل نتيجة أو سبب تأجيل.`} />
                <SmartWarning active={needsManager.length > 0} text={`${needsManager.length} متابعة تحتاج تدخل مدير الفرع.`} />
                <SmartWarning active={dataIssues.length > 0} text={`${dataIssues.length} عميل لديه كود/رقم يحتاج مراجعة.`} />
                <SmartWarning active={scheduled.length > 0} text={`${scheduled.length} متابعة مجدولة أو مؤجلة يجب احترام موعدها.`} />
                {insights.warnings.map((warning) => <SmartWarning key={warning} active text={warning} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MetricCard({ icon, label, value, href, danger }: { icon: React.ReactNode; label: string; value: string | number; href: string; danger?: boolean }) {
  return (
    <a href={href} className={`rounded-2xl border p-3 transition ${danger ? 'border-red-400/30 bg-red-500/10 hover:border-red-300' : 'border-slate-700 bg-slate-900/70 hover:border-cyan-400/40'}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-black text-slate-400">
        <span>{label}</span>
        <span className={danger ? 'text-red-200' : 'text-cyan-200'}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </a>
  );
}

function SmartLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return <a className={primary ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'} href={href}>{label}</a>;
}

function SmartWarning({ active, text }: { active: boolean; text: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${active ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`}>
      {active ? text : 'لا يوجد تنبيه حاليًا'}
    </div>
  );
}
