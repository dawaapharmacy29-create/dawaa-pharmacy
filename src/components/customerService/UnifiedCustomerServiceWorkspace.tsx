import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  HeartHandshake,
  History,
  RefreshCw,
  Search,
  Sparkles,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getCustomers, type CustomerMetric } from '@/lib/api/customers';
import {
  calculateFollowupStats,
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  updateFollowupResult,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { formatCurrency } from '@/lib/utils';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import FollowupResultModal, { type FollowupResultData } from '@/components/customerService/FollowupResultModal';
import type { DailyFollowup } from '@/types/database';

type QueueSource = 'doctor_request' | 'yesterday' | 'at_risk' | 'important';
type WorkspaceTab = 'today' | 'doctor-requests' | 'care' | 'history' | 'performance';

type QueueItem = {
  key: string;
  source: QueueSource;
  row: FollowupRow | null;
  customer: CustomerMetric | null;
  name: string;
  code: string;
  phone: string;
  branch: string;
  segment: string;
  status: string;
  priority: string;
  reason: string;
  avgMonthly: number;
  totalSpent: number;
  avgInvoice: number;
  lastPurchase: string;
  completed: boolean;
};

const BRANCHES = ['فرع الشامي', 'فرع شكري'];
const BRANCH_OWNER: Record<string, string> = {
  'فرع الشامي': 'د/ ضحى',
  'فرع شكري': 'د/ دنيا',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeKey(...values: Array<string | null | undefined>) {
  return values.map((value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')).find(Boolean) || crypto.randomUUID();
}

function rowValue(row: FollowupRow | null | undefined, ...keys: string[]) {
  const source = (row || {}) as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return '';
}

function rowNumber(row: FollowupRow | null | undefined, ...keys: string[]) {
  const value = Number(rowValue(row, ...keys));
  return Number.isFinite(value) ? value : 0;
}

function isCompleted(row?: FollowupRow | null) {
  const status = String(row?.followup_status || row?.status || '');
  return Boolean(row?.completed_at) || ['تم', 'تم التواصل', 'تم الشراء بعد المتابعة', 'تم الرد والعميل راضي', 'تم الرد ولا يحتاج الآن'].includes(status);
}

function sourceFromRow(row: FollowupRow): QueueSource {
  const text = `${row.request_type || ''} ${row.notes || ''} ${row.followup_reason || ''} ${rowValue(row, 'source')}`;
  if (/doctor_requested_followup|طلب دكتور|سريع\/طلب دكتور/i.test(text)) return 'doctor_request';
  if (/أمس|yesterday/i.test(text)) return 'yesterday';
  if (/مهدد|قلل|استرجاع|متوقف/i.test(text)) return 'at_risk';
  return 'important';
}

function followupToItem(row: FollowupRow, source = sourceFromRow(row)): QueueItem {
  const metric = row.customer_metrics || null;
  return {
    key: normalizeKey(row.customer_code, row.customer_phone, row.phone, row.customer_id, row.customer_name),
    source,
    row,
    customer: metric,
    name: row.customer_name || row.name || metric?.customer_name || 'عميل غير مسجل',
    code: row.customer_code || metric?.customer_code || '',
    phone: row.customer_phone || row.phone || metric?.customer_phone || metric?.phone || '',
    branch: normalizeBranchName(row.branch || metric?.branch || ''),
    segment: row.segment || row.classification || metric?.segment || 'غير مصنف',
    status: row.customer_status || metric?.customer_status || 'غير محدد',
    priority: row.priority || 'مهم',
    reason: row.request_details || row.followup_reason || row.request_type || 'متابعة العميل',
    avgMonthly: Number(metric?.avg_monthly || 0),
    totalSpent: Number(row.total_spent || metric?.total_spent || 0),
    avgInvoice: Number(metric?.avg_invoice || 0),
    lastPurchase: row.last_purchase_date || metric?.last_purchase || '',
    completed: isCompleted(row),
  };
}

function customerToItem(customer: CustomerMetric, source: QueueSource, reason: string): QueueItem {
  return {
    key: normalizeKey(customer.customer_code, customer.customer_phone, customer.phone, customer.customer_id, customer.customer_name),
    source,
    row: null,
    customer,
    name: customer.customer_name || customer.name || 'عميل غير مسجل',
    code: customer.customer_code || '',
    phone: customer.customer_phone || customer.phone || '',
    branch: normalizeBranchName(customer.branch || ''),
    segment: customer.segment || customer.type || 'غير مصنف',
    status: customer.customer_status || customer.status || 'غير محدد',
    priority: source === 'at_risk' ? 'مهم' : 'عادي',
    reason,
    avgMonthly: Number(customer.avg_monthly || 0),
    totalSpent: Number(customer.total_spent || customer.total_purchases || 0),
    avgInvoice: Number(customer.avg_invoice || 0),
    lastPurchase: customer.last_purchase || '',
    completed: false,
  };
}

function sourceLabel(source: QueueSource) {
  if (source === 'doctor_request') return 'طلب دكتور';
  if (source === 'yesterday') return 'اشترى أمس';
  if (source === 'at_risk') return 'مهدد بالتوقف';
  return 'عميل مهم';
}

function scriptFor(item: QueueItem) {
  const firstName = item.name.split(' ')[0] || item.name;
  const owner = BRANCH_OWNER[item.branch] || 'فريق خدمة العملاء';
  if (item.source === 'doctor_request') {
    return `أهلًا بحضرتك أ/ ${firstName}، مع حضرتك ${owner} من خدمة عملاء صيدليات دواء. الدكتور بلغنا إن حضرتك محتاج متابعة بخصوص ${item.reason}. حبيت أتواصل مع حضرتك بنفسي وأطمن إن الموضوع بيتابع لحد ما نوصل لحل يرضي حضرتك، وتشرفني أي ملاحظة أو تفاصيل تحب تضيفها.`;
  }
  if (item.source === 'yesterday') {
    return `أهلًا بحضرتك أ/ ${firstName}، مع حضرتك ${owner} من صيدليات دواء. حبيت أطمن على حضرتك بعد طلب امبارح: هل الطلب وصل كامل وفي الوقت المناسب، وهل كل الأصناف كانت تمام مع حضرتك؟ حضرتك من عملائنا المهمين، وأي ملاحظة—even لو بسيطة—تهمنا جدًا علشان نخدم حضرتك بشكل أفضل.`;
  }
  if (item.source === 'at_risk') {
    return `أهلًا بحضرتك أ/ ${firstName}، مع حضرتك ${owner} من صيدليات دواء. وحشتنا تعاملات حضرتك، وحبيت أطمن إن كل شيء تمام وإن مفيش موقف أو احتياج إحنا مقصرين فيه. رأي حضرتك مهم جدًا لينا، ويسعدني أتابع أي ملاحظة بنفسي لحد ما تتحل.`;
  }
  return `أهلًا بحضرتك أ/ ${firstName}، مع حضرتك ${owner} من صيدليات دواء. حضرتك من عملائنا المميزين وحبيت أطمن على حضرتك وعلى احتياجاتك الشهرية، وأتأكد إن الخدمة والتوصيل كانوا على المستوى اللي يرضي حضرتك. تشرفنا دائمًا خدمتك وأي طلب أو ملاحظة تحت أمرك.`;
}

export default function UnifiedCustomerServiceWorkspace() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const lockedBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? 'فرع الشامي' : lockedBranch || 'فرع الشامي');
  const [tab, setTab] = useState<WorkspaceTab>('today');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [allFollowups, setAllFollowups] = useState<FollowupRow[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | QueueSource>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [quickOpen, setQuickOpen] = useState(false);
  const [resultRow, setResultRow] = useState<FollowupRow | null>(null);

  async function loadWorkspace() {
    setLoading(true);
    try {
      const [followups, importantResult, atRiskResult, recentResult] = await Promise.all([
        fetchCustomerServiceFollowups({ branch, limit: 1000 }),
        getCustomers({ branch, type: 'مهم جدًا', limit: 100, offset: 0 }),
        getCustomers({ branch, status: 'مهدد بالتوقف', limit: 100, offset: 0 }),
        getCustomers({ branch, limit: 100, offset: 0 }),
      ]);
      setAllFollowups(followups);

      const doctorRequests = followups.filter((row) => !isCompleted(row) && sourceFromRow(row) === 'doctor_request').map((row) => followupToItem(row, 'doctor_request'));
      const yesterday = recentResult.customers
        .filter((customer) => String(customer.last_purchase || '').slice(0, 10) === yesterdayIso())
        .filter((customer) => Number(customer.avg_invoice || 0) >= 500 || Number(customer.total_spent || 0) >= 1000)
        .sort((a, b) => Number(b.avg_invoice || 0) - Number(a.avg_invoice || 0))
        .map((customer) => customerToItem(customer, 'yesterday', `متابعة شراء أمس بمتوسط فاتورة ${formatCurrency(Number(customer.avg_invoice || 0))}`));
      const atRisk = atRiskResult.customers.sort((a, b) => Number(b.avg_monthly || 0) - Number(a.avg_monthly || 0)).map((customer) => customerToItem(customer, 'at_risk', 'قلل التعامل أو مهدد بالتوقف ويحتاج متابعة استرجاع'));
      const important = importantResult.customers.sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0)).map((customer) => customerToItem(customer, 'important', 'عميل مهم يحتاج متابعة دورية ودلع'));

      const map = new Map<string, QueueItem>();
      const add = (items: QueueItem[], limit: number) => {
        let added = 0;
        for (const item of items) {
          if (map.has(item.key)) continue;
          map.set(item.key, item);
          added += 1;
          if (added >= limit || map.size >= 30) break;
        }
      };
      add(doctorRequests, 10);
      add(yesterday, 10);
      add(atRisk, 10);
      add(important, 30);
      const finalQueue = [...map.values()].slice(0, 30);
      setQueue(finalQueue);
      setSelectedKey((current) => current && finalQueue.some((item) => item.key === current) ? current : finalQueue[0]?.key || '');
    } catch (error) {
      console.error(error);
      toast.error('تعذر تحميل قائمة خدمة العملاء اليومية');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadWorkspace(); }, [branch]);

  const owner = BRANCH_OWNER[branch] || 'مسئول خدمة العملاء';
  const todayRows = useMemo(() => allFollowups.filter((row) => String(row.date || row.followup_date || '').slice(0, 10) === todayIso()), [allFollowups]);
  const stats = useMemo(() => calculateFollowupStats(todayRows), [todayRows]);
  const completedHistory = useMemo(() => allFollowups.filter(isCompleted).sort((a, b) => new Date(rowValue(b, 'completed_at', 'updated_at', 'followup_date', 'date') || 0).getTime() - new Date(rowValue(a, 'completed_at', 'updated_at', 'followup_date', 'date') || 0).getTime()), [allFollowups]);
  const selected = queue.find((item) => item.key === selectedKey) || null;
  const filteredQueue = useMemo(() => queue.filter((item) => {
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
    if (statusFilter === 'completed' && !item.completed) return false;
    if (statusFilter === 'open' && item.completed) return false;
    const haystack = `${item.name} ${item.code} ${item.phone} ${item.reason}`.toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [queue, search, sourceFilter, statusFilter]);

  async function ensureFollowup(item: QueueItem) {
    if (item.row) return item.row;
    const created = await createExceptionalFollowup({
      customer: item.customer,
      customerName: item.name,
      customerPhone: item.phone || null,
      customerCode: item.code || null,
      branch: item.branch,
      priority: item.priority,
      requestType: sourceLabel(item.source),
      followupReason: item.reason,
      requestDetails: item.reason,
      createdBy: user?.id || null,
      createdByName: user?.name || null,
      source: 'unified_customer_service_workspace',
    });
    setQueue((current) => current.map((row) => row.key === item.key ? { ...row, row: created } : row));
    return created;
  }

  async function openResult(item: QueueItem) {
    try { setResultRow(await ensureFollowup(item)); }
    catch (error) { toast.error(`تعذر تجهيز المتابعة: ${(error as Error).message}`); }
  }

  async function saveResult(data: FollowupResultData) {
    if (!resultRow) return;
    const completed = !['لم يرد', 'طلب التواصل لاحقًا'].includes(data.result);
    await updateFollowupResult(resultRow.id, {
      contact_result: data.result,
      followup_result: data.result,
      followup_summary: data.notes,
      followup_notes: data.notes,
      quality_rating: data.qualityRating,
      internal_rating: data.internalRating,
      needs_next_followup: data.needsNextFollowup,
      next_followup_date: data.nextFollowupDate || null,
      purchase_after_followup: data.result === 'تم الشراء بعد المتابعة' || data.purchaseAmount > 0,
      purchase_amount: data.purchaseAmount,
      purchase_invoice_no: data.invoiceNumber || null,
      customer_satisfaction: data.customerSatisfaction,
      need_understood: data.needUnderstood,
      cross_sell_offered: data.crossSellOffered,
      up_sell_offered: data.upSellOffered,
      no_purchase_reason: data.noPurchaseReason || null,
      doctor_internal_note: data.doctorInternalNote || null,
      needs_manager: data.result === 'يحتاج متابعة مدير',
      status: completed ? 'تم' : data.result,
      followup_status: completed ? 'تم' : data.result,
      completed_at: completed ? new Date().toISOString() : null,
      updated_by: user?.id || null,
    });
    setResultRow(null);
    await loadWorkspace();
  }

  function copyScript(item: QueueItem) {
    void navigator.clipboard.writeText(scriptFor(item));
    toast.success('تم نسخ السكريبت');
  }

  const visibleQueue = filteredQueue.filter((item) => tab === 'doctor-requests' ? item.source === 'doctor_request' : tab === 'care' ? ['important', 'at_risk'].includes(item.source) : true);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-teal-400/25 bg-gradient-to-l from-[#0b1c2f] to-[#12334a] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black text-teal-200">مركز خدمة العملاء الموحد</div>
            <h1 className="mt-1 text-3xl font-black text-white">قائمة {owner}: 30 عميلًا يوميًا</h1>
            <p className="mt-2 text-sm font-bold text-slate-300">كل فرع له قائمته المستقلة ومسئوله المعتمد، مع سجل كامل للمتابعات المنفذة.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {managerView ? <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>{BRANCHES.map((item) => <option key={item}>{item}</option>)}</select> : <span className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-4 py-3 text-sm font-black text-teal-100">{branch} · {owner}</span>}
            <button className="btn-secondary flex items-center gap-2" onClick={() => void loadWorkspace()}><RefreshCw size={16} /> تحديث</button>
            <button className="btn-primary" onClick={() => setQuickOpen(true)}>إضافة متابعة</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat icon={Users} label={`قائمة ${owner}`} value={queue.length} />
        <Stat icon={CheckCircle2} label="مكتمل اليوم" value={stats.completed} />
        <Stat icon={History} label="إجمالي السجل المكتمل" value={completedHistory.length} />
        <Stat icon={UserRoundSearch} label="طلبات دكاترة" value={queue.filter((item) => item.source === 'doctor_request').length} />
        <Stat icon={HeartHandshake} label="مهددون" value={queue.filter((item) => item.source === 'at_risk').length} />
        <Stat icon={Sparkles} label="عملاء مهمون" value={queue.filter((item) => item.source === 'important').length} />
      </section>

      <section className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#10243d] p-2">
        <Tab active={tab === 'today'} onClick={() => setTab('today')} icon={ClipboardList}>قائمة اليوم</Tab>
        <Tab active={tab === 'doctor-requests'} onClick={() => setTab('doctor-requests')} icon={UserRoundSearch}>طلبات الدكاترة</Tab>
        <Tab active={tab === 'care'} onClick={() => setTab('care')} icon={HeartHandshake}>الدلع والاسترجاع</Tab>
        <Tab active={tab === 'history'} onClick={() => setTab('history')} icon={History}>سجل المتابعات</Tab>
        <Tab active={tab === 'performance'} onClick={() => setTab('performance')} icon={BarChart3}>الأداء والتقارير</Tab>
      </section>

      {(tab === 'today' || tab === 'doctor-requests' || tab === 'care') && (
        <section className="grid gap-4 xl:grid-cols-[minmax(340px,.8fr)_minmax(0,1.2fr)]">
          <div className="stat-card min-h-[620px]">
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <div className="relative"><Search className="absolute right-3 top-3 text-slate-500" size={17} /><input className="input-dark pr-10" placeholder="اسم / كود / هاتف" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
              <select className="input-dark" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | QueueSource)}><option value="all">كل الأنواع</option><option value="doctor_request">طلبات الدكاترة</option><option value="yesterday">اشترى أمس</option><option value="at_risk">مهدد بالتوقف</option><option value="important">عميل مهم</option></select>
              <select className="input-dark" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">كل الحالات</option><option value="open">مفتوح</option><option value="completed">تم</option></select>
            </div>
            <div className="mt-4 max-h-[560px] space-y-2 overflow-y-auto pl-1">
              {loading ? <Empty text="جاري تجهيز قائمة اليوم..." /> : visibleQueue.map((item, index) => (
                <button key={item.key} onClick={() => setSelectedKey(item.key)} className={`w-full rounded-2xl border p-3 text-right transition ${selectedKey === item.key ? 'border-teal-300/50 bg-teal-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  <div className="flex items-start justify-between gap-3"><div><div className="font-black text-white">{index + 1}. {item.name}</div><div className="mt-1 text-xs text-slate-400">{item.code || 'بدون كود'} · {item.phone || 'بدون رقم'}</div></div><Badge>{sourceLabel(item.source)}</Badge></div>
                  <div className="mt-2 line-clamp-2 text-xs font-bold text-slate-300">{item.reason}</div>
                </button>
              ))}
              {!loading && !visibleQueue.length && <Empty text="لا توجد نتائج مطابقة." />}
            </div>
          </div>

          <div className="stat-card min-h-[620px]">
            {selected ? <div className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-black text-white">{selected.name}</h2><Badge>{sourceLabel(selected.source)}</Badge><Badge>{selected.status}</Badge><Badge>{selected.segment}</Badge></div><p className="mt-2 text-sm font-bold text-slate-400">{selected.code || 'بدون كود'} · {selected.phone || 'بدون رقم'} · {selected.branch}</p></div>
                <div className="flex gap-2"><a className="btn-secondary" href={`/customer-360?customerId=${encodeURIComponent(selected.customer?.customer_id || selected.customer?.id || selected.row?.customer_id || '')}&code=${encodeURIComponent(selected.code)}`}>ملف 360</a><button className="btn-primary" onClick={() => void openResult(selected)}>تسجيل النتيجة</button></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Info label="إجمالي المشتريات" value={formatCurrency(selected.totalSpent)} /><Info label="متوسط شهري" value={formatCurrency(selected.avgMonthly)} /><Info label="متوسط الفاتورة" value={formatCurrency(selected.avgInvoice)} /><Info label="آخر شراء" value={selected.lastPurchase ? new Date(selected.lastPurchase).toLocaleDateString('ar-EG') : 'غير متاح'} /></div>
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4"><div className="text-xs font-black text-amber-200">سبب المتابعة</div><div className="mt-2 text-base font-bold leading-7 text-amber-50">{selected.reason}</div></div>
              <div className="rounded-2xl border border-teal-400/20 bg-teal-500/10 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black text-teal-200">سكريبت ودود باسم {owner}</div><p className="mt-2 text-sm font-bold leading-7 text-teal-50">{scriptFor(selected)}</p></div><button className="btn-secondary shrink-0" onClick={() => copyScript(selected)}>نسخ</button></div></div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><button className="btn-primary" onClick={() => void openResult(selected)}>تسجيل نتيجة</button><button className="btn-secondary" disabled={!selected.phone} onClick={() => selected.phone && window.open(generateWhatsAppLink(selected.phone, scriptFor(selected)), '_blank')}>واتساب</button><a className="btn-secondary text-center" href={selected.phone ? `tel:${selected.phone}` : undefined}>اتصال</a><button className="btn-secondary" onClick={() => setQuickOpen(true)}>إضافة ملاحظة/متابعة</button></div>
              <div className="grid gap-4 xl:grid-cols-2"><Panel title="ملاحظات العميل"><p>{rowValue(selected.row, 'customer_notes', 'service_notes', 'handling_notes') || 'لا توجد ملاحظات مهمة مسجلة.'}</p></Panel><Panel title="حالة المتابعة"><p>{selected.completed ? 'تمت المتابعة' : 'مفتوحة وتحتاج تنفيذ'} · الأولوية {selected.priority}</p></Panel></div>
            </div> : <Empty text="اختر عميلًا من القائمة لعرض ملفه." />}
          </div>
        </section>
      )}

      {tab === 'history' && (
        <section className="stat-card">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><h2 className="text-2xl font-black text-white">سجل المتابعات المكتملة — {branch}</h2><p className="text-sm font-bold text-slate-400">كل متابعة تمت ونتيجتها وملاحظاتها وقيمة الشراء الناتج عنها.</p></div><Badge>{owner}</Badge></div>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-sm"><thead className="bg-white/5 text-slate-300"><tr><th className="p-3 text-right">العميل</th><th className="p-3 text-right">تاريخ التنفيذ</th><th className="p-3 text-right">النتيجة</th><th className="p-3 text-right">الملاحظات</th><th className="p-3 text-right">شراء بعد المتابعة</th><th className="p-3 text-right">ملف العميل</th></tr></thead>
              <tbody>{completedHistory.map((row) => {
                const item = followupToItem(row);
                const completedAt = rowValue(row, 'completed_at', 'updated_at', 'followup_date', 'date');
                return <tr key={row.id} className="border-t border-white/5 text-slate-200"><td className="p-3"><div className="font-black text-white">{item.name}</div><div className="text-xs text-slate-400">{item.code || 'بدون كود'} · {item.phone || 'بدون رقم'}</div></td><td className="p-3">{completedAt ? new Date(completedAt).toLocaleString('ar-EG') : '—'}</td><td className="p-3 font-bold text-teal-200">{rowValue(row, 'followup_result', 'contact_result', 'followup_status', 'status') || 'تم'}</td><td className="max-w-sm p-3">{rowValue(row, 'followup_summary', 'followup_notes', 'notes') || 'لا توجد ملاحظات'}</td><td className="p-3">{formatCurrency(rowNumber(row, 'purchase_amount'))}</td><td className="p-3"><a className="btn-secondary inline-block" href={`/customer-360?customerId=${encodeURIComponent(item.customer?.customer_id || item.customer?.id || row.customer_id || '')}&code=${encodeURIComponent(item.code)}`}>فتح 360</a></td></tr>;
              })}</tbody></table>
            {!completedHistory.length && <Empty text="لا يوجد سجل متابعات مكتملة لهذا الفرع حتى الآن." />}
          </div>
        </section>
      )}

      {tab === 'performance' && (
        <section className="grid gap-4 lg:grid-cols-2">
          {BRANCHES.map((branchName) => {
            const rows = branchName === branch ? allFollowups : [];
            const completedRows = rows.filter(isCompleted);
            const purchases = completedRows.filter((row) => rowNumber(row, 'purchase_amount') > 0);
            return <div key={branchName} className={`stat-card ${branchName !== branch ? 'opacity-60' : ''}`}><h3 className="text-xl font-black text-white">{BRANCH_OWNER[branchName]}</h3><p className="text-sm text-slate-400">{branchName}</p><div className="mt-4 grid gap-2 sm:grid-cols-3"><Info label="مكتمل" value={String(completedRows.length)} /><Info label="شراء بعد المتابعة" value={String(purchases.length)} /><Info label="مبيعات بعد المتابعة" value={formatCurrency(purchases.reduce((sum, row) => sum + rowNumber(row, 'purchase_amount'), 0))} /></div>{branchName !== branch && <p className="mt-3 text-xs font-bold text-slate-500">اختر هذا الفرع من الفلتر لعرض أرقامه.</p>}</div>;
          })}
        </section>
      )}

      <QuickFollowupModal open={quickOpen} onClose={() => setQuickOpen(false)} onCreated={() => void loadWorkspace()} defaultBranch={branch} />
      {resultRow && <FollowupResultModal followup={resultRow as unknown as DailyFollowup} onClose={() => setResultRow(null)} onSave={saveResult} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return <div className="stat-card"><div className="flex items-center gap-3"><div className="rounded-xl bg-teal-500/15 p-2 text-teal-300"><Icon size={19} /></div><div><div className="text-xs font-bold text-slate-400">{label}</div><div className="text-2xl font-black text-white">{value}</div></div></div></div>;
}

function Tab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${active ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}><Icon size={17} />{children}</button>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-teal-400/20 bg-teal-500/10 px-2 py-1 text-xs font-black text-teal-100">{children}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/5 bg-white/5 p-3"><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-1 font-black text-white">{value}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="mb-2 text-sm font-black text-white">{title}</div><div className="text-sm font-bold leading-7 text-slate-300">{children}</div></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm font-bold text-slate-400">{text}</div>;
}
