import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ALL_FILTER } from '@/lib/api/customers';
import {
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  fetchCustomerServiceInsightPools,
  generateTodayFollowupsSmartReport,
  recommendedAction,
  riskLevel,
  updateFollowupResult,
  type CustomerServiceInsightPools,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { BRANCHES } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';
import { rowMatchesCurrentUserScope } from '@/lib/security/userDataScope';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const SMART_LIMIT = 260;
const PAGE_SIZE = 24;
const EMPTY_INSIGHTS: CustomerServiceInsightPools = {
  important: [],
  reduced: [],
  stopped60: [],
  strong: [],
  source: 'not_loaded',
  warnings: [],
};

type SmartQueueType = 'all' | 'now' | 'overdue' | 'manager' | 'scheduled' | 'suggested' | 'history' | 'data';
type SmartRow = FollowupRow & { smart_source?: string; virtual?: boolean; smart_score?: number; smart_action?: string };

function text(value: unknown, fallback = 'غير محدد') {
  return String(value ?? '').trim() || fallback;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return `${Number.isFinite(n) ? n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '0'} ج`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('ar-EG');
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

function invoicesCount(row: FollowupRow) {
  return Number(row.customer_metrics?.invoices_count || 0);
}

function avgMonthly(row: FollowupRow) {
  return Number(row.customer_metrics?.avg_monthly || 0);
}

function lastPurchase(row: FollowupRow) {
  return row.customer_metrics?.last_purchase || row.last_purchase_date || null;
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

function isCompleted(row: FollowupRow) {
  const status = statusOf(row);
  return Boolean(row.completed_at || ['تم', 'تم التواصل', 'تم الشراء بعد المتابعة', 'completed', 'done'].includes(status));
}

function dueAt(row: FollowupRow) {
  return row.followup_datetime || row.followup_date || row.next_followup_date || row.date || row.created_at || null;
}

function isOverdue(row: FollowupRow) {
  if (isCompleted(row) || row.postponed_until) return false;
  const due = dueAt(row);
  return Boolean(due && new Date(due).getTime() < Date.now());
}

function minutesLate(row: FollowupRow) {
  const due = dueAt(row);
  if (!due) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(due).getTime()) / 60000));
}

function hasValidPhone(row: FollowupRow) {
  const phone = phoneOf(row);
  return Boolean(phone && isValidEgyptPhone(phone, row.customer_code));
}

function canonicalKey(row: FollowupRow) {
  const digits = phoneOf(row).replace(/\D/g, '');
  return String(row.customer_id || row.customer_code || digits || customerName(row))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function rowMatchesSearch(row: FollowupRow, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const haystack = [customerName(row), row.customer_code, phoneOf(row), row.branch, responsibleOf(row), row.followup_reason, row.request_details]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q) || (digits.length >= 3 && phoneOf(row).replace(/\D/g, '').includes(digits));
}

function sourceLabel(row: SmartRow) {
  if (row.smart_source === 'suggested_important') return 'مقترح: عميل مهم/VIP';
  if (row.smart_source === 'suggested_reduced') return 'مقترح: قلل التعامل';
  if (row.smart_source === 'suggested_stopped') return 'مقترح: متوقف';
  if (row.request_type || row.request_details) return 'متابعة سريعة/طلب دكتور';
  if (row.next_followup_date) return 'متابعة مجدولة';
  if (isOverdue(row)) return 'متأخر';
  return 'قائمة اليوم';
}

function nextAction(row: SmartRow) {
  if (row.virtual) return 'إنشاء متابعة الآن ثم التواصل';
  if (!hasValidPhone(row)) return 'تصحيح رقم العميل قبل التواصل';
  if (row.needs_manager) return 'تدخل مدير الفرع الآن';
  if (isOverdue(row)) return 'تواصل عاجل وتسجيل نتيجة';
  if (row.postponed_until) return `مؤجل حتى ${formatDateTime(row.postponed_until)}`;
  if (row.next_followup_date) return `متابعة مجدولة ${formatDateTime(row.next_followup_date)}`;
  return 'تواصل وسجل النتيجة والخطوة القادمة';
}

