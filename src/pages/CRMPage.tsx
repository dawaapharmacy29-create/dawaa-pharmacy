import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PermissionGate, PageSectionsPreview } from '@/components/security/PermissionGate';
import { useAuth } from '@/hooks/useAuth';
import type {
  CRMFilters,
  CRMRequest,
  CRMRequestPriority,
  CRMRequestStatus,
  CRMTimeline,
  CRMTimelineInsert,
  CRMUserContext,
} from '../crm.types';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

const REQUESTS_TABLE = 'crm_requests';
const TIMELINE_TABLE = 'crm_timeline';
const MAX_NOTE_LENGTH = 1500;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABELS: Record<CRMRequestStatus, string> = {
  new: 'جديد',
  open: 'مفتوح',
  in_progress: 'قيد التنفيذ',
  waiting_customer: 'في انتظار العميل',
  waiting_internal: 'في انتظار داخلي',
  resolved: 'تم الحل',
  closed: 'مغلق',
  cancelled: 'ملغي',
};

const PRIORITY_LABELS: Record<CRMRequestPriority, string> = {
  low: 'منخفض',
  normal: 'عادي',
  high: 'مرتفع',
  urgent: 'عاجل',
};

const STATUS_CLASSES: Record<CRMRequestStatus, string> = {
  new: 'bg-sky-100 text-sky-800 border-sky-200',
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  waiting_customer: 'bg-purple-100 text-purple-800 border-purple-200',
  waiting_internal: 'bg-orange-100 text-orange-800 border-orange-200',
  resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
  cancelled: 'bg-rose-100 text-rose-800 border-rose-200',
};

const PRIORITY_CLASSES: Record<CRMRequestPriority, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  normal: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  high: 'bg-amber-100 text-amber-800 border-amber-200',
  urgent: 'bg-red-100 text-red-800 border-red-200',
};

const EVENT_LABELS: Record<string, string> = {
  created: 'إنشاء الطلب',
  note: 'ملاحظة',
  status_changed: 'تغيير الحالة',
  assigned: 'تعيين مسؤول',
  whatsapp: 'واتساب',
  call: 'مكالمة',
  follow_up: 'متابعة',
  completed: 'اكتمال',
  reopened: 'إعادة فتح',
  system: 'النظام',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  )
    return (error as { message: string }).message;
  return 'حدث خطأ غير متوقع';
}

function getCompanyId(user: unknown): string {
  const u = (user || {}) as Record<string, unknown>;
  const candidates = [
    u.company_id,
    u.companyId,
    u.tenant_id,
    localStorage.getItem('dawaa_company_id'),
    import.meta.env.VITE_DAWAA_COMPANY_ID,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  // fallback ثابت حتى لا تتوقف صفحة CRM عند غياب المتغير في Vercel
  return '00000000-0000-0000-0000-000000000000';
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/80 p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        🧾
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300">
        {description}
      </p>
    </div>
  );
}

function RequestCard({
  request,
  active,
  onClick,
}: {
  request: CRMRequest;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-right transition-all duration-200 ${active ? 'border-emerald-500 bg-emerald-50 shadow-md shadow-emerald-100 dark:border-emerald-400 dark:bg-emerald-950/40 dark:shadow-none' : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
            {request.title || 'طلب بدون عنوان'}
          </h3>
          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
            {request.customer_name || 'عميل غير محدد'}
          </p>
        </div>
        <Badge className={PRIORITY_CLASSES[request.priority] ?? PRIORITY_CLASSES.normal}>
          {PRIORITY_LABELS[request.priority] ?? 'عادي'}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge className={STATUS_CLASSES[request.status] ?? STATUS_CLASSES.open}>
          {STATUS_LABELS[request.status] ?? request.status}
        </Badge>
        {request.branch_name ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {request.branch_name}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div>
          <span className="block font-semibold text-slate-700 dark:text-slate-200">آخر تفاعل</span>
          <span>{formatDateTime(request.last_interaction_at ?? request.updated_at)}</span>
        </div>
        <div>
          <span className="block font-semibold text-slate-700 dark:text-slate-200">المسؤول</span>
          <span>{request.assigned_to_name || 'غير محدد'}</span>
        </div>
      </div>
    </button>
  );
}

function TimelineItem({ item }: { item: CRMTimeline }) {
  const label = EVENT_LABELS[item.event_type] ?? item.event_type;
  return (
    <div className="relative pr-8">
      <span className="absolute right-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 ring-4 ring-emerald-100 dark:ring-emerald-950" />
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {label}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {item.created_by_name || 'مستخدم النظام'}
            </span>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(item.created_at)}
          </span>
        </div>
        {item.old_status && item.new_status ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            تم تغيير الحالة من <strong>{STATUS_LABELS[item.old_status] ?? item.old_status}</strong>{' '}
            إلى <strong>{STATUS_LABELS[item.new_status] ?? item.new_status}</strong>
          </div>
        ) : null}
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-800 dark:text-slate-100">
          {item.note}
        </p>
      </div>
    </div>
  );
}

