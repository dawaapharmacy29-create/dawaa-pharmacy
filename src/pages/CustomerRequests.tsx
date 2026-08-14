import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Eye,
  History,
  LayoutGrid,
  List,
  Loader2,
  MessageCircle,
  PackageCheck,
  PackagePlus,
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
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { formatDate } from '@/lib/utils';
import { displayEgyptianPhone, generateWhatsAppLink } from '@/lib/whatsapp';
import ImageUploadBox from '@/components/ImageUploadBox';
import CustomerSmartSearch, { type CustomerSearchResult } from '@/components/CustomerSmartSearch';
import ProductSmartSearch from '@/components/ProductSmartSearch';
import CustomerRequestInsightsPanel from '@/components/customer-requests/CustomerRequestInsightsPanel';
import CustomerRequestQualityCenter from '@/components/customer-requests/CustomerRequestQualityCenter'; // CUSTOMER_REQUEST_QUALITY_CENTER_V4
import CustomerRequestWarehousePanel from '@/components/customer-requests/CustomerRequestWarehousePanel';
import CustomerRequestCriticalToday from '@/components/customer-requests/CustomerRequestCriticalToday'; // CUSTOMER_REQUEST_PRODUCT_MATCHING_WAREHOUSE_V7
import CustomerRequestDataQualityPanel from '@/components/customer-requests/CustomerRequestDataQualityPanel'; // CUSTOMER_REQUEST_DATA_QUALITY_V3
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
import { linkCustomerRequestProduct, type CatalogProduct } from '@/lib/api/productsCatalog';
import { exportToExcel } from '@/lib/exportExcel';

type StaffOption = { id: string; name: string; role: string | null; branch: string | null };
type RequestWithProduct = CustomerRequest & {
  product_id?: string | null;
  product_code?: string | null;
  product_price?: number | null;
};
type ViewMode = 'table' | 'cards';

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

const QUICK_FILTERS: Array<{ value: CustomerRequestQuickFilter; label: string; description: string }> = [
  { value: 'attention', label: 'يحتاج تدخل الآن', description: 'طلبات مفتوحة وحديثة' },
  { value: 'today', label: 'طلبات اليوم', description: 'المسجلة اليوم' },
  { value: 'urgent', label: 'العاجلة', description: 'أولوية قصوى' },
  { value: 'overdue', label: 'المتأخرة', description: 'تجاوزت وقت المرحلة' },
  { value: 'unassigned', label: 'بدون مسئول', description: 'تحتاج إسناد' },
  { value: 'unlinked', label: 'عميل غير مربوط', description: 'جودة بيانات' },
  { value: 'sync_review', label: 'يحتاج تحديد فرع', description: 'طلبات مزامنة لم يُحسم فرعها' },
  { value: 'backlog', label: 'الطلبات القديمة', description: 'أقدم من 7 أيام' },
  { value: 'all', label: 'كل الطلبات', description: 'عرض كامل' },
];

const QUICK_ACTIONS = [
  { status: 'searching_suppliers', label: 'بدء البحث', icon: Search },
  { status: 'available', label: 'تم التوفير', icon: PackageCheck },
  { status: 'customer_contacted', label: 'تم التواصل', icon: MessageCircle },
  { status: 'delivered', label: 'تم التسليم', icon: CheckCircle2 },
] as const;

function requestTimestamp(request: CustomerRequest) {
  return request.requested_at || request.created_at || null;
}