function smartScore(row: SmartRow) {
  let score = 0;
  if (isOverdue(row)) score += 250 + Math.min(120, minutesLate(row));
  if (row.needs_manager) score += 180;
  if (!hasValidPhone(row)) score += 120;
  if (row.virtual) score += 70;
  if (/عاجل|urgent|high/i.test(String(row.priority || ''))) score += 80;
  if (/مهم جدًا|vip/i.test(segmentOf(row))) score += 70;
  if (/متوقف/i.test(String(row.customer_status || row.customer_metrics?.customer_status || ''))) score += 65;
  if (/مهدد/i.test(String(row.customer_status || row.customer_metrics?.customer_status || ''))) score += 55;
  score += Math.min(80, Math.round(totalSpent(row) / 2500));
  score += Math.min(50, Math.round(avgMonthly(row) / 700));
  return score;
}

function dedupeSmartRows(rows: SmartRow[]) {
  const map = new Map<string, SmartRow>();
  for (const row of rows) {
    const key = canonicalKey(row);
    if (!key) continue;
    const current = map.get(key);
    const enriched = { ...row, smart_score: smartScore(row), smart_action: nextAction(row) };
    if (!current || smartScore(enriched) > smartScore(current) || (!row.virtual && current.virtual)) map.set(key, enriched);
  }
  return [...map.values()].sort((a, b) => smartScore(b) - smartScore(a) || totalSpent(b) - totalSpent(a));
}

function createVirtualRows(insights: CustomerServiceInsightPools): SmartRow[] {
  return [
    ...insights.important.map((row) => ({ ...row, id: `suggested-important-${canonicalKey(row)}`, virtual: true, smart_source: 'suggested_important' })),
    ...insights.reduced.map((row) => ({ ...row, id: `suggested-reduced-${canonicalKey(row)}`, virtual: true, smart_source: 'suggested_reduced' })),
    ...insights.stopped60.map((row) => ({ ...row, id: `suggested-stopped-${canonicalKey(row)}`, virtual: true, smart_source: 'suggested_stopped' })),
  ];
}