export default function CRMPage() {
  const { user, checkPermission } = useAuth();
  const [userContext, setUserContext] = useState<CRMUserContext | null>(null);
  const [requests, setRequests] = useState<CRMRequest[]>([]);
  const [timeline, setTimeline] = useState<CRMTimeline[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [requestsState, setRequestsState] = useState<LoadState>('idle');
  const [timelineState, setTimelineState] = useState<LoadState>('idle');
  const [btnLoading, setBtnLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [filters, setFilters] = useState<CRMFilters>({
    search: '',
    status: 'all',
    priority: 'all',
    requestType: 'all',
  });

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? null,
    [requests, selectedRequestId]
  );
  const filteredRequests = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesSearch =
        !search ||
        request.title.toLowerCase().includes(search) ||
        request.customer_name.toLowerCase().includes(search) ||
        (request.customer_phone ?? '').toLowerCase().includes(search) ||
        (request.customer_code ?? '').toLowerCase().includes(search);
      return (
        matchesSearch &&
        (filters.status === 'all' || request.status === filters.status) &&
        (filters.priority === 'all' || request.priority === filters.priority) &&
        (filters.requestType === 'all' || request.request_type === filters.requestType)
      );
    });
  }, [requests, filters]);
  const stats = useMemo(
    () => ({
      total: requests.length,
      open: requests.filter((request) =>
        ['new', 'open', 'in_progress', 'waiting_customer', 'waiting_internal'].includes(
          request.status
        )
      ).length,
      urgent: requests.filter((request) => request.priority === 'urgent').length,
      resolved: requests.filter((request) => ['resolved', 'closed'].includes(request.status))
        .length,
    }),
    [requests]
  );

  useEffect(() => {
    if (!user?.id) return;
    const companyId = getCompanyId(user);
    if (!companyId) {
      return;
    }
    setUserContext({
      userId: user.id,
      companyId,
      displayName: user.name || user.username || 'مستخدم النظام',
      branch: user.branch,
      role: user.role,
    });
  }, [user]);

  const loadRequests = useCallback(async () => {
    if (!userContext) return;
    setRequestsState('loading');
    setErrorMessage(null);
    try {
      const selectColumns =
        'id,company_id,customer_id,customer_code,customer_name,customer_phone,title,description,request_type,source,status,priority,branch_id,branch_name,assigned_to,assigned_to_name,created_by,created_by_name,due_at,last_interaction_at,closed_at,closed_by,closed_by_name,metadata,created_at,updated_at';
      let query = supabase
        .from(REQUESTS_TABLE)
        .select(selectColumns)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (userContext.companyId && userContext.companyId !== '00000000-0000-0000-0000-000000000000')
        query = query.eq('company_id', userContext.companyId);
      if (
        !checkPermission('crm.scope.all_branches') &&
        userContext.branch &&
        userContext.branch !== 'كل الفروع'
      )
        query = query.eq('branch_name', userContext.branch);
      const { data, error } = await query;
      if (error) throw error;
      const safeData = (data ?? []) as CRMRequest[];
      setRequests(safeData);
      setSelectedRequestId((current) =>
        current && safeData.some((r) => r.id === current) ? current : (safeData[0]?.id ?? null)
      );
      setRequestsState('success');
    } catch (error) {
      setRequestsState('error');
      setErrorMessage(getErrorMessage(error));
    }
  }, [checkPermission, userContext]);

  const loadTimeline = useCallback(
    async (requestId: string) => {
      if (!userContext?.companyId) return;
      setTimelineState('loading');
      setErrorMessage(null);
      try {
        const { data, error } = await supabase
          .from(TIMELINE_TABLE)
          .select(
            'id,company_id,request_id,event_type,note,old_status,new_status,created_by,created_by_name,metadata,created_at'
          )
          .eq('company_id', userContext.companyId)
          .eq('request_id', requestId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        setTimeline((data ?? []) as CRMTimeline[]);
        setTimelineState('success');
      } catch (error) {
        setTimelineState('error');
        setErrorMessage(getErrorMessage(error));
      }
    },
    [userContext?.companyId]
  );

  useEffect(() => {
    if (userContext) loadRequests();
  }, [userContext, loadRequests]);
  useEffect(() => {
    if (selectedRequestId && userContext?.companyId) loadTimeline(selectedRequestId);
    else setTimeline([]);
  }, [selectedRequestId, userContext?.companyId, loadTimeline]);

  const handleSubmitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRequest || !userContext) {
      setErrorMessage('اختر طلبًا أولًا قبل إضافة المتابعة');
      return;
    }
    if (!checkPermission('crm.action.add_note')) {
      setErrorMessage('ليس لديك صلاحية إضافة متابعة');
      return;
    }
    const safeNote = normalizeText(note);
    if (safeNote.length < 2) {
      setErrorMessage('اكتب ملاحظة واضحة قبل الحفظ');
      return;
    }
    if (safeNote.length > MAX_NOTE_LENGTH) {
      setErrorMessage(`الملاحظة طويلة جدًا. الحد الأقصى ${MAX_NOTE_LENGTH} حرف`);
      return;
    }
    setBtnLoading(true);
    setErrorMessage(null);
    try {
      const payload: CRMTimelineInsert = {
        company_id: userContext.companyId,
        request_id: selectedRequest.id,
        event_type: 'note',
        note: safeNote,
        created_by: userContext.userId,
        created_by_name: userContext.displayName,
        metadata: { source: 'crm_page' },
      };
      const { data: insertedTimeline, error: insertError } = await supabase
        .from(TIMELINE_TABLE)
        .insert(payload)
        .select(
          'id,company_id,request_id,event_type,note,old_status,new_status,created_by,created_by_name,metadata,created_at'
        )
        .single();
      if (insertError) throw insertError;
      const now = new Date().toISOString();
      const nextStatus: CRMRequestStatus =
        selectedRequest.status === 'new' ? 'open' : selectedRequest.status;
      const { error: updateError } = await supabase
        .from(REQUESTS_TABLE)
        .update({ status: nextStatus, last_interaction_at: now, updated_at: now })
        .eq('company_id', userContext.companyId)
        .eq('id', selectedRequest.id);
      if (updateError) throw updateError;
      setTimeline((current) => [...current, insertedTimeline as CRMTimeline]);
      setRequests((current) =>
        current.map((request) =>
          request.id === selectedRequest.id
            ? { ...request, status: nextStatus, last_interaction_at: now, updated_at: now }
            : request
        )
      );
      setNote('');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBtnLoading(false);
    }
  };

  return (
    <PermissionGate
      permission="page.crm.view"
      fallback={
        <div className="stat-card py-12 text-center text-slate-300" dir="rtl">
          ليس لديك صلاحية للوصول إلى CRM.
        </div>
      }
    >
      <main
        dir="rtl"
        className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-white sm:px-6 lg:px-8"
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Dawaa Pharmacy 2027
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                  لوحة CRM ومتابعة العملاء
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  متابعة طلبات العملاء والتفاعلات مع فلترة صارمة حسب company_id ونطاق الصلاحيات.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadRequests()}
                disabled={requestsState === 'loading'}
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {requestsState === 'loading' ? 'جاري التحديث...' : 'تحديث البيانات'}
              </button>
            </div>
            <PageSectionsPreview path="/crm" />
            {errorMessage ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {errorMessage}
              </div>
            ) : null}
          </header>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                إجمالي الطلبات
              </p>
              <p className="mt-2 text-2xl font-black">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                طلبات مفتوحة
              </p>
              <p className="mt-2 text-2xl font-black text-blue-700 dark:text-blue-300">
                {stats.open}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                طلبات عاجلة
              </p>
              <p className="mt-2 text-2xl font-black text-red-700 dark:text-red-300">
                {stats.urgent}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">تم حلها</p>
              <p className="mt-2 text-2xl font-black text-emerald-700 dark:text-emerald-300">
                {stats.resolved}
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
            <aside className="order-1 lg:order-2">
              <div className="sticky top-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4">
                  <h2 className="text-lg font-black">طلبات CRM</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    اختر طلبًا لعرض التايم لاين وإضافة متابعة.
                  </p>
                </div>
                <div className="mb-4 space-y-3">
                  <input
                    type="search"
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, search: event.target.value }))
                    }
                    placeholder="بحث باسم العميل، الهاتف، الكود أو العنوان..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-emerald-950"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={filters.status}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          status: event.target.value as CRMFilters['status'],
                        }))
                      }
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="all">كل الحالات</option>
                      <option value="new">جديد</option>
                      <option value="open">مفتوح</option>
                      <option value="in_progress">قيد التنفيذ</option>
                      <option value="waiting_customer">في انتظار العميل</option>
                      <option value="resolved">تم الحل</option>
                      <option value="closed">مغلق</option>
                    </select>
                    <select
                      value={filters.priority}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          priority: event.target.value as CRMFilters['priority'],
                        }))
                      }
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="all">كل الأولويات</option>
                      <option value="low">منخفض</option>
                      <option value="normal">عادي</option>
                      <option value="high">مرتفع</option>
                      <option value="urgent">عاجل</option>
                    </select>
                  </div>
                </div>
                <div className="max-h-[calc(100vh-310px)] space-y-3 overflow-y-auto pl-1">
                  {requestsState === 'loading' ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      جاري تحميل الطلبات...
                    </div>
                  ) : filteredRequests.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      لا توجد طلبات مطابقة.
                    </div>
                  ) : (
                    filteredRequests.map((request) => (
                      <RequestCard
                        key={request.id}
                        request={request}
                        active={request.id === selectedRequestId}
                        onClick={() => setSelectedRequestId(request.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </aside>

            <section className="order-2 lg:order-1">
              {!selectedRequest ? (
                <EmptyState
                  title="اختر طلبًا من القائمة"
                  description="بعد اختيار الطلب ستظهر تفاصيل العميل والتايم لاين ونموذج إضافة متابعة جديدة."
                />
              ) : (
                <div className="space-y-6">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge className={STATUS_CLASSES[selectedRequest.status]}>
                            {STATUS_LABELS[selectedRequest.status]}
                          </Badge>
                          <Badge className={PRIORITY_CLASSES[selectedRequest.priority]}>
                            {PRIORITY_LABELS[selectedRequest.priority]}
                          </Badge>
                        </div>
                        <h2 className="text-2xl font-black text-slate-950 dark:text-white">
                          {selectedRequest.title}
                        </h2>
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600 dark:text-slate-300">
                          {selectedRequest.description || 'لا يوجد وصف مسجل لهذا الطلب.'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-950">
                        <p className="font-bold text-slate-900 dark:text-white">
                          {selectedRequest.customer_name}
                        </p>
                        <p className="mt-1 text-slate-500 dark:text-slate-400">
                          {selectedRequest.customer_phone || 'لا يوجد هاتف'}
                        </p>
                        <p className="mt-1 text-slate-500 dark:text-slate-400">
                          {selectedRequest.customer_code || 'لا يوجد كود'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <PermissionGate permission="crm.action.add_note">
                    <form
                      onSubmit={handleSubmitNote}
                      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-black">إضافة متابعة جديدة</h3>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          الحفظ يتم مع company_id الحالي ولا يسمح بالكتابة خارج نطاق الشركة.
                        </p>
                      </div>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={MAX_NOTE_LENGTH}
                        rows={5}
                        placeholder="اكتب ملخص المكالمة أو المتابعة أو رد العميل..."
                        className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-emerald-950"
                      />
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {note.length} / {MAX_NOTE_LENGTH} حرف
                        </span>
                        <button
                          type="submit"
                          disabled={btnLoading || !selectedRequest}
                          className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {btnLoading ? 'جاري الحفظ...' : 'حفظ المتابعة'}
                        </button>
                      </div>
                    </form>
                  </PermissionGate>
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-5">
                      <h3 className="text-lg font-black">Timeline</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        سجل كامل للتفاعلات الخاصة بهذا الطلب.
                      </p>
                    </div>
                    {timelineState === 'loading' ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        جاري تحميل التايم لاين...
                      </div>
                    ) : timeline.length === 0 ? (
                      <EmptyState
                        title="لا توجد تفاعلات بعد"
                        description="أضف أول متابعة لهذا الطلب من النموذج بالأعلى."
                      />
                    ) : (
                      <div className="relative space-y-5 before:absolute before:right-[7px] before:top-2 before:h-[calc(100%-16px)] before:w-0.5 before:bg-emerald-100 dark:before:bg-emerald-950">
                        {timeline.map((item) => (
                          <TimelineItem key={item.id} item={item} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </section>
        </div>
      </main>
    </PermissionGate>
  );
}