function exactRequestTime(request: CustomerRequest) {
  const raw = requestTimestamp(request);
  if (!raw) return 'وقت غير محدد';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'وقت غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function ageLabel(request: CustomerRequest) {
  const hours = customerRequestAgeHours(request);
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 24) return `${Math.floor(hours)} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}

function currentOwner(request: CustomerRequest) {
  return request.purchasing_assignee?.trim() || request.source_assigned_employee?.trim() || request.searching_by_name?.trim() || 'غير مسند';
}

function registrarName(request: CustomerRequest) {
  return request.doctor_name?.trim() || request.created_by_name?.trim() || request.source_assigned_employee?.trim() || 'غير محدد';
}

function importanceLabel(request: CustomerRequest) {
  const value = String(request.urgency || request.priority || '').toLowerCase();
  if (request.is_urgent || value === 'urgent' || value === 'عاجل') return { label: 'عاجل', className: 'border-red-400/30 bg-red-500/15 text-red-200' };
  if (value === 'high' || value === 'مهم') return { label: 'مهم', className: 'border-amber-400/30 bg-amber-500/15 text-amber-200' };
  return { label: 'عادي', className: 'border-slate-600 bg-slate-700/70 text-slate-200' };
}

function requestTypeLabel(request: CustomerRequest) {
  const value = String(request.request_type || '').toLowerCase();
  if (value.includes('urgent') || customerRequestIsUrgent(request)) return 'عاجل';
  if (value.includes('shortage') || value.includes('missing') || value.includes('ناقص')) return 'صنف ناقص';
  if (value.includes('inquiry')) return 'استفسار';
  return 'طلب عادي';
}

function customerImportanceLabel(request: CustomerRequest) {
  const payload = request.source_payload || {};
  const value = String(request.customer_segment || payload.customer_segment || payload.segment || payload.customer_type || '').toLowerCase();
  if (/vip|very|مهم جدا/.test(value)) return 'مهم جدًا';
  if (/important|high|مهم/.test(value)) return 'مهم';
  return 'عادي';
}

function requestChannelLabel(request: CustomerRequest) {
  return request.source_request_channel || (request.source_system === 'dawaawael' ? 'واتساب' : 'داخل الصيدلية');
}

function nextAction(request: CustomerRequest) {
  switch (request.status) {
    case 'new':
    case 'purchasing_review': return 'ابدأ البحث عن الصنف';
    case 'searching_suppliers': return 'تابع الموردين وسجل النتيجة';
    case 'needs_customer_confirmation': return 'تواصل مع العميل للتأكيد';
    case 'customer_confirmed':
    case 'sourcing': return 'أكمل التوفير وحدد موعد الوصول';
    case 'available':
    case 'arrived': return 'الصنف جاهز — تواصل مع العميل الآن';
    case 'customer_contacted': return 'تابع الاستلام وسجل التسليم';
    case 'delivered':
    case 'closed': return 'الطلب مكتمل';
    case 'not_available': return 'راجع بديل أو أغلق الطلب';
    case 'cancelled': return 'الطلب ملغي';
    default: return 'راجع حالة الطلب وحدد الخطوة التالية';
  }
}

function progressValue(status?: string | null) {
  const stages = ['new', 'purchasing_review', 'searching_suppliers', 'sourcing', 'available', 'arrived', 'customer_contacted', 'delivered'];
  if (status === 'cancelled' || status === 'not_available') return 100;
  const index = stages.indexOf(String(status || 'new'));
  return index < 0 ? 12 : Math.round(((index + 1) / stages.length) * 100);
}

export default function CustomerRequests() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [branchFilter, setBranchFilter] = useState(() => searchParams.get('branch') || 'all');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [quickFilter, setQuickFilter] = useState<CustomerRequestQuickFilter>(() => {
    const value = searchParams.get('quick') as CustomerRequestQuickFilter | null;
    return QUICK_FILTERS.some((item) => item.value === value) ? (value as CustomerRequestQuickFilter) : 'attention';
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [showDetails, setShowDetails] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'requests' | 'followup' | 'analytics' | 'quality' | 'archive'>(() => {
    const value = searchParams.get('workspace');
    return ['overview', 'requests', 'followup', 'analytics', 'quality', 'archive'].includes(String(value)) ? value as 'overview' | 'requests' | 'followup' | 'analytics' | 'quality' | 'archive' : 'overview';
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false); // ADMIN_CUSTOMER_REQUESTS_TABS_V1
  const [contextRequestId, setContextRequestId] = useState(() => searchParams.get('requestId') || '');
  const [contextCustomerId, setContextCustomerId] = useState(() => searchParams.get('customerId') || '');
  const [contextCustomerCode, setContextCustomerCode] = useState(() => searchParams.get('customerCode') || '');
  const [contextCustomerPhone, setContextCustomerPhone] = useState(() => searchParams.get('customerPhone') || '');
  const [contextCustomerName, setContextCustomerName] = useState(() => searchParams.get('customerName') || '');
  const [contextProductCode, setContextProductCode] = useState(() => searchParams.get('productCode') || '');
  const [contextMedicineName, setContextMedicineName] = useState(() => searchParams.get('medicineName') || '');
  const [registrarFilter, setRegistrarFilter] = useState(() => searchParams.get('registrar') || ''); // CUSTOMER_REQUEST_CONTEXT_ROUTING_V2

  const { data: staff } = useSupabaseQuery<StaffOption>({ table: 'staff', filters: isActiveStaffFilter(), realtimeEnabled: false });
  const doctors = useMemo(() => (staff || []).filter((item) => [item.name, item.role].filter(Boolean).some((value) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist/i.test(String(value)))), [staff]);
  const assignees = useMemo(() => Array.from(new Set((staff || []).map((item) => item.name).filter(Boolean))).sort(), [staff]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, pageData] = await Promise.all([
        getCustomerRequestsCommandSummary(branchFilter),
        getCustomerRequestsPage({ page, pageSize, status: statusFilter, branch: branchFilter, urgency: urgencyFilter, sourceSystem: sourceFilter, sourceChannel: channelFilter, assignee: assigneeFilter, dateFrom, dateTo, search, quickFilter, requestId: contextRequestId, customerId: contextCustomerId, customerCode: contextCustomerCode, customerPhone: contextCustomerPhone, productCode: contextProductCode, medicineName: contextMedicineName, registrar: registrarFilter }),
      ]);
      setSummary(summaryData);
      setRequests(pageData.rows);
      setTotalRows(pageData.count);
      setTotalPages(pageData.pages);
      setSelected((current) => current ? pageData.rows.find((item) => item.id === current.id) || current : pageData.rows[0] || null);
    } catch (error) {
      toast.error(`تعذر تحميل طلبات العملاء: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [assigneeFilter, branchFilter, channelFilter, contextCustomerCode, contextCustomerId, contextCustomerPhone, contextMedicineName, contextProductCode, contextRequestId, dateFrom, dateTo, page, pageSize, quickFilter, registrarFilter, search, sourceFilter, statusFilter, urgencyFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 300 : 30);
    return () => window.clearTimeout(timer);
  }, [load, search]);
  useEffect(() => setPage(1), [assigneeFilter, branchFilter, channelFilter, contextCustomerCode, contextCustomerId, contextCustomerPhone, contextMedicineName, contextProductCode, contextRequestId, dateFrom, dateTo, quickFilter, registrarFilter, search, sourceFilter, statusFilter, urgencyFilter]);
  useEffect(() => {
    if (!selected || !showDetails) return;
    setNewStatus(selected.status || 'new');
    void getCustomerRequestEvents(selected.id).then(setEvents).catch(() => setEvents([]));
  }, [selected, showDetails]);
  useEffect(() => {
    if (!showDetails) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setShowDetails(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [showDetails]);

  const openDetails = (request: CustomerRequest) => {
    setSelected(request);
    setShowDetails(true);
  };

  const clearRequestContext = () => {
    setContextRequestId('');
    setContextCustomerId('');
    setContextCustomerCode('');
    setContextCustomerPhone('');
    setContextCustomerName('');
    setContextProductCode('');
    setContextMedicineName('');
    setRegistrarFilter('');
  };

  useEffect(() => {
    if (!contextRequestId || !requests.length) return;
    const request = requests.find((item) => item.id === contextRequestId);
    if (request) openDetails(request);
  }, [contextRequestId, requests]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (workspaceTab !== 'overview') next.set('workspace', workspaceTab);
    if (branchFilter !== 'all') next.set('branch', branchFilter);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (quickFilter !== 'attention') next.set('quick', quickFilter);
    if (search) next.set('search', search);
    if (assigneeFilter !== 'all') next.set('assignee', assigneeFilter);
    if (registrarFilter) next.set('registrar', registrarFilter);
    if (contextRequestId) next.set('requestId', contextRequestId);
    if (contextCustomerId) next.set('customerId', contextCustomerId);
    if (contextCustomerCode) next.set('customerCode', contextCustomerCode);
    if (contextCustomerPhone) next.set('customerPhone', contextCustomerPhone);
    if (contextCustomerName) next.set('customerName', contextCustomerName);
    if (contextProductCode) next.set('productCode', contextProductCode);
    if (contextMedicineName) next.set('medicineName', contextMedicineName);
    setSearchParams(next, { replace: true });
  }, [assigneeFilter, branchFilter, contextCustomerCode, contextCustomerId, contextCustomerName, contextCustomerPhone, contextMedicineName, contextProductCode, contextRequestId, quickFilter, registrarFilter, search, setSearchParams, statusFilter, workspaceTab]);

  const applyAnalyticsAction = (action: { quickFilter?: 'all' | 'overdue' | 'unassigned'; status?: string; assignee?: string; search?: string; branch?: string; customerCode?: string; customerPhone?: string; customerName?: string; productCode?: string; medicineName?: string }) => {
    const hasEntityContext = Boolean(action.customerCode || action.customerPhone || action.customerName || action.productCode || action.medicineName);
    if (hasEntityContext) {
      clearRequestContext();
      setSearch('');
      setContextCustomerCode(action.customerCode || '');
      setContextCustomerPhone(action.customerPhone || '');
      setContextCustomerName(action.customerName || '');
      setContextProductCode(action.productCode || '');
      setContextMedicineName(action.medicineName || '');
    }
    if (action.branch) setBranchFilter(action.branch);
    if (action.quickFilter) setQuickFilter(action.quickFilter);
    if (action.status) { setStatusFilter(action.status); setQuickFilter('all'); }
    if (action.assignee) { clearRequestContext(); setAssigneeFilter(action.assignee); setQuickFilter('all'); }
    if (action.search) { clearRequestContext(); setSearch(action.search); setQuickFilter('all'); }
    setWorkspaceTab('requests');
    setPage(1);
    window.setTimeout(() => document.getElementById('customer-request-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const saveStatus = async (status: string, note = statusNote) => {
    if (!selected || !status || status === selected.status) return;
    setSaving(true);
    try {
      const updated = await updateCustomerRequestStatus(selected, {
        status,
        notes: note,
        purchasing_notes: ['purchasing_review', 'searching_suppliers', 'sourcing', 'available', 'arrived'].includes(status) ? note : undefined,
        contact_summary: ['customer_contacted', 'delivered', 'closed'].includes(status) ? note : undefined,
        customer_confirmation_status: status === 'customer_confirmed' ? 'confirmed' : undefined,
        user_id: user?.id,
        user_name: user?.name,
      });
      setStatusNote('');
      setSelected(updated);
      toast.success(`تم: ${requestStatusLabel(status)}`);
      await load();
    } catch (error) {
      toast.error(`تعذر تحديث الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const moveToShortage = async () => {
    if (!selected || !window.confirm('سيتم ربط الطلب بالنواقص مع الاحتفاظ ببيانات العميل والتتبع. متابعة؟')) return;
    setSaving(true);
    try {
      const result = await moveCustomerRequestToShortage(selected, { user_id: user?.id, user_name: user?.name });
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
    window.open(generateWhatsAppLink(selected.customer_phone, `أهلاً ${selected.customer_name || 'حضرتك'}، مع حضرتك صيدليات دواء بخصوص طلب صنف ${selected.medicine_name}.`), '_blank', 'noopener,noreferrer');
  };

  const clearFilters = () => {
    setSearch(''); setBranchFilter('all'); setStatusFilter('all'); setUrgencyFilter('all'); setSourceFilter('all'); setChannelFilter('all'); setAssigneeFilter('all'); setDateFrom(''); setDateTo(''); setQuickFilter('all'); clearRequestContext(); setPage(1);
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const all: CustomerRequest[] = [];
      let exportPage = 1;
      let pages = 1;
      do {
        const result = await getCustomerRequestsPage({ page: exportPage, pageSize: 100, status: statusFilter, branch: branchFilter, urgency: urgencyFilter, sourceSystem: sourceFilter, sourceChannel: channelFilter, assignee: assigneeFilter, dateFrom, dateTo, search, quickFilter, requestId: contextRequestId, customerId: contextCustomerId, customerCode: contextCustomerCode, customerPhone: contextCustomerPhone, productCode: contextProductCode, medicineName: contextMedicineName, registrar: registrarFilter });
        all.push(...result.rows); pages = result.pages; exportPage += 1;
      } while (exportPage <= pages);
      await exportToExcel(all.map((request, index) => ({
        م: index + 1,
        الصنف: request.medicine_name,
        الكمية: Number(request.quantity || 1),
        العميل: request.customer_name || '',
        'كود العميل': request.customer_code || '',
        الهاتف: request.customer_phone || '',
        'نوع الطلب': requestTypeLabel(request),
        'أهمية العميل': customerImportanceLabel(request),
        القناة: requestChannelLabel(request),
        الفرع: request.branch || '',
        المسجل: registrarName(request),
        'وقت التسجيل': exactRequestTime(request),
        الحالة: requestStatusLabel(request.status),
        'المسئول الحالي': currentOwner(request),
        'عمر الطلب': ageLabel(request),
        متأخر: customerRequestIsOverdue(request) ? 'نعم' : 'لا',
        الملاحظات: request.purchasing_notes || request.doctor_notes || request.contact_summary || request.source_notes || '',
      })), `طلبات_العملاء_${new Date().toISOString().slice(0, 10)}`, 'طلبات العملاء');
      toast.success(`تم تصدير ${all.length} طلبًا`);
    } catch (error) {
      toast.error(`تعذر تصدير التقرير: ${(error as Error).message}`);
    } finally { setExporting(false); }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-1 pb-10" dir="rtl">
      <CommandHeader summary={summary} onCreate={() => setShowCreate(true)} onRefresh={load} loading={loading} onKpi={(filter) => { setWorkspaceTab('requests'); setQuickFilter(filter); setStatusFilter('all'); }} />
      <CustomerRequestsWorkspaceTabs value={workspaceTab} onChange={(tab) => {
        setWorkspaceTab(tab);
        setPage(1);
        setShowAdvancedFilters(false);
        if (tab === 'requests') { setQuickFilter('attention'); setStatusFilter('all'); }
        if (tab === 'followup') { setQuickFilter('all'); setStatusFilter('searching_suppliers'); }
        if (tab === 'archive') { setQuickFilter('all'); setStatusFilter('delivered'); }
      }} summary={summary} />

      {workspaceTab === 'overview' && <>
        <CustomerRequestsOverview summary={summary} onOpenQueue={(filter) => { setWorkspaceTab('requests'); setQuickFilter(filter); setStatusFilter('all'); }} />
        <CustomerRequestCriticalToday branch={branchFilter} onOpenRequest={(request) => openDetails(request)} />
      </>}
      {workspaceTab === 'analytics' && <CustomerRequestInsightsPanel branch={branchFilter} onAction={applyAnalyticsAction} />}
      {workspaceTab === 'quality' && <CustomerRequestQualityCenter branch={branchFilter} onOpenRequest={(request) => openDetails(request)} />}

      {showCreate && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm md:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}>
          <section className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-cyan-400/30 bg-[#071526] shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-700 bg-[#0b1f36]/95 px-4 py-4 backdrop-blur md:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xl font-black text-white"><PackagePlus size={21} className="text-cyan-300" /> تسجيل طلب عميل جديد</div>
                <p className="mt-1 text-xs font-bold text-slate-400">سجّل العميل والصنف والأولوية والتفاصيل في خطوة واحدة، ثم يبدأ الطلب مباشرة في دورة المتابعة.</p>
              </div>
              <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-600 bg-slate-900 text-slate-300 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200" onClick={() => setShowCreate(false)} aria-label="إغلاق نافذة تسجيل الطلب"><X size={19} /></button>
            </header>
            <div className="overflow-y-auto p-3 md:p-5">
              <CreateRequestPanel doctors={doctors} user={user} onCancel={() => setShowCreate(false)} onCreated={async (request) => { setShowCreate(false); setSelected(request); setWorkspaceTab('requests'); setQuickFilter('today'); setStatusFilter('all'); setPage(1); setShowDetails(true); toast.success('تم تسجيل طلب العميل وفتح تفاصيله'); await load(); }} />
            </div>
          </section>
        </div>
      )}

      {workspaceTab !== 'overview' && workspaceTab !== 'analytics' && workspaceTab !== 'quality' && (
        <div className="space-y-4">
          {workspaceTab === 'requests' && <QuickQueues value={quickFilter} onChange={setQuickFilter} summary={summary} />}

          {workspaceTab === 'followup' && <>
            <CustomerRequestsStageTabs
              value={statusFilter}
              onChange={(status) => { setQuickFilter('all'); setStatusFilter(status); setPage(1); }}
              items={[['searching_suppliers', 'جاري البحث'], ['sourcing', 'جاري التوفير'], ['available', 'تم التوفير'], ['customer_contacted', 'تم التواصل']]}
            />
            <CustomerRequestWarehousePanel branch={branchFilter} />
          </>}

          {workspaceTab === 'archive' && (
            <CustomerRequestsStageTabs
              value={statusFilter}
              onChange={(status) => { setQuickFilter('all'); setStatusFilter(status); setPage(1); }}
              items={[['delivered', 'تم التسليم'], ['closed', 'مغلق'], ['cancelled', 'ملغي'], ['not_available', 'غير متوفر']]}
            />
          )}

          {(contextCustomerCode || contextCustomerPhone || contextCustomerName || contextProductCode || contextMedicineName || registrarFilter || contextRequestId) && (
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/[0.08] p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-black text-cyan-200">عرض مرتبط بالسياق — الفلتر دقيق وليس بحثًا عامًا</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                    {(contextCustomerName || contextCustomerCode || contextCustomerPhone) && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">العميل: {contextCustomerName || '—'}{contextCustomerCode ? ` · كود ${contextCustomerCode}` : ''}{contextCustomerPhone ? ` · ${contextCustomerPhone}` : ''}</span>}
                    {(contextMedicineName || contextProductCode) && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">الصنف: {contextMedicineName || '—'}{contextProductCode ? ` · كود ${contextProductCode}` : ''}</span>}
                    {registrarFilter && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">مسجل الطلبات: {registrarFilter}</span>}
                    {branchFilter !== 'all' && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">الفرع: {branchFilter}</span>}
                  </div>
                </div>
                <button type="button" onClick={() => { clearRequestContext(); setSearch(''); setQuickFilter('all'); setStatusFilter('all'); setPage(1); }} className="h-9 shrink-0 rounded-xl border border-cyan-400/25 bg-slate-950 px-3 text-xs font-black text-cyan-100 hover:bg-slate-900">إلغاء سياق العميل/الصنف</button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input className="input-dark h-10 w-full pr-9 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث سريع: العميل، الكود، الهاتف أو الصنف..." />
              </div>
              <select className="input-dark h-10 min-w-40 text-sm" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                <option value="all">كل الفروع</option>
                <option value="دواء شكري">دواء شكري</option>
                <option value="دواء الشامي">دواء الشامي</option>
              </select>
              <button type="button" className={`h-10 rounded-xl border px-4 text-sm font-bold transition ${showAdvancedFilters ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'}`} onClick={() => setShowAdvancedFilters((value) => !value)}>
                {showAdvancedFilters ? 'إخفاء الفلاتر' : 'فلاتر متقدمة'}
              </button>
              {(search || branchFilter !== 'all' || statusFilter !== 'all' || urgencyFilter !== 'all' || sourceFilter !== 'all' || channelFilter !== 'all' || assigneeFilter !== 'all' || registrarFilter || contextCustomerCode || contextCustomerPhone || contextProductCode || contextMedicineName || contextRequestId || dateFrom || dateTo) && (
                <button type="button" className="h-10 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-400 hover:text-white" onClick={clearFilters}>مسح</button>
              )}
            </div>
            {showAdvancedFilters && <div className="mt-3 border-t border-slate-800 pt-3">
              <Filters search={search} setSearch={setSearch} branch={branchFilter} setBranch={setBranchFilter} status={statusFilter} setStatus={setStatusFilter} urgency={urgencyFilter} setUrgency={setUrgencyFilter} source={sourceFilter} setSource={setSourceFilter} channel={channelFilter} setChannel={setChannelFilter} assignee={assigneeFilter} setAssignee={setAssigneeFilter} assignees={assignees} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} onClear={clearFilters} />
            </div>}
          </div>


          <section id="customer-request-list" className="scroll-mt-24 rounded-3xl border border-slate-700 bg-slate-950/45 p-4 shadow-xl">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-lg font-black text-white">طلبات العملاء — قائمة التنفيذ</div>
                <div className="mt-1 text-xs text-slate-400">{totalRows.toLocaleString('ar-EG')} طلب مطابق · العرض الافتراضي كروت كبيرة لسهولة المتابعة</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-secondary flex items-center gap-2 px-3 py-2 text-xs" onClick={() => void exportReport()} disabled={exporting}>{exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Excel</button>
                <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
                  <button type="button" aria-label="عرض كبطاقات" className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold ${viewMode === 'cards' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'}`} onClick={() => setViewMode('cards')}><LayoutGrid size={16} /> كروت</button>
                  <button type="button" aria-label="عرض كجدول" className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold ${viewMode === 'table' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'}`} onClick={() => setViewMode('table')}><List size={16} /> جدول</button>
                </div>
                <select className="input-dark w-auto min-w-24 text-xs" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={30}>30</option><option value={50}>50</option></select>
              </div>
            </div>

            {loading ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-3xl bg-slate-800/80" />)}</div>
              : requests.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-400">لا توجد طلبات مطابقة.</div>
              : viewMode === 'table' ? <RequestTable requests={requests} page={page} pageSize={pageSize} onSelect={openDetails} />
              : <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{requests.map((request) => <RequestCard key={request.id} request={request as RequestWithProduct} onSelect={() => openDetails(request)} />)}</div>}
            <Pagination page={page} pages={totalPages} onPage={setPage} />
          </section>
        </div>
      )}

      {showDetails && selected && (
        <div className="fixed inset-0 z-[100] flex items-stretch justify-end bg-slate-950/75 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDetails(false); }}>
          <aside className="h-full w-full max-w-5xl overflow-y-auto border-r border-slate-700 bg-[#071526] p-4 shadow-2xl md:p-6">
            <div className="sticky top-0 z-30 mb-4 flex items-center justify-between rounded-2xl border border-slate-700 bg-[#0b1f36]/95 p-3 backdrop-blur">
              <div className="flex items-center gap-2 font-black text-white"><Eye size={19} className="text-cyan-300" /> كل تفاصيل الطلب</div>
              <button type="button" className="rounded-xl border border-slate-600 bg-slate-900 p-2 text-slate-300 hover:text-white" onClick={() => setShowDetails(false)} aria-label="إغلاق"><X size={18} /></button>
            </div>
            <CustomerRequestDataQualityPanel
              request={selected as RequestWithProduct}
              onUpdated={(updated) => {
                setSelected(updated);
                setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
                void load();
              }}
            />
            <RequestDetail request={selected as RequestWithProduct} events={events} newStatus={newStatus} setNewStatus={setNewStatus} note={statusNote} setNote={setStatusNote} saving={saving} onStatus={() => void saveStatus(newStatus)} onQuickStatus={(status, note) => void saveStatus(status, note ?? '')} onWhatsApp={openWhatsApp} onShortage={moveToShortage} user={user} />
          </aside>
        </div>
      )}
    </div>
  );
}


type CustomerRequestsWorkspaceTab = 'overview' | 'requests' | 'followup' | 'analytics' | 'quality' | 'archive';

function CustomerRequestsWorkspaceTabs({ value, onChange, summary }: { value: CustomerRequestsWorkspaceTab; onChange: (value: CustomerRequestsWorkspaceTab) => void; summary: CustomerRequestCommandSummary }) {
  const tabs: Array<{ id: CustomerRequestsWorkspaceTab; label: string; hint: string; badge?: number }> = [
    { id: 'overview', label: 'لوحة اليوم', hint: 'المهم الآن', badge: summary.open },
    { id: 'requests', label: 'الطلبات', hint: 'التنفيذ اليومي', badge: summary.today },
    { id: 'followup', label: 'المتابعة', hint: 'التوفير + ملف المخازن', badge: summary.searching + summary.waiting_customer + summary.ready },
    { id: 'analytics', label: 'التحليلات', hint: 'الأداء والفروع' },
    { id: 'quality', label: 'مشاكل البيانات', hint: 'الأكواد والربط', badge: summary.unlinked_customer + summary.no_branch + summary.invalid_phone + summary.sync_conflicts },
    { id: 'archive', label: 'الأرشيف', hint: 'المكتمل والملغي', badge: summary.delivered + summary.cancelled },
  ];
  return <nav className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/55 p-1.5 shadow-lg">
    <div className="grid min-w-[900px] grid-cols-6 gap-1.5">
      {tabs.map((tab) => <button key={tab.id} type="button" onClick={() => onChange(tab.id)} className={`relative h-[58px] rounded-xl border px-3 text-right transition ${value === tab.id ? 'border-cyan-400/40 bg-cyan-500/15 text-white shadow-sm' : 'border-transparent text-slate-400 hover:bg-slate-900/80 hover:text-slate-200'}`}>
        <span className="block text-sm font-black">{tab.label}</span><span className="mt-0.5 block text-[10px] text-slate-500">{tab.hint}</span>
        {typeof tab.badge === 'number' && <span className={`absolute left-2 top-2 min-w-6 rounded-full px-1.5 py-0.5 text-center text-[10px] font-black ${value === tab.id ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>{tab.badge.toLocaleString('ar-EG')}</span>}
      </button>)}
    </div>
  </nav>;
}

function CustomerRequestsOverview({ summary, onOpenQueue }: { summary: CustomerRequestCommandSummary; onOpenQueue: (filter: CustomerRequestQuickFilter) => void }) {
  const cards: Array<{ label: string; value: number; hint: string; filter: CustomerRequestQuickFilter; tone: string }> = [
    { label: 'يحتاج تدخل', value: summary.open, hint: 'كل الطلبات المفتوحة', filter: 'attention', tone: 'border-amber-400/25 bg-amber-500/10 text-amber-200' },
    { label: 'عاجل', value: summary.urgent, hint: 'أولوية قصوى', filter: 'urgent', tone: 'border-red-400/25 bg-red-500/10 text-red-200' },
    { label: 'متأخر', value: summary.overdue, hint: 'تجاوز وقت المرحلة', filter: 'overdue', tone: 'border-orange-400/25 bg-orange-500/10 text-orange-200' },
    { label: 'بدون مسئول', value: summary.unassigned, hint: 'تحتاج إسناد', filter: 'unassigned', tone: 'border-violet-400/25 bg-violet-500/10 text-violet-200' },
  ];
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map((card) => <button key={card.label} type="button" onClick={() => onOpenQueue(card.filter)} className={`rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 ${card.tone}`}><div className="text-3xl font-black">{card.value.toLocaleString('ar-EG')}</div><div className="mt-1 text-sm font-black">{card.label}</div><div className="mt-1 text-[11px] opacity-70">{card.hint}</div></button>)}</div>
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4"><div className="text-xs text-slate-500">نسبة التنفيذ</div><div className="mt-2 text-3xl font-black text-emerald-300">{summary.fulfillment_rate.toLocaleString('ar-EG')}%</div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: Math.min(summary.fulfillment_rate, 100) + '%' }} /></div></div>
      <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4"><div className="text-xs text-slate-500">متوسط وقت التوفير</div><div className="mt-2 text-3xl font-black text-cyan-200">{Number(summary.avg_fulfillment_hours || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} س</div><div className="mt-1 text-xs text-slate-500">من التسجيل حتى الإتمام</div></div>
      <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4"><div className="text-xs text-slate-500">جودة البيانات</div><div className="mt-2 flex gap-3"><span><b className="text-xl text-white">{summary.unlinked_customer}</b><small className="block text-[10px] text-slate-500">غير مربوط</small></span><span><b className="text-xl text-white">{summary.no_branch}</b><small className="block text-[10px] text-slate-500">بدون فرع</small></span><span><b className="text-xl text-white">{summary.sync_conflicts}</b><small className="block text-[10px] text-slate-500">تعارض مزامنة</small></span></div></div>
    </div>
  </div>;
}

function CustomerRequestsStageTabs({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: Array<[string, string]> }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/45 p-1.5"><div className="flex min-w-max gap-1.5">{items.map(([id, label]) => <button key={id} type="button" onClick={() => onChange(id)} className={`h-10 rounded-xl px-4 text-xs font-black transition ${value === id ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/30' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>{label}</button>)}</div></div>;
}

function CommandHeader({ summary, onCreate, onRefresh, loading, onKpi }: { summary: CustomerRequestCommandSummary; onCreate: () => void; onRefresh: () => void; loading: boolean; onKpi: (filter: CustomerRequestQuickFilter) => void }) {
  const kpis = [
    { label: 'إجمالي الطلبات', value: summary.total, icon: Database, tone: 'text-cyan-200', filter: 'all' as CustomerRequestQuickFilter },
    { label: 'مفتوحة', value: summary.open, icon: PackageSearch, tone: 'text-amber-200', filter: 'attention' as CustomerRequestQuickFilter },
    { label: 'عاجلة', value: summary.urgent, icon: AlertTriangle, tone: 'text-red-300', filter: 'urgent' as CustomerRequestQuickFilter },
    { label: 'متأخرة', value: summary.overdue, icon: Clock3, tone: 'text-red-300', filter: 'overdue' as CustomerRequestQuickFilter },
    { label: 'جاهزة', value: summary.ready, icon: PackageCheck, tone: 'text-emerald-300', filter: 'attention' as CustomerRequestQuickFilter },
    { label: 'تم التسليم', value: summary.delivered, icon: CheckCircle2, tone: 'text-green-300', filter: 'all' as CustomerRequestQuickFilter },
  ];
  return <>
    <section className="overflow-hidden rounded-3xl border border-cyan-400/25 bg-gradient-to-l from-[#113656] via-[#102640] to-[#071526] p-5 shadow-2xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center"><div className="flex-1"><div className="flex items-center gap-2 text-2xl font-black text-white"><Sparkles className="text-cyan-300" size={24} /> مركز طلبات العملاء الذكي</div><p className="mt-2 max-w-4xl text-sm font-semibold leading-7 text-slate-300">متابعة الطلب من التسجيل حتى التوفير والتواصل والتسليم، مع تحليلات تشغيلية قابلة للضغط والفلترة.</p><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-emerald-200">نسبة التوفير {summary.fulfillment_rate}%</span><span className="rounded-full bg-cyan-500/15 px-3 py-1.5 text-cyan-200">متوسط الدورة {summary.avg_fulfillment_hours} ساعة</span><span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-amber-200">{summary.overdue} متأخر</span></div></div><div className="flex flex-wrap gap-2"><button className="btn-primary flex items-center gap-2" onClick={onCreate}><Plus size={16} /> تسجيل طلب جديد</button><button className="btn-secondary flex items-center gap-2" onClick={onRefresh} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button></div></div>
    </section>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{kpis.map(({ label, value, icon: Icon, tone, filter }) => <button type="button" onClick={() => onKpi(filter)} key={label} className="min-h-28 rounded-2xl border border-slate-700 bg-[#102640] p-5 text-right shadow-lg transition hover:-translate-y-0.5 hover:border-cyan-400/60"><div className="flex items-center justify-between gap-2"><Icon size={23} className={tone} /><span className={`num text-3xl font-black ${tone}`}>{value.toLocaleString('ar-EG')}</span></div><div className="mt-3 text-sm font-black text-slate-200">{label}</div></button>)}</div>
  </>;
}

function QuickQueues({ value, onChange, summary }: { value: CustomerRequestQuickFilter; onChange: (value: CustomerRequestQuickFilter) => void; summary: CustomerRequestCommandSummary }) {
  const counts: Partial<Record<CustomerRequestQuickFilter, number>> = { today: summary.today, urgent: summary.urgent, overdue: summary.overdue, unassigned: summary.unassigned, unlinked: summary.unlinked_customer, all: summary.total };
  return <section className="rounded-3xl border border-slate-700 bg-[#102640] p-4 shadow-lg"><div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><BarChart3 size={18} className="text-cyan-300" /> قوائم العمل الذكية</div><div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">{QUICK_FILTERS.map((item) => <button key={item.value} type="button" onClick={() => onChange(item.value)} className={`rounded-2xl border p-3 text-right transition ${value === item.value ? 'border-cyan-300 bg-cyan-500/15 shadow-lg' : 'border-slate-700 bg-slate-900/60 hover:border-cyan-400/50'}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-white">{item.label}</span>{counts[item.value] !== undefined && <span className="num text-xs font-black text-cyan-200">{counts[item.value]}</span>}</div><div className="mt-1 text-[11px] leading-5 text-slate-400">{item.description}</div></button>)}</div></section>;
}

function Filters(props: { search: string; setSearch: (v: string) => void; branch: string; setBranch: (v: string) => void; status: string; setStatus: (v: string) => void; urgency: string; setUrgency: (v: string) => void; source: string; setSource: (v: string) => void; channel: string; setChannel: (v: string) => void; assignee: string; setAssignee: (v: string) => void; assignees: string[]; dateFrom: string; setDateFrom: (v: string) => void; dateTo: string; setDateTo: (v: string) => void; onClear: () => void }) {
  return <section className="rounded-3xl border border-slate-700 bg-[#102640] p-4 shadow-lg"><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7"><div className="relative md:col-span-2 xl:col-span-2"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input className="input-dark pl-9" placeholder="عميل، كود، هاتف، صنف أو كود صنف..." value={props.search} onChange={(e) => props.setSearch(e.target.value)} /></div><select className="input-dark" value={props.branch} onChange={(e) => props.setBranch(e.target.value)}><option value="all">كل الفروع</option><option value="دواء شكري">دواء شكري</option><option value="دواء الشامي">دواء الشامي</option></select><select className="input-dark" value={props.status} onChange={(e) => props.setStatus(e.target.value)}><option value="all">كل الحالات</option>{REQUEST_STATUS_FLOW.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select className="input-dark" value={props.urgency} onChange={(e) => props.setUrgency(e.target.value)}><option value="all">كل الأولويات</option><option value="urgent">عاجل/مهم</option><option value="normal">عادي</option></select><select className="input-dark" value={props.source} onChange={(e) => props.setSource(e.target.value)}><option value="all">كل المصادر</option><option value="dawaawael">dawaawael</option><option value="manual">تسجيل الإدارة</option></select><select className="input-dark" value={props.channel} onChange={(e) => props.setChannel(e.target.value)}><option value="all">كل القنوات</option><option value="واتساب">واتساب</option><option value="داخل الصيدلية">داخل الصيدلية</option><option value="مكالمة هاتفية">مكالمة هاتفية</option></select><select className="input-dark xl:col-span-2" value={props.assignee} onChange={(e) => props.setAssignee(e.target.value)}><option value="all">كل المسئولين</option><option value="unassigned">بدون مسئول</option>{props.assignees.map((name) => <option key={name} value={name}>{name}</option>)}</select><label className="text-xs font-bold text-slate-400">من تاريخ<input type="date" className="input-dark mt-1" value={props.dateFrom} onChange={(e) => props.setDateFrom(e.target.value)} /></label><label className="text-xs font-bold text-slate-400">إلى تاريخ<input type="date" className="input-dark mt-1" value={props.dateTo} onChange={(e) => props.setDateTo(e.target.value)} /></label><button type="button" className="btn-secondary flex items-center justify-center gap-2 self-end" onClick={props.onClear}><XCircle size={16} /> مسح الفلاتر</button></div></section>;
}

function RequestCard({ request, onSelect }: { request: RequestWithProduct; onSelect: () => void }) {
  const issues = customerRequestQualityIssues(request);
  const overdue = customerRequestIsOverdue(request);
  const importance = importanceLabel(request);
  const notes = request.purchasing_notes || request.doctor_notes || request.contact_summary || request.source_notes || 'لا توجد ملاحظات';
  return <article className={`relative min-h-[310px] rounded-3xl border p-5 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl ${overdue ? 'border-red-400/35 bg-red-500/[0.05]' : 'border-slate-700 bg-[#102640]'}`}>
    <div className="flex items-start gap-4"><div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${importance.label === 'عاجل' ? 'bg-red-500/15 text-red-300' : 'bg-cyan-500/15 text-cyan-300'}`}><PackageSearch size={24} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black leading-7 text-white">{request.medicine_name}</h3><div className="mt-1 text-xs text-slate-400">الكمية <strong className="num text-slate-200">{request.quantity || 1}</strong>{request.product_code ? ` · كود الصنف ${request.product_code}` : ''}</div></div><span className={overdue ? 'badge-warning' : customerRequestIsClosed(request) ? 'badge-success' : 'badge-info'}>{requestStatusLabel(request.status)}</span></div></div></div>
    <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold"><span className={`rounded-xl border px-3 py-1.5 ${importance.className}`}>{importance.label}</span><span className="rounded-xl bg-slate-800 px-3 py-1.5 text-slate-200">{requestTypeLabel(request)}</span><span className="rounded-xl bg-slate-800 px-3 py-1.5 text-cyan-200">{request.branch || 'بدون فرع'}</span><span className="rounded-xl bg-slate-800 px-3 py-1.5 text-violet-200">{requestChannelLabel(request)}</span>{overdue && <span className="rounded-xl bg-red-500/15 px-3 py-1.5 text-red-200">متأخر</span>}</div>
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"><CardField label="العميل" value={request.customer_name || 'غير محدد'} /><CardField label="كود العميل" value={request.customer_code || '—'} /><CardField label="الهاتف" value={displayEgyptianPhone(request.customer_phone || '') || 'بدون هاتف'} /><CardField label="أهمية العميل" value={customerImportanceLabel(request)} /><CardField label="المسجل" value={registrarName(request)} /><CardField label="المسئول الحالي" value={currentOwner(request)} /><CardField label="وقت التسجيل" value={exactRequestTime(request)} /><CardField label="عمر الطلب" value={ageLabel(request)} /></div>
    <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black ${overdue ? 'border-red-400/25 bg-red-500/10 text-red-100' : 'border-cyan-400/20 bg-cyan-500/[0.07] text-cyan-100'}`}>الخطوة التالية: {nextAction(request)}</div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-l from-cyan-400 to-emerald-400" style={{ width: `${progressValue(request.status)}%` }} /></div>
    <div className="mt-4 flex items-end justify-between gap-4"><div className="min-w-0 flex-1"><div className="text-[10px] font-bold text-slate-500">آخر ملاحظة</div><div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{notes}</div>{issues.length > 0 && <div className="mt-2 text-[10px] font-bold text-amber-300">مراجعة بيانات: {issues.join(' · ')}</div>}</div><button type="button" onClick={onSelect} className="flex shrink-0 items-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-500/15 px-4 py-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-500/25"><Eye size={18} /> عرض كل التفاصيل</button></div>
  </article>;
}

function CardField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-slate-900/55 px-3 py-2"><div className="text-[10px] font-bold text-slate-500">{label}</div><div className="mt-1 truncate text-xs font-black text-slate-100" title={value}>{value}</div></div>;
}

function RequestTable({ requests, page, pageSize, onSelect }: { requests: CustomerRequest[]; page: number; pageSize: number; onSelect: (request: CustomerRequest) => void }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-700"><table className="min-w-[1500px] w-full text-right text-xs"><thead className="sticky top-0 z-10 bg-[#0c1d32] text-slate-300"><tr>{['م','الصنف','العميل','الهاتف','الفرع','المسئول','التسجيل','العمر','الحالة','الإجراء'].map((title) => <th key={title} className="whitespace-nowrap border-b border-slate-700 px-3 py-4 font-black">{title}</th>)}</tr></thead><tbody>{requests.map((request, index) => <tr key={request.id} className="border-b border-slate-800 align-middle hover:bg-cyan-500/[0.08]"><td className="px-3 py-3 num font-black text-cyan-200">{(page - 1) * pageSize + index + 1}</td><td className="px-3 py-3 font-black text-white">{request.medicine_name}<div className="mt-1 text-[10px] text-slate-500">كمية {request.quantity || 1}</div></td><td className="px-3 py-3 text-white">{request.customer_name || 'غير محدد'}<div className="mt-1 text-[10px] text-slate-500">{request.customer_code || '—'}</div></td><td className="px-3 py-3">{displayEgyptianPhone(request.customer_phone || '') || '—'}</td><td className="px-3 py-3">{request.branch || '—'}</td><td className="px-3 py-3">{currentOwner(request)}</td><td className="px-3 py-3 whitespace-nowrap">{exactRequestTime(request)}</td><td className={`px-3 py-3 font-black ${customerRequestIsOverdue(request) ? 'text-red-300' : 'text-slate-300'}`}>{ageLabel(request)}</td><td className="px-3 py-3"><span className={customerRequestIsOverdue(request) ? 'badge-warning' : customerRequestIsClosed(request) ? 'badge-success' : 'badge-info'}>{requestStatusLabel(request.status)}</span></td><td className="px-3 py-3"><button type="button" onClick={() => onSelect(request)} className="flex items-center gap-1 rounded-xl bg-cyan-500/15 px-3 py-2 font-black text-cyan-100"><Eye size={15} /> التفاصيل</button></td></tr>)}</tbody></table></div>;
}

function RequestDetail(props: { request: RequestWithProduct; events: CustomerRequestEvent[]; newStatus: string; setNewStatus: (v: string) => void; note: string; setNote: (v: string) => void; saving: boolean; onStatus: () => void; onQuickStatus: (status: string, note?: string) => void; onWhatsApp: () => void; onShortage: () => void; user: { id?: string; name?: string } | null }) {
  const request = props.request;
  const issues = customerRequestQualityIssues(request);
  const importance = importanceLabel(request);
  const [cancelReason, setCancelReason] = useState('');
  return <div className="space-y-4">
    <div className="rounded-3xl border border-cyan-500/25 bg-[#102640] p-5 shadow-xl"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-black text-white">{request.medicine_name}</h2><span className="badge-info">{requestStatusLabel(request.status)}</span>{customerRequestIsOverdue(request) && <span className="badge-warning">متأخر</span>}</div><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold"><span className={`rounded-lg border px-2 py-1 ${importance.className}`}>{importance.label}</span><span className="rounded-lg bg-slate-800 px-2 py-1 text-cyan-100">تم التسجيل: {exactRequestTime(request)}</span><span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-100">المسجل: {registrarName(request)}</span>{request.product_code && <span className="rounded-lg bg-emerald-500/15 px-2 py-1 text-emerald-200">كود الصنف: {request.product_code}</span>}</div><div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.07] p-3 text-sm font-black text-cyan-100">الخطوة التالية المقترحة: {nextAction(request)}</div></div><div className="flex flex-wrap gap-2"><button className="btn-secondary flex items-center gap-2" onClick={props.onWhatsApp}><MessageCircle size={16} /> واتساب</button><button className="btn-secondary flex items-center gap-2" onClick={props.onShortage} disabled={props.saving || !!request.shortage_item_id}><ShoppingCart size={16} /> {request.shortage_item_id ? 'مربوط بالنواقص' : 'إلى النواقص'}</button>{request.customer_id && <Link className="btn-secondary flex items-center gap-2" to={`/customers/${request.customer_id}`}><UsersRound size={16} /> ملف العميل</Link>}</div></div></div>

    {issues.length > 0 && <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4"><div className="flex items-center gap-2 font-black text-amber-200"><AlertTriangle size={17} /> مراجعة جودة البيانات</div><div className="mt-2 flex flex-wrap gap-2">{issues.map((issue) => <span key={issue} className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-100">{issue}</span>)}</div></div>}

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><InfoCard title="العميل والطلب" icon={UsersRound}><Line label="العميل" value={request.customer_name || 'غير محدد'} /><Line label="كود العميل" value={request.customer_code || 'غير محدد'} /><Line label="الهاتف" value={displayEgyptianPhone(request.customer_phone || '') || 'غير محدد'} /><Line label="أهمية العميل" value={customerImportanceLabel(request)} /><Line label="الفرع" value={request.branch || 'غير محدد'} /><Line label="القناة" value={requestChannelLabel(request)} /><Line label="نوع الطلب" value={requestTypeLabel(request)} /><Line label="الكمية" value={String(request.quantity || 1)} /><Line label="مطلوب قبل" value={request.needed_by_date ? formatDate(request.needed_by_date) : 'غير محدد'} /></InfoCard><InfoCard title="المشتريات والتوفير" icon={Truck}><Line label="المسئول الحالي" value={currentOwner(request)} /><Line label="بدأ البحث بواسطة" value={request.searching_by_name || 'غير محدد'} /><Line label="تم التوفير بواسطة" value={request.provided_by_name || 'غير محدد'} /><Line label="المورد/المصدر" value={request.supplier_hint || request.potential_source_text || 'غير محدد'} /><Line label="موعد الوصول" value={request.expected_arrival_date ? formatDate(request.expected_arrival_date) : 'غير محدد'} /><Line label="ملاحظات المشتريات" value={request.purchasing_notes || request.supplier_notes || 'لا يوجد'} /></InfoCard><InfoCard title="التواصل والنتيجة" icon={Phone}><Line label="تم التواصل بواسطة" value={request.customer_contacted_by_name || 'غير محدد'} /><Line label="ملخص التواصل" value={request.contact_summary || 'لا يوجد'} /><Line label="تأكيد العميل" value={request.customer_confirmation_status || 'غير محدد'} /><Line label="تم التسليم بواسطة" value={request.delivered_by_name || 'غير محدد'} /><Line label="ملاحظات التسجيل" value={request.doctor_notes || request.source_notes || 'لا يوجد'} /></InfoCard><InfoCard title="تحديث الحالة" icon={RefreshCw}><div className="grid grid-cols-2 gap-2">{QUICK_ACTIONS.map(({ status, label, icon: Icon }) => <button key={status} type="button" disabled={props.saving || request.status === status} onClick={() => props.onQuickStatus(status)} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-xs font-black text-slate-100 hover:border-cyan-400/50 disabled:opacity-40"><Icon size={15} className="mx-auto mb-1 text-cyan-300" />{label}</button>)}</div><select className="input-dark mt-3" value={props.newStatus} onChange={(e) => props.setNewStatus(e.target.value)}>{REQUEST_STATUS_FLOW.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select><textarea className="input-dark mt-3 min-h-24" value={props.note} onChange={(e) => props.setNote(e.target.value)} placeholder="نتيجة البحث أو التواصل أو ملاحظة مهمة..." /><button className="btn-primary mt-3 flex w-full items-center justify-center gap-2" disabled={props.saving || props.newStatus === request.status} onClick={props.onStatus}>{props.saving && <Loader2 size={16} className="animate-spin" />} حفظ التحديث</button></InfoCard></div>

    {!customerRequestIsClosed(request) && <InfoCard title="إلغاء الطلب بسبب موثق" icon={XCircle}><div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]"><select className="input-dark" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}><option value="">اختر سبب الإلغاء</option><option value="العميل وفر الصنف من مكان آخر">العميل وفر الصنف</option><option value="العميل كان يستفسر فقط ولا يريد تنفيذ الطلب">كان يستفسر فقط</option><option value="العميل عدل رأيه ولم يعد يحتاج الصنف">العميل عدل رأيه</option><option value="تم تسجيل الطلب بالخطأ أو مكرر">طلب مسجل بالخطأ/مكرر</option><option value="تعذر التواصل مع العميل بعد المحاولات الموثقة">تعذر التواصل مع العميل</option></select><button className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 font-black text-red-200" onClick={() => cancelReason.trim() ? props.onQuickStatus('cancelled', cancelReason.trim()) : toast.error('اختر سبب الإلغاء')} disabled={props.saving}><XCircle size={16} className="inline ms-2" /> إلغاء الطلب</button></div></InfoCard>}

    <StageTimeline request={request} events={props.events} />
    <InfoCard title="سجل الحركة الكامل" icon={History}>{props.events.length === 0 ? <div className="text-sm text-slate-400">لا توجد أحداث مسجلة.</div> : <div className="space-y-3">{props.events.map((event) => <div key={event.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">{event.action || 'تحديث'}</strong><span className="text-xs text-slate-400">{event.created_at ? formatDate(event.created_at) : ''}</span></div><div className="mt-1 text-sm text-slate-300">{event.notes || 'بدون ملاحظات'}</div><div className="mt-1 text-xs text-slate-500">{event.old_status ? requestStatusLabel(event.old_status) : 'بداية'} ← {requestStatusLabel(event.new_status)} · {event.created_by_name || 'النظام'}</div></div>)}</div>}</InfoCard>
  </div>;
}

function StageTimeline({ request, events }: { request: CustomerRequest; events: CustomerRequestEvent[] }) {
  const stages = [
    { statuses: ['new'], label: 'تسجيل الطلب', actor: registrarName(request), fallback: requestTimestamp(request) },
    { statuses: ['searching_suppliers', 'sourcing'], label: 'بدأ البحث', actor: request.searching_by_name || currentOwner(request), fallback: null },
    { statuses: ['available', 'arrived'], label: 'تم التوفير', actor: request.provided_by_name || 'غير محدد', fallback: null },
    { statuses: ['customer_contacted'], label: 'تم التواصل', actor: request.customer_contacted_by_name || 'غير محدد', fallback: null },
    { statuses: ['delivered', 'closed'], label: 'تم التسليم', actor: request.delivered_by_name || 'غير محدد', fallback: request.closed_at || null },
  ];
  const eventFor = (statuses: string[]) => [...events].reverse().find((event) => statuses.includes(String(event.new_status || '')));
  return <InfoCard title="خط سير التنفيذ بالوقت والمسئول" icon={Clock3}><div className="grid grid-cols-1 gap-3 md:grid-cols-5">{stages.map((stage, index) => { const event = eventFor(stage.statuses); const time = event?.created_at || stage.fallback; const done = Boolean(time) || stage.statuses.includes(String(request.status)); return <div key={stage.label} className={`rounded-2xl border p-3 ${done ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/50'}`}><div className="flex items-center gap-2"><span className={`num flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${done ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>{index + 1}</span><strong className="text-xs text-white">{stage.label}</strong></div><div className="mt-3 text-[11px] text-slate-300">{event?.created_by_name || stage.actor}</div><div className="mt-1 text-[10px] text-slate-500">{time ? exactRequestTime({ requested_at: time } as CustomerRequest) : 'لم تتم بعد'}</div></div>; })}</div></InfoCard>;
}

function CreateRequestPanel({ doctors, user, onCreated, onCancel }: { doctors: StaffOption[]; user: { id?: string; name?: string } | null; onCreated: (request: CustomerRequest) => void | Promise<void>; onCancel: () => void }) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [image, setImage] = useState({ publicUrl: '', path: '' });
  const [quantity, setQuantity] = useState(1);
  const [urgency, setUrgency] = useState('normal');
  const [requestType, setRequestType] = useState('missing_medicine');
  const [requestChannel, setRequestChannel] = useState('داخل الصيدلية');
  const [doctorId, setDoctorId] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [supplierHint, setSupplierHint] = useState('');
  const [neededByDate, setNeededByDate] = useState('');
  const [expectedDays, setExpectedDays] = useState(1);
  const [saving, setSaving] = useState(false);
  const selectedDoctor = doctors.find((item) => item.id === doctorId);
  const resolvedBranch = selectedCustomer?.branch || selectedDoctor?.branch || '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer?.name) return toast.error('اختر العميل أولًا');
    if (!selectedProduct?.id) return toast.error('اختر الصنف بالكود أو أضف صنفًا جديدًا');
    setSaving(true);
    try {
      const created = await createCustomerRequest({ customer_id: selectedCustomer.id, customer_code: selectedCustomer.code, customer_name: selectedCustomer.name, customer_phone: selectedCustomer.phone, branch: selectedCustomer.branch || selectedDoctor?.branch || null, medicine_name: selectedProduct.name, medicine_image_url: image.publicUrl || null, item_image_url: image.publicUrl || null, item_image_path: image.path || null, quantity, urgency, request_type: requestType, source_request_channel: requestChannel, doctor_id: selectedDoctor?.id || null, doctor_name: selectedDoctor?.name || null, doctor_notes: doctorNotes || null, supplier_hint: supplierHint || null, needed_by_date: neededByDate || null, expected_fulfillment_days: expectedDays, created_by: user?.id, created_by_name: user?.name });
      await linkCustomerRequestProduct(created.id, selectedProduct.id);
      await onCreated(created);
    } catch (error) {
      toast.error(`تعذر تسجيل الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-cyan-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">1. العميل</h3><p className="mt-1 text-[11px] font-bold text-slate-500">ابحث بالاسم أو كود العميل أو الهاتف، ويمكن إنشاء عميل جديد عند الحاجة.</p></div><UsersRound size={19} className="text-cyan-300" /></div>
          <CustomerSmartSearch value={selectedCustomer} onSelect={setSelectedCustomer} placeholder="ابحث باسم العميل أو الكود أو الهاتف" disabled={saving} allowCreate />
          {selectedCustomer && <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4"><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">العميل</span><strong className="mt-1 block truncate text-white">{selectedCustomer.name}</strong></div><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">الكود</span><strong className="mt-1 block text-white">{selectedCustomer.code || '—'}</strong></div><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">الهاتف</span><strong className="mt-1 block text-white">{displayEgyptianPhone(selectedCustomer.phone || '') || '—'}</strong></div><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">الفرع</span><strong className="mt-1 block text-cyan-200">{selectedCustomer.branch || 'يُحدد من المسجل'}</strong></div></div>}
        </section>

        <section className="rounded-2xl border border-emerald-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">2. الصنف والكمية</h3><p className="mt-1 text-[11px] font-bold text-slate-500">اختيار الصنف من الكتالوج يضمن الربط الصحيح ويمنع اختلاف الأسماء.</p></div><PackageSearch size={19} className="text-emerald-300" /></div>
          <ProductSmartSearch value={selectedProduct} onSelect={setSelectedProduct} disabled={saving} />
          <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs font-black text-slate-300">الكمية<input className="input-dark mt-1" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 1))} /></label><label className="text-xs font-black text-slate-300">أولوية الطلب<select className="input-dark mt-1" value={urgency} onChange={(e) => setUrgency(e.target.value)}><option value="normal">عادي</option><option value="high">مهم</option><option value="urgent">عاجل</option></select></label><label className="text-xs font-black text-slate-300">نوع الطلب<select className="input-dark mt-1" value={requestType} onChange={(e) => setRequestType(e.target.value)}><option value="missing_medicine">صنف ناقص</option><option value="normal_request">طلب عادي</option><option value="urgent_request">طلب عاجل</option><option value="inquiry">استفسار</option></select></label></div>
        </section>

        <section className="rounded-2xl border border-violet-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">3. طريقة الطلب والمسئول</h3><p className="mt-1 text-[11px] font-bold text-slate-500">سجل قناة التواصل ومن سجّل الطلب وأي مصدر محتمل للتوفير.</p></div><UserRound size={19} className="text-violet-300" /></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><label className="text-xs font-black text-slate-300">قناة الطلب<select className="input-dark mt-1" value={requestChannel} onChange={(e) => setRequestChannel(e.target.value)}><option value="داخل الصيدلية">داخل الصيدلية</option><option value="واتساب">واتساب</option><option value="مكالمة هاتفية">مكالمة هاتفية</option></select></label><label className="text-xs font-black text-slate-300">الدكتور/الموظف المسجل<select className="input-dark mt-1" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">اختر المسجل</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} - {doctor.branch || ''}</option>)}</select></label><label className="text-xs font-black text-slate-300">مورد أو مصدر محتمل<input className="input-dark mt-1" value={supplierHint} onChange={(e) => setSupplierHint(e.target.value)} placeholder="اختياري" /></label><label className="text-xs font-black text-slate-300">مطلوب قبل<input type="date" className="input-dark mt-1" value={neededByDate} onChange={(e) => setNeededByDate(e.target.value)} /></label><label className="text-xs font-black text-slate-300">مدة التوفير المتوقعة بالأيام<input type="number" min={0} className="input-dark mt-1" value={expectedDays} onChange={(e) => setExpectedDays(Number(e.target.value || 0))} /></label><div className="rounded-xl border border-slate-700 bg-slate-950/45 p-3"><span className="block text-[10px] font-bold text-slate-500">الفرع المتوقع</span><strong className="mt-1 block text-sm text-cyan-200">{resolvedBranch || 'سيُحدد حسب العميل/المسجل'}</strong></div></div>
        </section>

        <section className="rounded-2xl border border-amber-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">4. الملاحظات والصورة</h3><p className="mt-1 text-[11px] font-bold text-slate-500">اكتب أي تفاصيل تساعد المشتريات أو خدمة العملاء على تنفيذ الطلب بدون رجوع إضافي.</p></div><MessageCircle size={19} className="text-amber-300" /></div>
          <textarea className="input-dark min-h-24" value={doctorNotes} onChange={(e) => setDoctorNotes(e.target.value)} placeholder="مثال: العميل يحتاج نفس الشركة / يقبل بديل / موعد مهم / ملاحظة عن التركيز أو الشكل..." />
          <div className="mt-3"><ImageUploadBox bucket="customer-request-images" folder="customer-requests" label="صورة الصنف أو الروشتة (اختياري)" valueUrl={image.publicUrl} valuePath={image.path} onUploaded={setImage} disabled={saving} /></div>
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-cyan-500/[0.10] to-slate-950/50 p-4 xl:sticky xl:top-0">
        <div className="flex items-center gap-2 text-sm font-black text-white"><CheckCircle2 size={18} className="text-cyan-300" /> مراجعة سريعة قبل الحفظ</div>
        <div className="mt-4 space-y-2 text-xs"><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">العميل</span><strong className="truncate text-white">{selectedCustomer?.name || 'لم يتم الاختيار'}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الصنف</span><strong className="truncate text-white">{selectedProduct?.name || 'لم يتم الاختيار'}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الكمية</span><strong className="num text-white">{quantity}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الأولوية</span><strong className={urgency === 'urgent' ? 'text-red-300' : urgency === 'high' ? 'text-amber-300' : 'text-emerald-300'}>{urgency === 'urgent' ? 'عاجل' : urgency === 'high' ? 'مهم' : 'عادي'}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">القناة</span><strong className="text-white">{requestChannel}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الفرع</span><strong className="text-cyan-200">{resolvedBranch || '—'}</strong></div></div>
        <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.07] p-3 text-[11px] font-bold leading-6 text-cyan-100">بعد الحفظ هيتفتح الطلب الجديد مباشرة في شاشة التفاصيل، ويبدأ بحالة تسجيل جديدة داخل دورة المتابعة.</div>
      </aside>
    </div>

    <footer className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 rounded-2xl border border-slate-700 bg-[#0b1f36]/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <button type="button" className="btn-secondary min-w-28" onClick={onCancel} disabled={saving}>إلغاء</button>
      <div className="flex flex-col gap-2 sm:flex-row"><span className="self-center text-[11px] font-bold text-slate-500">يلزم اختيار العميل والصنف قبل الحفظ</span><button className="btn-primary flex min-w-44 items-center justify-center gap-2" disabled={saving || !selectedCustomer?.name || !selectedProduct?.id}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ وفتح الطلب</button></div>
    </footer>
  </form>;
}

function InfoCard({ title, icon: Icon, children }: { title: string; icon: typeof History; children: React.ReactNode }) {
  return <div className="rounded-3xl border border-slate-700 bg-[#102640] p-5 shadow-lg"><div className="mb-4 flex items-center gap-2 font-black text-white"><Icon size={18} className="text-cyan-300" />{title}</div><div className="space-y-3">{children}</div></div>;
}
function Line({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 border-b border-slate-700/60 pb-2 text-sm last:border-0"><span className="shrink-0 text-slate-400">{label}</span><span className="break-words text-left font-semibold text-slate-100">{value}</span></div>; }
function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) { if (pages <= 1) return null; return <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-700 pt-3"><button className="btn-secondary flex items-center gap-1 px-3 py-2 text-xs" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}><ArrowRight size={14} /> السابق</button><div className="text-xs font-bold text-slate-300">صفحة <span className="num text-cyan-200">{page}</span> من <span className="num">{pages}</span></div><button className="btn-secondary flex items-center gap-1 px-3 py-2 text-xs" disabled={page >= pages} onClick={() => onPage(Math.min(pages, page + 1))}>التالي <ArrowLeft size={14} /></button></div>; }
