import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  History,
  Link2,
  Loader2,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Truck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { formatDate } from '@/lib/utils';
import { displayEgyptianPhone, generateWhatsAppLink } from '@/lib/whatsapp';
import ImageUploadBox from '@/components/ImageUploadBox';
import CustomerSmartSearch, { type CustomerSearchResult } from '@/components/CustomerSmartSearch';
import {
  createCustomerRequest,
  getCustomerRequestEvents,
  moveCustomerRequestToShortage,
  requestStatusLabel,
  REQUEST_STATUS_FLOW,
  updateCustomerRequestStatus,
  type CustomerRequest,
  type CustomerRequestEvent,
} from '@/lib/api/customerRequests';
import {
  customerRequestAgeHours,
  customerRequestIsClosed,
  customerRequestIsOverdue,
  customerRequestIsUrgent,
  customerRequestQualityIssues,
  getCustomerRequestsCommandSummary,
  getCustomerRequestsPage,
  type CustomerRequestCommandSummary,
  type CustomerRequestQuickFilter,
} from '@/lib/api/customerRequestsCommandCenter';

type StaffOption = { id: string; name: string; role: string | null; branch: string | null };

const EMPTY_SUMMARY: CustomerRequestCommandSummary = {
  total: 0,
  today: 0,
  open: 0,
  urgent: 0,
  overdue: 0,
  searching: 0,
  waiting_customer: 0,
  ready: 0,
  delivered: 0,
  not_available: 0,
  cancelled: 0,
  from_dawaawael: 0,
  unlinked_customer: 0,
  no_branch: 0,
  invalid_phone: 0,
  unassigned: 0,
  sync_conflicts: 0,
  moved_to_shortage: 0,
  fulfillment_rate: 0,
  avg_fulfillment_hours: 0,
};

const QUICK_FILTERS: Array<{
  value: CustomerRequestQuickFilter;
  label: string;
  description: string;
}> = [
  { value: 'attention', label: 'يحتاج تدخل الآن', description: 'طلبات حديثة ومفتوحة' },
  { value: 'today', label: 'طلبات اليوم', description: 'المسجلة اليوم' },
  { value: 'urgent', label: 'العاجلة', description: 'أولوية قصوى' },
  { value: 'overdue', label: 'المتأخرة', description: 'تجاوزت SLA' },
  { value: 'unassigned', label: 'بدون مسئول', description: 'تحتاج إسناد' },
  { value: 'unlinked', label: 'غير مربوط بعميل', description: 'جودة بيانات' },
  { value: 'backlog', label: 'Backlog تاريخي', description: 'أقدم من 7 أيام' },
  { value: 'all', label: 'كل الطلبات', description: 'بدون فلتر سريع' },
];

function ageLabel(request: CustomerRequest) {
  const hours = customerRequestAgeHours(request);
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 24) return `${Math.floor(hours)} ساعة`;
  const days = Math.floor(hours / 24);
  return `${days} يوم`;
}

function progressValue(status?: string | null) {
  const stages = ['new', 'purchasing_review', 'searching_suppliers', 'sourcing', 'available', 'arrived', 'customer_contacted', 'delivered'];
  const index = stages.indexOf(String(status || 'new'));
  if (status === 'cancelled' || status === 'not_available') return 100;
  if (index < 0) return 12;
  return Math.round(((index + 1) / stages.length) * 100);
}

function sourceLabel(request: CustomerRequest) {
  if (request.source_system === 'dawaawael') return 'dawaawael';
  return 'تسجيل الإدارة';
}

function currentOwner(request: CustomerRequest) {
  if (request.purchasing_assignee?.trim()) return request.purchasing_assignee;
  if (request.source_assigned_employee?.trim()) return request.source_assigned_employee;
  if (request.searching_by_name?.trim()) return request.searching_by_name;
  return 'غير مسند';
}

