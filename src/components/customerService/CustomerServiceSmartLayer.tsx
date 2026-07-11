import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

type WarningItem = { id: string; text: string; href?: string; tone?: 'amber' | 'red' | 'cyan' | 'emerald' };

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

function delayLabel(row: FollowupRow) {
  const minutes = minutesLate(row);
  if (!minutes) return 'في الموعد';
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
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
  if (!getCustomerCodeSafe(row)) score += 95;
  if (resolveCustomerBranch(row).needsReview) score += 60;
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

function sourceKey(row: SmartRow) {
  if (row.source_type) return String(row.source_type);
  if (row.virtual || row.smart_source) return 'smart_suggestion';
  if (row.request_type || row.request_details) return 'quick_followup';
  if (row.next_followup_date || row.postponed_until) return 'scheduled_followup';
  if (isOverdue(row)) return 'carried_over';
  return 'daily_core';
}

function nextAction(row: SmartRow) {
  if (row.virtual) return 'حوّله لمتابعة الآن واتصل بالعميل';
  if (!hasValidPhone(row)) return 'صحّح رقم العميل قبل أي تواصل';
  if (!getCustomerCodeSafe(row)) return 'راجع كود العميل قبل إغلاق المتابعة';
  if (resolveCustomerBranch(row).needsReview) return 'راجع الفرع قبل الإسناد النهائي';
  if (row.needs_manager) return 'تصعيد ومراجعة مدير الفرع';
  if (isOverdue(row)) return 'تواصل عاجل وسجل نتيجة واضحة';
  if (row.postponed_until) return `انتظار الموعد المؤجل: ${formatDateTime(row.postponed_until)}`;
  if (row.next_followup_date) return `متابعة مجدولة: ${formatDateTime(row.next_followup_date)}`;
  return 'تواصل، سجل النتيجة، وحدد الخطوة القادمة';
}

function operationScript(row: SmartRow) {
  const name = customerName(row);
  const reason = row.request_details || row.followup_reason || nextAction(row);
  if (!hasValidPhone(row)) return 'قبل إرسال أي رسالة: راجع رقم العميل أو اطلب تحديث الرقم من الفرع، ثم سجل ملاحظة واضحة.';
  if (row.needs_manager) return `أهلا بحضرتك ${name}. مع حضرتك صيدليات دواء. بنراجع طلب حضرتك مع المدير المختص وهنرجع لحضرتك بأسرع وقت. تحت أمر حضرتك.`;
  if (isOverdue(row)) return `أهلا بحضرتك ${name}. مع حضرتك صيدليات دواء. بنعتذر عن التأخير وبنتابع مع حضرتك بخصوص ${reason}. يهمنا نطمن إن طلب حضرتك تم بالشكل المناسب.`;
  if (/vip|مهم جدًا|مهم جدا/i.test(segmentOf(row))) return `أهلا بحضرتك ${name}. مع حضرتك صيدليات دواء. حضرتك من عملائنا المميزين وبنطمن على احتياجاتك الشهرية. تحت أمر حضرتك في أي وقت.`;
  if (/متوقف|stop/i.test(String(row.customer_status || row.customer_metrics?.customer_status || ''))) return `أهلا بحضرتك ${name}. مع حضرتك صيدليات دواء. بنطمن على حضرتك لأن بقالنا فترة ما تشرفناش بتعاملك، ويهمنا نعرف لو في أي احتياج نقدر نوفره لحضرتك.`;
  return `أهلا بحضرتك ${name}. مع حضرتك صيدليات دواء. بنطمن على حضرتك بخصوص ${reason}. نتشرف بخدمة حضرتك دائمًا.`;
}

function rowUrl(row: SmartRow, mode: 'details' | 'edit' = 'details') {
  if (row.virtual) return `/customer-service?tab=add&name=${encodeURIComponent(customerName(row))}&phone=${encodeURIComponent(phoneOf(row))}&code=${encodeURIComponent(getCustomerCodeSafe(row))}`;
  const url = new URL('/customer-service', window.location.origin);
  url.searchParams.set('followupId', row.id);
  url.searchParams.set('openDetails', mode === 'details' ? '1' : '0');
  if (mode === 'edit') url.searchParams.set('mode', 'edit');
  return `${url.pathname}${url.search}`;
}

function whatsappHref(row: SmartRow) {
  const digits = phoneOf(row).replace(/\D/g, '');
  if (!digits) return '';
  const phone = digits.startsWith('20') ? digits : digits.startsWith('0') ? `2${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(operationScript(row))}`;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    daily_core: 'الأساسي اليومي',
    quick_followup: 'السريع',
    scheduled_followup: 'المجدول',
    carried_over: 'المرحّل / المتأخر',
    doctor_requested_followup: 'طلبات الدكاترة',
    smart_suggestion: 'مقترحات ذكية',
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

function buildFallbackMix(rows: SmartRow[]): MixRow[] {
  const grouped = new Map<string, MixRow>();
  for (const row of rows) {
    const key = sourceKey(row);
    const current = grouped.get(key) || { source_type: key, rows_count: 0, open_count: 0, completed_count: 0 };
    current.rows_count += 1;
    if (isCompleted(row)) current.completed_count += 1;
    else current.open_count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.rows_count - a.rows_count);
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
  const [fastMode, setFastMode] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    try {
      window.sessionStorage.removeItem('dawaa_scroll_/customer-service');
      window.sessionStorage.removeItem('dawaa_scroll/customer-service');
      window.sessionStorage.removeItem('dawaa_scroll__customer-service');
    } catch {
      // ignore storage access issues
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  }, []);

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
  const topPriority = useMemo(() => openRows.slice(0, fastMode ? 12 : 8), [fastMode, openRows]);
  const overdue = useMemo(() => openRows.filter(isOverdue), [openRows]);
  const needsManager = useMemo(() => openRows.filter((row) => row.needs_manager), [openRows]);
  const dataIssues = useMemo(() => openRows.filter((row) => !hasValidPhone(row) || !getCustomerCodeSafe(row)), [openRows]);
  const branchIssues = useMemo(() => openRows.filter((row) => resolveCustomerBranch(row).needsReview), [openRows]);
  const scheduled = useMemo(() => openRows.filter((row) => row.next_followup_date || row.postponed_until), [openRows]);
  const suggested = useMemo(() => openRows.filter((row) => row.virtual), [openRows]);
  const completed = useMemo(() => rows.filter(isCompleted), [rows]);
  const recoveredAmount = useMemo(() => rows.reduce((sum, row) => sum + Number(row.purchase_amount || 0), 0), [rows]);
  const displayMix = useMemo(() => (mix.length ? mix : buildFallbackMix(smartRows)), [mix, smartRows]);
  const selectedRow = useMemo(() => {
    if (!smartRows.length) return null;
    return smartRows.find((row) => canonicalKey(row) === selectedKey) || topPriority[0] || openRows[0] || smartRows[0];
  }, [openRows, selectedKey, smartRows, topPriority]);
  const selectedIndex = useMemo(() => {
    if (!selectedRow) return -1;
    return topPriority.findIndex((row) => canonicalKey(row) === canonicalKey(selectedRow));
  }, [selectedRow, topPriority]);
  const nextSelectedRow = selectedIndex >= 0 ? topPriority[selectedIndex + 1] : null;
  const selectedBranch = selectedRow ? resolveCustomerBranch(selectedRow) : null;
  const selectedWhatsApp = selectedRow ? whatsappHref(selectedRow) : '';

  useEffect(() => {
    if (!selectedRow) return;
    const key = canonicalKey(selectedRow);
    if (key && key !== selectedKey) setSelectedKey(key);
  }, [selectedKey, selectedRow]);

  const branchDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of smartRows) {
      const branchName = resolveCustomerBranch(row).branch || 'غير محدد';
      map.set(branchName, (map.get(branchName) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [smartRows]);

  const warnings = useMemo<WarningItem[]>(() => {
    const list: WarningItem[] = [];
    if (overdue.length > 0) list.push({ id: 'overdue', text: `${overdue.length} متابعة متأخرة: افتحها وسجل نتيجة أو سبب تأجيل.`, href: '/customer-service?filter=overdue', tone: 'red' });
    if (needsManager.length > 0) list.push({ id: 'manager', text: `${needsManager.length} متابعة تحتاج تدخل مدير الفرع.`, href: '/customer-service?tab=alerts', tone: 'red' });
    if (dataIssues.length > 0) list.push({ id: 'data', text: `${dataIssues.length} عميل لديه كود/رقم يحتاج مراجعة.`, href: '/customer-data-review', tone: 'amber' });
    if (branchIssues.length > 0) list.push({ id: 'branch', text: `${branchIssues.length} عميل يحتاج مراجعة الفرع.`, href: '/customer-data-review', tone: 'amber' });
    if (scheduled.length > 0) list.push({ id: 'scheduled', text: `${scheduled.length} متابعة مجدولة أو مؤجلة يجب احترام موعدها.`, href: '/customer-service?tab=today', tone: 'cyan' });
    insights.warnings.forEach((warning, index) => list.push({ id: `insight-${index}`, text: warning, tone: 'amber' }));
    return list;
  }, [branchIssues.length, dataIssues.length, insights.warnings, needsManager.length, overdue.length, scheduled.length]);

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

  const copyScript = async () => {
    if (!selectedRow) return;
    try {
      await navigator.clipboard.writeText(operationScript(selectedRow));
      toast.success('تم نسخ سكريبت التواصل');
    } catch {
      toast.info('انسخ النص يدويًا من صندوق السكريبت');
    }
  };

  return (
    <section className="customer-service-smart-layer mb-5 scroll-mt-24 rounded-3xl border border-cyan-400/30 bg-slate-950/55 p-4 pt-6 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-black text-cyan-100">
            <Sparkles className="h-4 w-4" /> مركز قيادة خدمة العملاء
          </span>
          <h2 className="mt-2 text-2xl font-black text-white">ابدأ من أهم عميل، وشغّل المتابعة من شاشة واحدة</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">
            قائمة أولوية + ملف مختصر + إجراءات سريعة + سكريبت واتساب جاهز. الهدف إن مسؤول خدمة العملاء ينجز المتابعة بدون تنقل زائد.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث ذكي
          </button>
          <button type="button" className="btn-primary flex items-center gap-2" onClick={() => void generateToday()} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} إنشاء 30/فرع
          </button>
          <button type="button" className={fastMode ? 'btn-primary' : 'btn-secondary'} onClick={() => setFastMode((value) => !value)}>
            {fastMode ? 'وضع سريع مفعل' : 'وضع التشغيل السريع'}
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
        <>
          <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(280px,.85fr)_minmax(0,1.2fr)_minmax(320px,.85fr)]">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-black text-white">ابدأ من هنا</h3>
                  <p className="text-xs font-bold text-slate-400">أعلى العملاء أولوية حسب التأخير والخطورة والقيمة.</p>
                </div>
                {loading && <Loader2 className="h-5 w-5 animate-spin text-cyan-200" />}
              </div>
              <div className="grid max-h-[680px] gap-2 overflow-y-auto pr-1">
                {topPriority.map((row, index) => {
                  const key = canonicalKey(row);
                  const active = selectedRow && canonicalKey(selectedRow) === key;
                  return (
                    <button
                      key={`${row.id}-${key}`}
                      type="button"
                      onClick={() => setSelectedKey(key)}
                      className={`rounded-2xl border p-3 text-right transition ${active ? 'border-cyan-300 bg-cyan-500/15' : 'border-slate-700 bg-slate-900/70 hover:border-cyan-400/40'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-base font-black text-white">{index + 1}. {customerName(row)}</div>
                          <div className="mt-1 text-xs font-bold text-slate-400">{getCustomerCodeSafe(row) || 'بدون كود'} · {resolveCustomerBranch(row).branch}</div>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${isOverdue(row) ? 'border-red-400/40 bg-red-500/10 text-red-100' : row.virtual ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'}`}>
                          {rowSource(row)}
                        </span>
                      </div>
                      <CustomerFlagChips row={row} className="mt-2" />
                      <div className="mt-2 grid gap-1 text-xs font-bold text-slate-300">
                        <span>المسؤول: {responsibleOf(row)}</span>
                        <span className={isOverdue(row) ? 'text-red-200' : ''}>{isOverdue(row) ? `متأخر ${delayLabel(row)}` : formatDateTime(dueAt(row))}</span>
                        <span>الأولوية: {smartScore(row)} · إجمالي {money(totalSpent(row))}</span>
                      </div>
                    </button>
                  );
                })}
                {!topPriority.length && <p className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-center text-sm font-bold text-slate-400">لا توجد متابعات مفتوحة في نطاق العرض الحالي.</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
              <h3 className="font-black text-white">ملف العميل المختار</h3>
              {!selectedRow ? (
                <p className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-center text-sm font-bold text-slate-400">اختر عميلًا من قائمة الأولوية لعرض التفاصيل والإجراءات.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h4 className="text-2xl font-black text-white">{customerName(selectedRow)}</h4>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-black text-slate-200">
                          <span className="rounded-full border border-slate-600 px-3 py-1">{getCustomerCodeSafe(selectedRow) || 'بدون كود'}</span>
                          <span className="rounded-full border border-slate-600 px-3 py-1">{phoneOf(selectedRow) || 'بدون رقم'}</span>
                          <span className="rounded-full border border-slate-600 px-3 py-1">{selectedBranch?.branch || 'غير محدد'}</span>
                        </div>
                        <CustomerFlagChips row={selectedRow} className="mt-3" />
                      </div>
                      <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-center">
                        <div className="text-xs font-black text-slate-400">درجة الأولوية</div>
                        <div className="text-3xl font-black text-cyan-100">{smartScore(selectedRow)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MiniStat label="إجمالي مشتريات" value={money(totalSpent(selectedRow))} />
                    <MiniStat label="متوسط شهري" value={money(avgMonthly(selectedRow))} />
                    <MiniStat label="الحالة" value={statusOf(selectedRow)} />
                    <MiniStat label="موعد/تأخير" value={isOverdue(selectedRow) ? delayLabel(selectedRow) : formatDateTime(dueAt(selectedRow))} danger={isOverdue(selectedRow)} />
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                    <div className="text-sm font-black text-white">اعمل التالي</div>
                    <p className="mt-2 text-sm font-bold leading-7 text-slate-200">{nextAction(selectedRow)}</p>
                  </div>

                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-black text-white">سكريبت واتساب مقترح</h4>
                      <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => void copyScript()}>نسخ السكريبت</button>
                    </div>
                    <p className="mt-3 whitespace-pre-line rounded-xl border border-emerald-300/20 bg-slate-950/50 p-3 text-sm font-bold leading-7 text-emerald-50">
                      {operationScript(selectedRow)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
                <h3 className="font-black text-white">الإجراءات السريعة</h3>
                <div className="mt-3 grid gap-2">
                  {selectedRow && selectedWhatsApp ? <a className="btn-primary text-center" href={selectedWhatsApp} target="_blank" rel="noreferrer">إرسال واتساب بالسكريبت</a> : <button type="button" className="btn-primary opacity-60" disabled>واتساب غير متاح</button>}
                  {selectedRow && phoneOf(selectedRow) ? <a className="btn-secondary text-center" href={`tel:${phoneOf(selectedRow)}`}>اتصال الآن</a> : <button type="button" className="btn-secondary opacity-60" disabled>لا يوجد رقم للاتصال</button>}
                  {selectedRow && <SmartLink href={rowUrl(selectedRow, 'edit')} label={selectedRow.virtual ? 'إنشاء متابعة' : 'تسجيل نتيجة'} primary />}
                  {selectedRow && <SmartLink href={rowUrl(selectedRow, 'details')} label="فتح ملف العميل" />}
                  {selectedRow && <SmartLink href="/customer-data-review" label="تصحيح بيانات العميل" />}
                  {nextSelectedRow && <button type="button" className="btn-secondary" onClick={() => setSelectedKey(canonicalKey(nextSelectedRow))}>العميل التالي في الدور</button>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
                <h3 className="font-black text-white">وضع التشغيل السريع</h3>
                <div className="mt-3 space-y-2 text-xs font-bold text-slate-300">
                  <p>1) راجع الملخص والسكريبت.</p>
                  <p>2) اضغط واتساب أو اتصال.</p>
                  <p>3) سجل النتيجة.</p>
                  <p>4) انتقل تلقائيًا للعميل التالي.</p>
                </div>
                <button type="button" className={fastMode ? 'btn-primary mt-3 w-full' : 'btn-secondary mt-3 w-full'} onClick={() => setFastMode((value) => !value)}>
                  {fastMode ? 'إيقاف التشغيل السريع' : 'تشغيل الوضع السريع'}
                </button>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
                <h3 className="font-black text-white">تنبيهات تشغيلية</h3>
                <div className="mt-3 grid gap-2 text-xs font-bold text-slate-200">
                  {warnings.map((warning) => <SmartWarning key={warning.id} {...warning} />)}
                  {!warnings.length && <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-emerald-100">لا توجد تنبيهات تشغيلية حاليًا</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.65fr)]">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
              <h3 className="font-black text-white">توزيع قائمة اليوم</h3>
              <p className="text-xs font-bold text-slate-400">توزيع عملي من بيانات الصفحة الحالية، ويستبدل تلقائيًا بالتوزيع الدقيق عند توفر view التحليل اليومية.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <MiniStat label="إجمالي القائمة" value={smartRows.length} />
                <MiniStat label="مفتوح" value={openRows.length} />
                <MiniStat label="متأخر" value={overdue.length} danger />
                <MiniStat label="VIP / مقترح" value={suggested.length} />
                <MiniStat label="بدون كود/رقم" value={dataIssues.length} danger />
                <MiniStat label="فرع غير مؤكد" value={branchIssues.length} danger />
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {displayMix.map((item) => (
                  <div key={item.source_type} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-bold text-slate-200">
                    <span>{sourceLabel(item.source_type)}</span>
                    <span>إجمالي {item.rows_count} · مفتوح {item.open_count} · مكتمل {item.completed_count}</span>
                  </div>
                ))}
                {!displayMix.length && <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-3 text-center text-xs font-bold text-slate-300">لا توجد بيانات كافية لتوزيع قائمة اليوم حاليًا.</div>}
              </div>
            </div>

            {!!branchDistribution.length && (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-xs font-bold text-cyan-100">
                <div className="mb-2 text-base font-black text-white">توزيع الفروع</div>
                <div className="flex flex-wrap gap-2">
                  {branchDistribution.map(([branchName, count]) => <span key={branchName} className="rounded-full border border-cyan-300/25 px-3 py-1">{branchName}: {count}</span>)}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MetricCard({ icon, label, value, href, danger }: { icon: ReactNode; label: string; value: string | number; href: string; danger?: boolean }) {
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

function MiniStat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${danger ? 'border-amber-400/30 bg-amber-500/10' : 'border-slate-700 bg-slate-900/70'}`}>
      <div className="text-[11px] font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function SmartLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return <a className={primary ? 'btn-primary px-3 py-2 text-xs text-center' : 'btn-secondary px-3 py-2 text-xs text-center'} href={href}>{label}</a>;
}

function SmartWarning({ text, href, tone = 'amber' }: WarningItem) {
  const toneClass = tone === 'red'
    ? 'border-red-400/30 bg-red-500/10 text-red-100'
    : tone === 'cyan'
      ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
      : tone === 'emerald'
        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
        : 'border-amber-400/30 bg-amber-500/10 text-amber-100';
  const content = <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>{text}</div>;
  return href ? <a href={href} className="block hover:brightness-110">{content}</a> : content;
}