function scriptFor(row: SmartRow) {
  const reason = row.request_details || row.followup_reason || recommendedAction(row);
  return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nبنطمن على حضرتك بخصوص ${reason}.\nلو فيه أي احتياج أو ملاحظة، نتشرف بخدمة حضرتك دائمًا.`;
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
        const created = rows.reduce((sum, row: any) => sum + Number(row.created_count || 0), 0);
        const skipped = rows.reduce((sum, row: any) => sum + Number(row.skipped_duplicates || 0), 0);
        const candidates = rows.reduce((sum, row: any) => sum + Number(row.candidate_count || 0), 0);
        return { created, skipped, candidates, source: 'rpc' };
      }
    } catch {
      // Fallback to frontend generator.
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

export default function SmartCustomerService() {
  const { user } = useAuth();
  const userRole = user?.role || '';
  const canAllBranches = canSeeAllBranches(userRole);
  const initialBranch = canAllBranches ? ALL_FILTER : normalizeBranchName(user?.branch || '') || ALL_FILTER;
  const [branch, setBranch] = useState(initialBranch);
  const [search, setSearch] = useState('');
  const [queueType, setQueueType] = useState<SmartQueueType>('now');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [insights, setInsights] = useState<CustomerServiceInsightPools>(EMPTY_INSIGHTS);
  const [selected, setSelected] = useState<SmartRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);

  const scopedBranch = useMemo(() => {
    const scopedUser = { role: userRole, branch: user?.branch || '' };
    return canAllBranches ? effectiveBranchFilter(scopedUser, branch, ALL_FILTER) : normalizeBranchName(user?.branch || '') || ALL_FILTER;
  }, [branch, canAllBranches, user?.branch, userRole]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [followups, pools] = await Promise.all([
        fetchCustomerServiceFollowups({ branch: scopedBranch, status: ALL_FILTER, search, limit: SMART_LIMIT }),
        fetchCustomerServiceInsightPools(scopedBranch),
      ]);
      const scoped = followups.filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>));
      setRows(scoped);
      setInsights(pools);
      setSelected((current) => {
        if (current && scoped.some((row) => canonicalKey(row) === canonicalKey(current))) return current;
        const merged = dedupeSmartRows([...scoped, ...createVirtualRows(pools)]);
        return merged[0] || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل متابعات خدمة العملاء');
    } finally {
      setLoading(false);
    }
  }, [scopedBranch, search, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [branch, search, queueType]);

  const virtualRows = useMemo(() => createVirtualRows(insights), [insights]);
  const smartRows = useMemo(() => dedupeSmartRows([...rows, ...virtualRows]), [rows, virtualRows]);
  const openRows = useMemo(() => smartRows.filter((row) => !isCompleted(row)), [smartRows]);
  const historyRows = useMemo(() => dedupeSmartRows(rows.filter(isCompleted)), [rows]);

  const filteredRows = useMemo(() => {
    const source = queueType === 'history' ? historyRows : openRows;
    return source
      .filter((row) => rowMatchesSearch(row, search))
      .filter((row) => {
        if (queueType === 'all' || queueType === 'now') return true;
        if (queueType === 'overdue') return isOverdue(row);
        if (queueType === 'manager') return Boolean(row.needs_manager);
        if (queueType === 'scheduled') return Boolean(row.next_followup_date || row.postponed_until);
        if (queueType === 'suggested') return Boolean(row.virtual);
        if (queueType === 'data') return !hasValidPhone(row) || !row.customer_code;
        return true;
      });
  }, [historyRows, openRows, queueType, search]);

  const visibleRows = filteredRows.slice(0, visibleCount);
  const selectedHistory = useMemo(() => {
    if (!selected) return [];
    const key = canonicalKey(selected);
    return rows
      .filter((row) => canonicalKey(row) === key)
      .sort((a, b) => new Date(b.updated_at || b.created_at || b.followup_date || 0).getTime() - new Date(a.updated_at || a.created_at || a.followup_date || 0).getTime());
  }, [rows, selected]);

  const counts = useMemo(() => {
    const base = openRows;
    return {
      total: base.length,
      overdue: base.filter(isOverdue).length,
      manager: base.filter((row) => row.needs_manager).length,
      scheduled: base.filter((row) => row.next_followup_date || row.postponed_until).length,
      suggested: base.filter((row) => row.virtual).length,
      data: base.filter((row) => !hasValidPhone(row) || !row.customer_code).length,
      history: historyRows.length,
      completed: rows.filter(isCompleted).length,
      recovered: rows.filter((row) => row.purchase_after_followup).length,
      amount: rows.reduce((sum, row) => sum + Number(row.purchase_amount || 0), 0),
    };
  }, [historyRows.length, openRows, rows]);

  const updateRow = (updated: FollowupRow) => {
    setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setSelected({ ...updated, smart_score: smartScore(updated), smart_action: nextAction(updated) });
  };

  const markResult = async (row: SmartRow, status: string) => {
    if (row.virtual) return createFromSuggestion(row);
    setSavingId(row.id);
    try {
      const completed = status === 'تم';
      const updated = await updateFollowupResult(row.id, {
        status,
        followup_status: status,
        contact_status: status,
        contact_result: status,
        completed_at: completed ? new Date().toISOString() : null,
        updated_by: user?.id || user?.name || null,
      });
      updateRow(updated);
      toast.success('تم تحديث المتابعة');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث المتابعة');
    } finally {
      setSavingId(null);
    }
  };

  const postpone = async (row: SmartRow) => {
    if (row.virtual) return createFromSuggestion(row);
    const next = new Date();
    next.setDate(next.getDate() + 1);
    setSavingId(row.id);
    try {
      const updated = await updateFollowupResult(row.id, {
        status: 'مؤجل',
        followup_status: 'مؤجل',
        postponed_until: next.toISOString(),
        next_followup_date: next.toISOString(),
        updated_by: user?.id || user?.name || null,
      });
      updateRow(updated);
      toast.success('تم تأجيل المتابعة للغد');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تأجيل المتابعة');
    } finally {
      setSavingId(null);
    }
  };

  const escalate = async (row: SmartRow) => {
    if (row.virtual) return createFromSuggestion(row);
    setSavingId(row.id);
    try {
      const updated = await updateFollowupResult(row.id, {
        status: 'يحتاج مدير',
        followup_status: 'يحتاج مدير',
        needs_manager: true,
        updated_by: user?.id || user?.name || null,
      });
      updateRow(updated);
      toast.success('تم تصعيد المتابعة للمدير');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر التصعيد');
    } finally {
      setSavingId(null);
    }
  };

  const createFromSuggestion = async (row: SmartRow) => {
    setSavingId(row.id);
    try {
      const created = await createExceptionalFollowup({
        customer: row.customer_metrics as any,
        customerName: customerName(row),
        customerPhone: phoneOf(row),
        customerCode: row.customer_code,
        branch: row.branch || scopedBranch,
        priority: isOverdue(row) || /متوقف|مهدد/i.test(String(row.customer_status || '')) ? 'عاجل' : 'مهم',
        requestType: 'متابعة ذكية من خدمة العملاء',
        followupReason: row.followup_reason || recommendedAction(row),
        requestDetails: sourceLabel(row),
        followupDatetime: new Date().toISOString(),
        assignedDoctor: user?.name || null,
        createdBy: user?.id || null,
        createdByName: user?.name || null,
        source: 'smart_customer_service_workspace',
      });
      setRows((current) => [created, ...current]);
      setSelected(created);
      toast.success('تم إنشاء المتابعة من المقترح الذكي');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إنشاء المتابعة');
    } finally {
      setSavingId(null);
    }
  };

  const generateToday = async () => {
    setSavingId('generate');
    try {
      const result = await generateCoreDailyQueue(scopedBranch, user?.name || 'خدمة العملاء');
      toast.success(`تم إنشاء ${result.created} متابعة أساسية · مرشحون ${result.candidates} · تكرار/مفتوح ${result.skipped}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إنشاء قائمة اليوم');
    } finally {
      setSavingId(null);
    }
  };

  const copyScript = async (row: SmartRow) => {
    await navigator.clipboard.writeText(scriptFor(row));
    toast.success('تم نسخ سكريبت التواصل');
  };

  return (
    <div className="customer-service-page smart-customer-service w-full space-y-5" dir="rtl">
      <section className="dawaa-hero rounded-3xl border p-5 shadow-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <span className="dawaa-brand-chip inline-flex rounded-full border px-3 py-1 text-xs font-black">Smart Customer Service Workspace</span>
            <h1 className="mt-3 text-3xl font-black">أداة متابعة العملاء الذكية</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold text-slate-300">
              تعرض العملاء المطلوب متابعتهم فعليًا، تقترح الأولوية والخطوة القادمة، وتجمع سجل المتابعات في نفس الشاشة حتى لا تكون المتابعة إجراء روتيني.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
            <button type="button" className="btn-primary flex items-center gap-2" onClick={generateToday} disabled={savingId === 'generate'}>
              {savingId === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus size={16} />} إنشاء قائمة اليوم 30/فرع
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SmartStat label="المفتوح الآن" value={counts.total} active={queueType === 'now'} onClick={() => setQueueType('now')} />
        <SmartStat label="متأخر ويحتاج تدخل" value={counts.overdue} active={queueType === 'overdue'} danger onClick={() => setQueueType('overdue')} />
        <SmartStat label="يحتاج مدير" value={counts.manager} active={queueType === 'manager'} danger onClick={() => setQueueType('manager')} />
        <SmartStat label="مقترحات ذكية" value={counts.suggested} active={queueType === 'suggested'} onClick={() => setQueueType('suggested')} />
        <SmartStat label="سجل المتابعات" value={counts.history} active={queueType === 'history'} onClick={() => setQueueType('history')} />
      </section>

      <section className="dawaa-panel rounded-3xl border p-4">
        <div className="grid gap-3 lg:grid-cols-[220px_1fr_220px_220px]">
          <label className="space-y-1">
            <span className="text-xs font-black text-slate-400">الفرع</span>
            <select className="input-dark" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!canAllBranches}>
              {canAllBranches && <option value={ALL_FILTER}>كل الفروع</option>}
              {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-black text-slate-400">بحث ذكي</span>
            <div className="relative">
              <Search className="absolute right-4 top-3.5 h-5 w-5 text-slate-500" />
              <input className="input-dark pr-12" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم / كود / رقم / مسؤول / سبب المتابعة" />
            </div>
          </label>
          <button type="button" className={queueType === 'data' ? 'btn-primary mt-6' : 'btn-secondary mt-6'} onClick={() => setQueueType('data')}>
            مشاكل البيانات: {counts.data}
          </button>
          <button type="button" className={queueType === 'scheduled' ? 'btn-primary mt-6' : 'btn-secondary mt-6'} onClick={() => setQueueType('scheduled')}>
            المجدول/المؤجل: {counts.scheduled}
          </button>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm font-bold text-red-100"><AlertTriangle className="ml-2 inline h-5 w-5" />{error}</div>}
      {insights.warnings.length > 0 && <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm font-bold text-amber-100">{insights.warnings.join(' · ')}</div>}

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="dawaa-panel min-w-0 rounded-3xl border p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-black text-white">قائمة العمل الذكية</h2>
              <p className="text-xs font-bold text-slate-400">يعرض {visibleRows.length} من {filteredRows.length} عميل · مرتب حسب التأخير والخطورة وقيمة العميل.</p>
            </div>
            {loading && <span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-200"><Loader2 className="h-4 w-4 animate-spin" />تحميل...</span>}
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {visibleRows.map((row) => (
              <SmartFollowupCard
                key={`${row.id}-${canonicalKey(row)}`}
                row={row}
                selected={canonicalKey(selected || ({} as FollowupRow)) === canonicalKey(row)}
                saving={savingId === row.id}
                onSelect={() => setSelected(row)}
                onCreate={() => void createFromSuggestion(row)}
                onDone={() => void markResult(row, 'تم')}
                onNoAnswer={() => void markResult(row, 'لم يرد')}
                onPostpone={() => void postpone(row)}
                onManager={() => void escalate(row)}
                onCopy={() => void copyScript(row)}
              />
            ))}
          </div>

          {!visibleRows.length && <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-8 text-center text-sm font-bold text-slate-400">لا توجد نتائج مطابقة. جرّب تغيير الفلتر أو إنشاء قائمة اليوم.</div>}
          {visibleCount < filteredRows.length && (
            <div className="mt-5 text-center">
              <button className="btn-secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>عرض المزيد</button>
            </div>
          )}
        </main>

        <aside className="dawaa-panel rounded-3xl border p-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-auto">
          <h2 className="text-xl font-black text-white">ملف العميل والمتابعة</h2>
          {!selected ? (
            <p className="mt-4 text-sm font-bold text-slate-400">اختار عميل من القائمة لعرض القرار، السكريبت، وسجل المتابعات.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-2xl font-black text-white">{customerName(selected)}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">{selected.customer_code || phoneOf(selected) || 'بدون كود'}</p>
                  </div>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-black text-cyan-100">{sourceLabel(selected)}</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300">
                  <InfoRow label="الهاتف" value={phoneOf(selected) || 'بدون رقم صحيح'} />
                  <InfoRow label="الفرع" value={text(selected.branch)} />
                  <InfoRow label="التصنيف" value={segmentOf(selected)} />
                  <InfoRow label="درجة الخطورة" value={riskLevel(selected)} />
                  <InfoRow label="آخر شراء" value={formatDate(lastPurchase(selected))} />
                  <InfoRow label="إجمالي مشتريات" value={money(totalSpent(selected))} />
                  <InfoRow label="متوسط شهري" value={money(avgMonthly(selected))} />
                  <InfoRow label="عدد الفواتير" value={invoicesCount(selected)} />
                  <InfoRow label="المسؤول" value={responsibleOf(selected)} />
                </div>
              </div>

              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                <h4 className="mb-2 font-black text-amber-100">قرار ذكي مقترح</h4>
                <p className="text-sm font-bold leading-7 text-amber-50">{nextAction(selected)}</p>
                <p className="mt-2 text-xs font-bold text-amber-100/80">سبب الظهور: {selected.followup_reason || selected.request_details || sourceLabel(selected)}</p>
              </div>

              <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4">
                <h4 className="mb-2 font-black text-cyan-100">سكريبت تواصل سريع</h4>
                <p className="whitespace-pre-line text-sm font-bold leading-7 text-cyan-50">{scriptFor(selected)}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {selected.virtual ? (
                  <button className="btn-primary" disabled={savingId === selected.id} onClick={() => void createFromSuggestion(selected)}><Plus className="ml-1 inline h-4 w-4" /> إنشاء متابعة</button>
                ) : (
                  <button className="btn-primary" disabled={savingId === selected.id} onClick={() => void markResult(selected, 'تم')}><CheckCircle2 className="ml-1 inline h-4 w-4" /> تم التواصل</button>
                )}
                <button className="btn-secondary" disabled={savingId === selected.id} onClick={() => void markResult(selected, 'لم يرد')}>لم يرد</button>
                <button className="btn-secondary" disabled={savingId === selected.id} onClick={() => void postpone(selected)}><CalendarClock className="ml-1 inline h-4 w-4" /> تأجيل</button>
                <button className="btn-secondary" disabled={savingId === selected.id} onClick={() => void escalate(selected)}><ShieldAlert className="ml-1 inline h-4 w-4" /> يحتاج مدير</button>
                <button className="btn-secondary" onClick={() => void copyScript(selected)}>نسخ السكريبت</button>
                <a className={`btn-secondary text-center ${hasValidPhone(selected) ? '' : 'pointer-events-none opacity-40'}`} href={hasValidPhone(selected) ? generateWhatsAppLink(phoneOf(selected), scriptFor(selected)) : undefined} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-4 w-4" /> واتساب</a>
                <a className={`btn-secondary text-center ${hasValidPhone(selected) ? '' : 'pointer-events-none opacity-40'}`} href={hasValidPhone(selected) ? `tel:${phoneOf(selected)}` : undefined}><PhoneCall className="ml-1 inline h-4 w-4" /> اتصال</a>
                <a className="btn-primary text-center" href={`/customer-360?code=${encodeURIComponent(String(selected.customer_code || ''))}&phone=${encodeURIComponent(phoneOf(selected))}&name=${encodeURIComponent(customerName(selected))}`}><Eye className="ml-1 inline h-4 w-4" /> ملف 360</a>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <h4 className="mb-3 font-black text-white">سجل المتابعات لهذا العميل</h4>
                <div className="space-y-2">
                  {selectedHistory.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-xs text-slate-300">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-white">{statusOf(item)}</span>
                        <span>{formatDateTime(item.updated_at || item.completed_at || item.created_at || item.followup_date)}</span>
                      </div>
                      <p className="mt-2 leading-6">{item.followup_result || item.contact_result || item.followup_notes || item.notes || item.followup_reason || 'لا توجد ملاحظات مسجلة.'}</p>
                    </div>
                  ))}
                  {!selectedHistory.length && <p className="text-sm font-bold text-slate-400">لا يوجد سجل سابق محمّل لهذا العميل.</p>}
                </div>
              </div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function SmartStat({ label, value, active, danger, onClick }: { label: string; value: number | string; active?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border p-4 text-right shadow-xl transition ${active ? 'border-cyan-400 bg-cyan-500/15' : danger ? 'border-red-400/30 bg-red-500/10 hover:border-red-300' : 'border-slate-700 bg-slate-900/70 hover:border-cyan-400/40'}`}
    >
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-black text-white">{value}</div>
    </button>
  );
}

function SmartFollowupCard({
  row,
  selected,
  saving,
  onSelect,
  onCreate,
  onDone,
  onNoAnswer,
  onPostpone,
  onManager,
  onCopy,
}: {
  row: SmartRow;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onDone: () => void;
  onNoAnswer: () => void;
  onPostpone: () => void;
  onManager: () => void;
  onCopy: () => void;
}) {
  return (
    <article className={`rounded-3xl border p-4 shadow-lg ${selected ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-700 bg-slate-950/45'}`}>
      <button type="button" onClick={onSelect} className="w-full text-right">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black text-white">{customerName(row)}</h3>
            <p className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {normalizeBranchName(row.branch || '') || 'فرع غير محدد'}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-black ${isOverdue(row) ? 'border-red-400/40 bg-red-500/10 text-red-100' : row.virtual ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'}`}>
            {sourceLabel(row)}
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-xs font-bold text-slate-300 sm:grid-cols-2">
          <span><Clock className="ml-1 inline h-4 w-4" /> {isOverdue(row) ? `متأخر ${minutesLate(row)} دقيقة` : formatDateTime(dueAt(row))}</span>
          <span>المسؤول: {responsibleOf(row)}</span>
          <span>آخر شراء: {formatDate(lastPurchase(row))}</span>
          <span>إجمالي: {money(totalSpent(row))}</span>
          <span>تصنيف: {segmentOf(row)}</span>
          <span>أولوية: {smartScore(row)}</span>
        </div>
        <p className="mt-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-sm font-bold leading-7 text-slate-200">{nextAction(row)}</p>
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        {row.virtual ? (
          <button type="button" className="btn-primary px-3 py-2 text-xs" disabled={saving} onClick={onCreate}>{saving ? <Loader2 className="ml-1 inline h-4 w-4 animate-spin" /> : <Sparkles className="ml-1 inline h-4 w-4" />} إنشاء متابعة</button>
        ) : (
          <button type="button" className="btn-primary px-3 py-2 text-xs" disabled={saving} onClick={onDone}>تم التواصل</button>
        )}
        <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={saving || row.virtual} onClick={onNoAnswer}>لم يرد</button>
        <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={saving || row.virtual} onClick={onPostpone}>تأجيل</button>
        <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={saving || row.virtual} onClick={onManager}>مدير</button>
        <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={onCopy}>سكريبت</button>
      </div>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-100">{String(value ?? '—')}</span>
    </div>
  );
}