export default function CustomerRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [summary, setSummary] = useState<CustomerRequestCommandSummary>(EMPTY_SUMMARY);
  const [selected, setSelected] = useState<CustomerRequest | null>(null);
  const [events, setEvents] = useState<CustomerRequestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<CustomerRequestQuickFilter>('attention');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const { data: staff } = useSupabaseQuery<StaffOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });

  const doctors = useMemo(
    () =>
      (staff || []).filter((item) =>
        [item.name, item.role]
          .filter(Boolean)
          .some((value) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist/i.test(String(value)))
      ),
    [staff]
  );

  const assignees = useMemo(
    () => Array.from(new Set((staff || []).map((item) => item.name).filter(Boolean))).sort(),
    [staff]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, pageData] = await Promise.all([
        getCustomerRequestsCommandSummary(branchFilter),
        getCustomerRequestsPage({
          page,
          pageSize,
          status: statusFilter,
          branch: branchFilter,
          urgency: urgencyFilter,
          sourceSystem: sourceFilter,
          sourceChannel: channelFilter,
          assignee: assigneeFilter,
          search,
          quickFilter,
        }),
      ]);
      setSummary(summaryData);
      setRequests(pageData.rows);
      setTotalRows(pageData.count);
      setTotalPages(pageData.pages);
      setSelected((current) => {
        if (!pageData.rows.length) return null;
        if (current) return pageData.rows.find((item) => item.id === current.id) || pageData.rows[0];
        return pageData.rows[0];
      });
    } catch (error) {
      toast.error(`تعذر تحميل مركز طلبات العملاء: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [assigneeFilter, branchFilter, channelFilter, page, pageSize, quickFilter, search, sourceFilter, statusFilter, urgencyFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 350 : 50);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    setPage(1);
  }, [assigneeFilter, branchFilter, channelFilter, quickFilter, search, sourceFilter, statusFilter, urgencyFilter]);

  useEffect(() => {
    if (!selected) {
      setEvents([]);
      setNewStatus('');
      return;
    }
    setNewStatus(selected.status || 'new');
    void getCustomerRequestEvents(selected.id).then(setEvents);
  }, [selected]);

  const handleStatusUpdate = async () => {
    if (!selected || !newStatus || newStatus === selected.status) return;
    setSaving(true);
    try {
      const updated = await updateCustomerRequestStatus(selected, {
        status: newStatus,
        notes: statusNote,
        purchasing_notes: ['purchasing_review', 'searching_suppliers', 'sourcing', 'available', 'arrived'].includes(newStatus)
          ? statusNote
          : undefined,
        contact_summary: ['customer_contacted', 'delivered', 'closed'].includes(newStatus)
          ? statusNote
          : undefined,
        customer_confirmation_status: newStatus === 'customer_confirmed' ? 'confirmed' : undefined,
        user_id: user?.id,
        user_name: user?.name,
      });
      setStatusNote('');
      setSelected(updated);
      toast.success('تم تحديث حالة الطلب');
      await load();
    } catch (error) {
      toast.error(`تعذر تحديث الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleMoveToShortage = async () => {
    if (!selected) return;
    if (!window.confirm('سيتم ربط الطلب بقائمة النواقص مع الاحتفاظ بكل بيانات العميل والتتبع. هل تريد المتابعة؟')) return;
    setSaving(true);
    try {
      const result = await moveCustomerRequestToShortage(selected, {
        user_id: user?.id,
        user_name: user?.name,
      });
      setSelected(result.request);
      toast.success('تم ربط الطلب بالنواقص');
      await load();
    } catch (error) {
      toast.error(`تعذر نقل الطلب للنواقص: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = () => {
    if (!selected?.customer_phone) return toast.error('لا يوجد رقم هاتف صالح للعميل');
    const message = `أهلاً ${selected.customer_name || 'حضرتك'}، مع حضرتك صيدليات دواء بخصوص طلب صنف ${selected.medicine_name}.`;
    window.open(generateWhatsAppLink(selected.customer_phone, message), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        summary={summary}
        onCreate={() => setShowCreate((value) => !value)}
        onRefresh={load}
        loading={loading}
      />

      <QuickQueues value={quickFilter} onChange={setQuickFilter} summary={summary} />

      {showCreate && (
        <CreateRequestPanel
          doctors={doctors}
          user={user}
          onCreated={async (request) => {
            setShowCreate(false);
            setSelected(request);
            setQuickFilter('today');
            setPage(1);
            toast.success('تم تسجيل طلب العميل');
            await load();
          }}
        />
      )}

      <Filters
        search={search}
        setSearch={setSearch}
        branch={branchFilter}
        setBranch={setBranchFilter}
        status={statusFilter}
        setStatus={setStatusFilter}
        urgency={urgencyFilter}
        setUrgency={setUrgencyFilter}
        source={sourceFilter}
        setSource={setSourceFilter}
        channel={channelFilter}
        setChannel={setChannelFilter}
        assignee={assigneeFilter}
        setAssignee={setAssigneeFilter}
        assignees={assignees}
      />

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(340px,0.95fr)_minmax(0,2.05fr)]">
        <section className="min-w-0 rounded-3xl border border-slate-700 bg-slate-950/50 p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <div className="font-black text-white">قائمة التشغيل</div>
              <div className="mt-1 text-xs text-slate-400">
                {totalRows.toLocaleString('ar-EG')} طلب مطابق للفلاتر
              </div>
            </div>
            <select
              className="input-dark w-auto min-w-24 text-xs"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-800/80" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">
              لا توجد طلبات مطابقة للفلاتر الحالية.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-245px)] space-y-2 overflow-y-auto pe-1 [scrollbar-color:#22d3ee_#0f172a] [scrollbar-width:thin]">
              {requests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  selected={selected?.id === request.id}
                  onSelect={() => setSelected(request)}
                />
              ))}
            </div>
          )}

          <Pagination page={page} pages={totalPages} onPage={setPage} />
        </section>

        <section className="min-w-0">
          {selected ? (
            <RequestDetail
              request={selected}
              events={events}
              newStatus={newStatus}
              setNewStatus={setNewStatus}
              note={statusNote}
              setNote={setStatusNote}
              saving={saving}
              onStatus={handleStatusUpdate}
              onWhatsApp={openWhatsApp}
              onShortage={handleMoveToShortage}
            />
          ) : (
            <div className="rounded-3xl border border-slate-700 bg-[#102640] p-12 text-center text-slate-400">
              اختر طلبًا من القائمة لعرض مركز تفاصيله.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CommandHeader({
  summary,
  onCreate,
  onRefresh,
  loading,
}: {
  summary: CustomerRequestCommandSummary;
  onCreate: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const kpis = [
    { label: 'إجمالي الطلبات', value: summary.total, icon: Database, tone: 'text-cyan-200' },
    { label: 'مفتوحة', value: summary.open, icon: PackageSearch, tone: 'text-amber-200' },
    { label: 'عاجلة', value: summary.urgent, icon: AlertTriangle, tone: 'text-red-300' },
    { label: 'جاري البحث', value: summary.searching, icon: Search, tone: 'text-indigo-200' },
    { label: 'جاهزة/متوفرة', value: summary.ready, icon: PackageCheck, tone: 'text-emerald-300' },
    { label: 'تم التسليم', value: summary.delivered, icon: CheckCircle2, tone: 'text-green-300' },
  ];

  return (
    <>
      <section className="overflow-hidden rounded-3xl border border-cyan-400/25 bg-gradient-to-l from-[#113656] via-[#102640] to-[#071526] p-5 shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-2xl font-black text-white">
              <Sparkles className="text-cyan-300" size={24} /> مركز تشغيل طلبات العملاء
            </div>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-7 text-slate-300">
              شاشة واحدة لمتابعة الطلب من التسجيل حتى التوفير والتواصل والتسليم، مع أولوية ذكية وجودة بيانات ومصدر الطلب والمسئول الحالي.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-emerald-200">نسبة التوفير {summary.fulfillment_rate}%</span>
              <span className="rounded-full bg-cyan-500/15 px-3 py-1.5 text-cyan-200">متوسط دورة الطلب {summary.avg_fulfillment_hours} ساعة</span>
              <span className="rounded-full bg-slate-700/70 px-3 py-1.5 text-slate-200">{summary.from_dawaawael} من dawaawael</span>
              {summary.sync_conflicts > 0 && <span className="rounded-full bg-red-500/15 px-3 py-1.5 text-red-200">{summary.sync_conflicts} تعارض مزامنة</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex items-center gap-2" onClick={onCreate}><Plus size={16} /> تسجيل طلب</button>
            <button className="btn-secondary flex items-center gap-2" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-700 bg-[#102640] p-4 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <Icon size={18} className={tone} />
              <span className={`num text-2xl font-black ${tone}`}>{value.toLocaleString('ar-EG')}</span>
            </div>
            <div className="mt-2 text-xs font-bold text-slate-300">{label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function QuickQueues({
  value,
  onChange,
  summary,
}: {
  value: CustomerRequestQuickFilter;
  onChange: (value: CustomerRequestQuickFilter) => void;
  summary: CustomerRequestCommandSummary;
}) {
  const counts: Partial<Record<CustomerRequestQuickFilter, number>> = {
    today: summary.today,
    urgent: summary.urgent,
    overdue: summary.overdue,
    unassigned: summary.unassigned,
    unlinked: summary.unlinked_customer,
    all: summary.total,
  };

  return (
    <section className="rounded-3xl border border-slate-700 bg-[#102640] p-4 shadow-lg">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
        <BarChart3 size={18} className="text-cyan-300" /> قوائم العمل الذكية
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {QUICK_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`rounded-2xl border p-3 text-right transition ${value === item.value ? 'border-cyan-300 bg-cyan-500/15 shadow-lg' : 'border-slate-700 bg-slate-900/60 hover:border-cyan-400/50'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-white">{item.label}</span>
              {counts[item.value] !== undefined && <span className="num text-xs font-black text-cyan-200">{counts[item.value]}</span>}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-slate-400">{item.description}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Filters(props: {
  search: string;
  setSearch: (value: string) => void;
  branch: string;
  setBranch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  urgency: string;
  setUrgency: (value: string) => void;
  source: string;
  setSource: (value: string) => void;
  channel: string;
  setChannel: (value: string) => void;
  assignee: string;
  setAssignee: (value: string) => void;
  assignees: string[];
}) {
  return (
    <section className="rounded-3xl border border-slate-700 bg-[#102640] p-4 shadow-lg">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
        <div className="relative md:col-span-2 xl:col-span-2">
          <Search size={16} className="absolute left-3 top-3.5 text-slate-400" />
          <input
            className="input-dark pl-9"
            placeholder="اسم العميل، الكود، الهاتف، الصنف، رقم الطلب..."
            value={props.search}
            onChange={(event) => props.setSearch(event.target.value)}
          />
        </div>
        <select className="input-dark" value={props.branch} onChange={(event) => props.setBranch(event.target.value)}>
          <option value="all">كل الفروع</option>
          <option value="فرع شكري">فرع شكري</option>
          <option value="فرع الشامي">فرع الشامي</option>
        </select>
        <select className="input-dark" value={props.status} onChange={(event) => props.setStatus(event.target.value)}>
          <option value="all">كل الحالات</option>
          {REQUEST_STATUS_FLOW.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select className="input-dark" value={props.urgency} onChange={(event) => props.setUrgency(event.target.value)}>
          <option value="all">كل الأولويات</option>
          <option value="urgent">عاجل/مهم</option>
          <option value="normal">عادي</option>
        </select>
        <select className="input-dark" value={props.source} onChange={(event) => props.setSource(event.target.value)}>
          <option value="all">كل المصادر</option>
          <option value="dawaawael">dawaawael</option>
          <option value="manual">تسجيل الإدارة</option>
        </select>
        <select className="input-dark" value={props.channel} onChange={(event) => props.setChannel(event.target.value)}>
          <option value="all">كل قنوات الطلب</option>
          <option value="واتساب">واتساب</option>
          <option value="داخل الصيدلية">داخل الصيدلية</option>
          <option value="مكالمة هاتفية">مكالمة هاتفية</option>
        </select>
        <select className="input-dark xl:col-start-6 xl:col-span-2" value={props.assignee} onChange={(event) => props.setAssignee(event.target.value)}>
          <option value="all">كل المسئولين</option>
          <option value="unassigned">بدون مسئول</option>
          {props.assignees.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
    </section>
  );
}

function RequestCard({ request, selected, onSelect }: { request: CustomerRequest; selected: boolean; onSelect: () => void }) {
  const issues = customerRequestQualityIssues(request);
  const overdue = customerRequestIsOverdue(request);
  const urgent = customerRequestIsUrgent(request);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-right transition ${selected ? 'border-cyan-300 bg-cyan-500/15 shadow-lg' : overdue ? 'border-amber-500/35 bg-amber-500/[0.06] hover:border-amber-300/60' : 'border-slate-700 bg-[#132946] hover:border-cyan-400/50'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${urgent ? 'bg-red-500/15 text-red-300' : 'bg-teal-500/15 text-teal-300'}`}>
          <PackageSearch size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="max-w-full truncate font-black text-white">{request.medicine_name}</div>
            <span className={overdue ? 'badge-warning' : customerRequestIsClosed(request) ? 'badge-success' : 'badge-info'}>{requestStatusLabel(request.status)}</span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-400">
            {request.customer_name || 'عميل غير محدد'} · كود {request.customer_code || '—'} · {displayEgyptianPhone(request.customer_phone || '') || 'بدون هاتف'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
            <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-200">{request.branch || 'بدون فرع'}</span>
            <span className="rounded-lg bg-slate-800 px-2 py-1 text-cyan-200"><Clock3 size={11} className="inline ms-1" />{ageLabel(request)}</span>
            <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-200">{sourceLabel(request)}</span>
            {request.source_order_number && <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">#{request.source_order_number}</span>}
            {urgent && <span className="rounded-lg bg-red-500/15 px-2 py-1 text-red-200">عاجل</span>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>المسئول: <strong className="text-slate-200">{currentOwner(request)}</strong></span>
            {issues.length > 0 && <span className="text-amber-300">{issues.length} ملاحظة بيانات</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

function RequestDetail(props: {
  request: CustomerRequest;
  events: CustomerRequestEvent[];
  newStatus: string;
  setNewStatus: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  saving: boolean;
  onStatus: () => void;
  onWhatsApp: () => void;
  onShortage: () => void;
}) {
  const request = props.request;
  const issues = customerRequestQualityIssues(request);
  const progress = progressValue(request.status);
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-cyan-500/25 bg-[#102640] p-5 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {(request.medicine_image_url || request.item_image_url) ? (
            <img src={request.medicine_image_url || request.item_image_url || ''} alt={request.medicine_name} className="h-24 w-24 shrink-0 rounded-2xl border border-cyan-400/30 bg-slate-900 object-cover" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-300"><ShoppingCart size={26} /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black text-white">{request.medicine_name}</h2>
              <span className="badge-info">{requestStatusLabel(request.status)}</span>
              {customerRequestIsUrgent(request) && <span className="badge-danger">عاجل</span>}
              {customerRequestIsOverdue(request) && <span className="badge-warning">متأخر</span>}
              {request.shortage_item_id && <span className="badge-info">مرتبط بالنواقص</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-slate-800 px-3 py-1.5 text-slate-200">المصدر: {sourceLabel(request)}</span>
              {request.source_request_channel && <span className="rounded-full bg-slate-800 px-3 py-1.5 text-slate-200">القناة: {request.source_request_channel}</span>}
              {request.source_order_number && <span className="rounded-full bg-slate-800 px-3 py-1.5 text-cyan-200">رقم المصدر: {request.source_order_number}</span>}
              <span className="rounded-full bg-slate-800 px-3 py-1.5 text-slate-200">المسئول: {currentOwner(request)}</span>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-300"><span>تقدم تنفيذ الطلب</span><span className="num text-cyan-200">{progress}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-l from-cyan-400 to-teal-500" style={{ width: `${progress}%` }} /></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:w-44 lg:flex-col">
            <button className="btn-primary flex flex-1 items-center justify-center gap-2" onClick={props.onWhatsApp}><MessageCircle size={15} /> واتساب</button>
            <button className="btn-secondary flex flex-1 items-center justify-center gap-2" onClick={props.onShortage} disabled={props.saving}><PackageSearch size={15} /> للنواقص</button>
            {request.customer_id && <Link to={`/customers/${request.customer_id}`} className="btn-secondary flex flex-1 items-center justify-center gap-2"><UserRound size={15} /> ملف العميل</Link>}
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 font-black text-amber-200"><AlertTriangle size={17} /> مراجعة جودة البيانات</div>
          <div className="mt-2 flex flex-wrap gap-2">{issues.map((issue) => <span key={issue} className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-100">{issue}</span>)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InfoCard title="بيانات العميل والطلب" icon={UsersRound}>
          <Line label="العميل" value={request.customer_name || 'غير محدد'} />
          <Line label="الكود" value={request.customer_code || 'غير محدد'} />
          <Line label="الهاتف" value={displayEgyptianPhone(request.customer_phone || '') || 'غير محدد'} />
          <Line label="الفرع" value={request.branch || 'غير محدد'} />
          <Line label="الكمية" value={String(request.quantity || 1)} />
          <Line label="تاريخ الطلب" value={request.requested_at ? formatDate(request.requested_at) : request.created_at ? formatDate(request.created_at) : 'غير محدد'} />
          <Line label="عمر الطلب" value={ageLabel(request)} />
        </InfoCard>

        <InfoCard title="المشتريات والتوفير" icon={Truck}>
          <Line label="المسئول الحالي" value={currentOwner(request)} />
          <Line label="بدأ البحث بواسطة" value={request.searching_by_name || 'غير محدد'} />
          <Line label="تم التوفير بواسطة" value={request.provided_by_name || 'غير محدد'} />
          <Line label="المورد/المصدر" value={request.supplier_hint || request.potential_source_text || 'غير محدد'} />
          <Line label="السعر المتوقع" value={request.expected_price ? `${request.expected_price} ج` : 'غير محدد'} />
          <Line label="موعد الوصول" value={request.expected_arrival_date ? formatDate(request.expected_arrival_date) : 'غير محدد'} />
          <Line label="ملاحظات المشتريات" value={request.purchasing_notes || request.source_notes || 'لا توجد'} />
        </InfoCard>

        <InfoCard title="التواصل والنتيجة" icon={Phone}>
          <Line label="تم التواصل بواسطة" value={request.customer_contacted_by_name || 'غير محدد'} />
          <Line label="ملخص التواصل" value={request.contact_summary || 'لا يوجد'} />
          <Line label="حالة تأكيد العميل" value={request.customer_confirmation_status || 'غير محدد'} />
          <Line label="تم التسليم بواسطة" value={request.delivered_by_name || 'غير محدد'} />
          <Line label="تاريخ الإغلاق" value={request.closed_at ? formatDate(request.closed_at) : 'ما زال مفتوحًا'} />
        </InfoCard>

        <InfoCard title="تحديث الحالة" icon={RefreshCw}>
          <select className="input-dark" value={props.newStatus} onChange={(event) => props.setNewStatus(event.target.value)}>
            {REQUEST_STATUS_FLOW.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <textarea className="input-dark mt-3 min-h-24" value={props.note} onChange={(event) => props.setNote(event.target.value)} placeholder="نتيجة البحث، رد المورد، تأكيد العميل، أو ملخص التواصل..." />
          <button className="btn-primary mt-3 flex w-full items-center justify-center gap-2" disabled={props.saving || props.newStatus === request.status} onClick={props.onStatus}>
            {props.saving && <Loader2 size={16} className="animate-spin" />} حفظ التحديث
          </button>
        </InfoCard>
      </div>

      <InfoCard title="سجل الحركة الكامل" icon={History}>
        {props.events.length === 0 ? (
          <div className="text-sm text-slate-400">لا توجد أحداث مسجلة.</div>
        ) : (
          <div className="space-y-3">
            {props.events.map((event) => (
              <div key={event.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">{event.action || 'تحديث'}</strong><span className="text-xs text-slate-400">{event.created_at ? formatDate(event.created_at) : ''}</span></div>
                <div className="mt-1 text-sm text-slate-300">{event.notes || 'بدون ملاحظات'}</div>
                <div className="mt-1 text-xs text-slate-500">{event.old_status ? requestStatusLabel(event.old_status) : 'بداية'} ← {requestStatusLabel(event.new_status)} · {event.created_by_name || 'النظام'}</div>
              </div>
            ))}
          </div>
        )}
      </InfoCard>
    </div>
  );
}

function CreateRequestPanel({
  doctors,
  user,
  onCreated,
}: {
  doctors: StaffOption[];
  user: { id?: string; name?: string } | null;
  onCreated: (request: CustomerRequest) => void | Promise<void>;
}) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [medicineName, setMedicineName] = useState('');
  const [image, setImage] = useState({ publicUrl: '', path: '' });
  const [quantity, setQuantity] = useState(1);
  const [urgency, setUrgency] = useState('normal');
  const [doctorId, setDoctorId] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [supplierHint, setSupplierHint] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedDoctor = doctors.find((item) => item.id === doctorId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer?.name) return toast.error('اختر العميل أولًا');
    if (!medicineName.trim()) return toast.error('اكتب اسم الصنف المطلوب');
    setSaving(true);
    try {
      const created = await createCustomerRequest({
        customer_id: selectedCustomer.id,
        customer_code: selectedCustomer.code,
        customer_name: selectedCustomer.name,
        customer_phone: selectedCustomer.phone,
        branch: selectedCustomer.branch || selectedDoctor?.branch || null,
        medicine_name: medicineName.trim(),
        medicine_image_url: image.publicUrl || null,
        item_image_url: image.publicUrl || null,
        item_image_path: image.path || null,
        quantity,
        urgency,
        doctor_id: selectedDoctor?.id || null,
        doctor_name: selectedDoctor?.name || null,
        doctor_notes: doctorNotes || null,
        supplier_hint: supplierHint || null,
        created_by: user?.id,
        created_by_name: user?.name,
      });
      await onCreated(created);
    } catch (error) {
      toast.error(`تعذر تسجيل الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-teal-400/25 bg-[#102640] p-5 shadow-xl">
      <div className="flex items-center gap-2 text-lg font-black text-white"><Plus size={19} className="text-teal-300" /> تسجيل طلب جديد</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-3"><CustomerSmartSearch value={selectedCustomer} onSelect={setSelectedCustomer} placeholder="ابحث باسم العميل أو الكود أو الهاتف" disabled={saving} allowCreate /></div>
        <input className="input-dark" value={medicineName} onChange={(event) => setMedicineName(event.target.value)} placeholder="اسم الصنف المطلوب *" />
        <input className="input-dark" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value || 1))} placeholder="الكمية" />
        <select className="input-dark" value={urgency} onChange={(event) => setUrgency(event.target.value)}><option value="normal">عادي</option><option value="high">مهم</option><option value="urgent">عاجل</option></select>
        <select className="input-dark" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">الدكتور/الموظف المسجل</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} - {doctor.branch || ''}</option>)}</select>
        <input className="input-dark" value={supplierHint} onChange={(event) => setSupplierHint(event.target.value)} placeholder="مورد/مصدر محتمل" />
        <textarea className="input-dark min-h-20 lg:col-span-1" value={doctorNotes} onChange={(event) => setDoctorNotes(event.target.value)} placeholder="ملاحظات الطلب" />
        <div className="lg:col-span-3"><ImageUploadBox bucket="customer-request-images" folder="customer-requests" label="صورة الصنف (اختياري)" valueUrl={image.publicUrl} valuePath={image.path} onUploaded={setImage} disabled={saving} /></div>
      </div>
      <button className="btn-primary flex min-w-44 items-center justify-center gap-2" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ الطلب</button>
    </form>
  );
}

function InfoCard({ title, icon: Icon, children }: { title: string; icon: typeof History; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-700 bg-[#102640] p-5 shadow-lg">
      <div className="mb-4 flex items-center gap-2 font-black text-white"><Icon size={18} className="text-cyan-300" />{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-700/60 pb-2 text-sm last:border-0"><span className="shrink-0 text-slate-400">{label}</span><span className="break-words text-left font-semibold text-slate-100">{value}</span></div>;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-700 pt-3">
      <button className="btn-secondary flex items-center gap-1 px-3 py-2 text-xs" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}><ArrowRight size={14} /> السابق</button>
      <div className="text-xs font-bold text-slate-300">صفحة <span className="num text-cyan-200">{page}</span> من <span className="num">{pages}</span></div>
      <button className="btn-secondary flex items-center gap-1 px-3 py-2 text-xs" disabled={page >= pages} onClick={() => onPage(Math.min(pages, page + 1))}>التالي <ArrowLeft size={14} /></button>
    </div>
  );
}
