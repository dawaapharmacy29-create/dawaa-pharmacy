import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  MessageSquare,
  Phone,
  Search,
  Users,
} from "lucide-react";
import {
  ALL_FILTER,
  getCustomerDetails,
  getCustomers,
  getCustomerStats,
  type CustomerDetails,
  type CustomerMetric,
  type CustomerStats,
} from "@/lib/api/customers";
import { formatCurrency, formatDate } from "@/lib/utils";
import { whatsappLink } from "@/lib/whatsapp";
import { BRANCHES } from "@/lib/constants";
import { normalizeBranchName } from "@/lib/branch";

const PAGE_SIZE = 30;

const EMPTY_STATS: CustomerStats = {
  total: 0,
  veryImportant: 0,
  important: 0,
  medium: 0,
  normal: 0,
  newC: 0,
  active: 0,
  atRisk: 0,
  stopped: 0,
  noPurchase: 0,
  vip: 0,
};

const SEGMENT_OPTIONS = ["مهم جدًا", "مهم", "متوسط", "عادي"];
const STATUS_OPTIONS = ["جديد", "نشط", "مهدد بالتوقف", "متوقف", "بدون شراء"];

export default function Customers() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState(ALL_FILTER);
  const [segmentFilter, setSegmentFilter] = useState(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<CustomerMetric[]>([]);
  const [stats, setStats] = useState<CustomerStats>(EMPTY_STATS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerMetric | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.replace(/\s+/g, " ").trim()), 450);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, branchFilter, segmentFilter, statusFilter]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await getCustomerStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل إحصائيات العملاء");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (customers.length) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await getCustomers({
        search: debouncedSearch,
        branch: branchFilter,
        type: segmentFilter,
        status: statusFilter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });

      if (requestId !== requestIdRef.current) return;
      setCustomers(result.customers);
      setTotalCount(result.count);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setCustomers([]);
      setTotalCount(0);
      setError(err instanceof Error ? err.message : "تعذر تحميل العملاء من customer_metrics_summary");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [branchFilter, customers.length, debouncedSearch, page, segmentFilter, statusFilter]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(page * PAGE_SIZE, totalCount);

  const cards = useMemo(() => [
    { label: "إجمالي العملاء", value: stats.total, type: ALL_FILTER, status: ALL_FILTER, tone: "slate" as const },
    { label: "مهم جدًا", value: stats.veryImportant, type: "مهم جدًا", status: ALL_FILTER, tone: "violet" as const },
    { label: "مهم", value: stats.important, type: "مهم", status: ALL_FILTER, tone: "amber" as const },
    { label: "متوسط", value: stats.medium, type: "متوسط", status: ALL_FILTER, tone: "blue" as const },
    { label: "عادي", value: stats.normal, type: "عادي", status: ALL_FILTER, tone: "slate" as const },
    { label: "جديد", value: stats.newC, type: ALL_FILTER, status: "جديد", tone: "teal" as const },
    { label: "نشط", value: stats.active, type: ALL_FILTER, status: "نشط", tone: "emerald" as const },
    { label: "مهدد بالتوقف", value: stats.atRisk, type: ALL_FILTER, status: "مهدد بالتوقف", tone: "amber" as const },
    { label: "متوقف", value: stats.stopped, type: ALL_FILTER, status: "متوقف", tone: "red" as const },
    { label: "بدون شراء", value: stats.noPurchase, type: ALL_FILTER, status: "بدون شراء", tone: "blue" as const },
  ], [stats]);

  const applyCardFilter = (type: string, status: string) => {
    setSegmentFilter(type);
    setStatusFilter(status);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-hero">
        <div>
          <span className="dawaa-brand-chip">customer_metrics_summary</span>
          <h1 className="mt-3 text-2xl font-black text-slate-950">العملاء</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">تصنيف سريع ودقيق من ملخصات العملاء بدون تحميل كل الفواتير</p>
        </div>
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-black text-teal-800">
          {refreshing ? "جاري تحديث النتائج..." : `${showingFrom}-${showingTo} من ${totalCount}`}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
        {cards.map((card) => (
          <CustomerStatCard
            key={card.label}
            label={card.label}
            value={statsLoading ? "..." : card.value}
            tone={card.tone}
            active={segmentFilter === card.type && statusFilter === card.status}
            onClick={() => applyCardFilter(card.type, card.status)}
          />
        ))}
      </section>

      <section className="dawaa-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_190px]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالكود، الاسم، الهاتف... مثال: احمد* أو *احمد* أو 010*"
              className="dawaa-input w-full pr-10"
            />
            {refreshing && <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-teal-600" />}
          </div>
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="dawaa-input w-full">
            <option value={ALL_FILTER}>كل الفروع</option>
            {BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <select value={segmentFilter} onChange={(event) => setSegmentFilter(event.target.value)} className="dawaa-input w-full">
            <option value={ALL_FILTER}>كل التصنيفات</option>
            {SEGMENT_OPTIONS.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="dawaa-input w-full">
            <option value={ALL_FILTER}>كل الحالات</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-black">تعذر تحميل بيانات العملاء</div>
              <div className="mt-1">{error}</div>
            </div>
          </div>
        </div>
      )}

      <section className="dawaa-panel overflow-hidden p-0">
        {loading ? (
          <LoadingRows />
        ) : customers.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="dawaa-table min-w-[1180px]">
                <thead>
                  <tr>
                    <th>كود العميل</th>
                    <th>اسم العميل</th>
                    <th>الهاتف</th>
                    <th>الفرع</th>
                    <th>التصنيف</th>
                    <th>الحالة</th>
                    <th>إجمالي المشتريات</th>
                    <th>متوسط شهري</th>
                    <th>متوسط الفاتورة</th>
                    <th>عدد الفواتير</th>
                    <th>أول شراء</th>
                    <th>آخر شراء</th>
                    <th>عدد أشهر النشاط</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id} className="cursor-pointer" onClick={() => setSelected(customer)}>
                      <td className="font-bold text-slate-700">{customer.customer_code || "بدون كود"}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-black text-teal-700">
                            {(customer.customer_name || "ع")[0]}
                          </div>
                          <span className="font-black text-slate-950">{customer.customer_name || "عميل بدون اسم"}</span>
                        </div>
                      </td>
                      <td className="num">{customer.customer_phone || "بدون رقم"}</td>
                      <td>{normalizeBranchName(customer.branch)}</td>
                      <td><SegmentBadge segment={customer.segment} /></td>
                      <td><StatusBadge status={customer.customer_status} /></td>
                      <td className="font-black text-teal-700 num">{formatCurrency(customer.total_spent)}</td>
                      <td className="font-bold text-slate-900 num">{formatCurrency(customer.avg_monthly)}</td>
                      <td className="num">{formatCurrency(customer.avg_invoice)}</td>
                      <td className="num">{customer.invoices_count}</td>
                      <td>{customer.first_purchase ? formatDate(customer.first_purchase) : "غير محدد"}</td>
                      <td>{customer.last_purchase ? formatDate(customer.last_purchase) : "غير محدد"}</td>
                      <td className="num">{customer.active_months}</td>
                      <td>
                        <button type="button" className="rounded-xl p-2 text-slate-400 hover:bg-teal-50 hover:text-teal-700" title="عرض التفاصيل">
                          <Eye size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          </>
        ) : (
          <div className="py-14 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <div className="font-black text-slate-700">لا توجد نتائج مطابقة</div>
            <div className="mt-1 text-sm text-slate-500">جرّب تغيير البحث أو الفلاتر</div>
          </div>
        )}
      </section>

      {selected && <CustomerDetailsModal customer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CustomerStatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: ReactNode;
  tone: "slate" | "violet" | "amber" | "blue" | "teal" | "emerald" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    slate: "text-slate-800 bg-white border-slate-200",
    violet: "text-violet-700 bg-violet-50 border-violet-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
    blue: "text-blue-700 bg-blue-50 border-blue-200",
    teal: "text-teal-700 bg-teal-50 border-teal-200",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    red: "text-red-700 bg-red-50 border-red-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[104px] rounded-2xl border p-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]} ${active ? "ring-2 ring-teal-300" : ""}`}
    >
      <div className="num text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs font-black leading-5">{label}</div>
    </button>
  );
}

function SegmentBadge({ segment }: { segment: string }) {
  const className = {
    "مهم جدًا": "border-violet-200 bg-violet-50 text-violet-700",
    "مهم": "border-amber-200 bg-amber-50 text-amber-700",
    "متوسط": "border-blue-200 bg-blue-50 text-blue-700",
    "عادي": "border-slate-200 bg-slate-50 text-slate-600",
  }[segment] || "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>{segment || "عادي"}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const className = {
    "جديد": "border-blue-200 bg-blue-50 text-blue-700",
    "نشط": "border-emerald-200 bg-emerald-50 text-emerald-700",
    "مهدد بالتوقف": "border-amber-200 bg-amber-50 text-amber-700",
    "متوقف": "border-red-200 bg-red-50 text-red-700",
    "بدون شراء": "border-slate-200 bg-slate-50 text-slate-600",
  }[status] || "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>{status || "غير محدد"}</span>;
}

function Pagination({ page, totalPages, totalCount, onPageChange }: { page: number; totalPages: number; totalCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
      <span>إجمالي النتائج: {totalCount}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary px-3 py-2" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronRight size={16} />
        </button>
        <span className="rounded-xl bg-white px-3 py-2 shadow-sm">{page} / {totalPages}</span>
        <button type="button" className="btn-secondary px-3 py-2" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}

function CustomerDetailsModal({ customer, onClose }: { customer: CustomerMetric; onClose: () => void }) {
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wa = customer.customer_phone ? whatsappLink(customer.customer_phone, `السلام عليكم ${customer.customer_name || ""}`.trim()) : null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getCustomerDetails(customer)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "تعذر تحميل تفاصيل العميل");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-6xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <div className="text-2xl font-black text-slate-950">{customer.customer_name || "عميل بدون اسم"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
              <Phone size={14} />
              <span>{customer.customer_phone || "بدون رقم"}</span>
              <span>كود {customer.customer_code || "بدون كود"}</span>
              <span>{normalizeBranchName(customer.branch)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center gap-2">
                <MessageSquare size={16} /> واتساب
              </a>
            )}
            <button type="button" onClick={onClose} className="btn-secondary">إغلاق</button>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="إجمالي المشتريات" value={formatCurrency(customer.total_spent)} />
          <Metric label="متوسط شهري" value={formatCurrency(customer.avg_monthly)} />
          <Metric label="متوسط الفاتورة" value={formatCurrency(customer.avg_invoice)} />
          <Metric label="عدد الفواتير" value={String(customer.invoices_count)} />
          <Metric label="أول شراء" value={customer.first_purchase ? formatDate(customer.first_purchase) : "غير محدد"} />
          <Metric label="آخر شراء" value={customer.last_purchase ? formatDate(customer.last_purchase) : "غير محدد"} />
          <Metric label="أشهر النشاط" value={String(customer.active_months)} />
          <Metric label="التصنيف والحالة" value={`${customer.segment} · ${customer.customer_status}`} />
        </div>

        {error && <div className="mx-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div className="crm-card">
            <h3 className="mb-3 text-base font-black text-slate-950">آخر المتابعات</h3>
            {loading ? <LoaderLine /> : details?.followups.length ? (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {details.followups.map((followup) => (
                  <div key={followup.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={followup.status || "متابعة"} />
                      <span className="text-xs font-bold text-slate-400">{followup.created_at ? formatDate(followup.created_at) : "غير محدد"}</span>
                    </div>
                    <div className="mt-2 whitespace-pre-line text-sm text-slate-600">{followup.followup_result || followup.notes || "بدون ملاحظات"}</div>
                    <div className="mt-2 text-xs font-bold text-slate-500">المسؤول: {followup.responsible_name || followup.assigned_to || "غير محدد"}</div>
                  </div>
                ))}
              </div>
            ) : <Empty text="لا توجد متابعات مسجلة لهذا العميل" />}
          </div>

          <div className="crm-card">
            <h3 className="mb-3 text-base font-black text-slate-950">آخر الفواتير</h3>
            {loading ? <LoaderLine /> : details?.invoices.length ? (
              <div className="max-h-72 overflow-auto">
                <table className="dawaa-table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>رقم الفاتورة</th>
                      <th>التاريخ</th>
                      <th>القيمة</th>
                      <th>الدكتور</th>
                      <th>الفرع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.invoices.map((invoice, index) => (
                      <tr key={`${invoice.invoice_number}-${index}`}>
                        <td>{invoice.invoice_number || "-"}</td>
                        <td>{invoice.invoice_date ? formatDate(invoice.invoice_date) : "-"}</td>
                        <td className="font-black text-teal-700">{formatCurrency(invoice.amount)}</td>
                        <td>{invoice.seller_name || "-"}</td>
                        <td>{invoice.branch || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty text="لا توجد فواتير مرتبطة بهذا العميل" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function LoaderLine() {
  return <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-teal-600" /> جاري التحميل...</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">{text}</div>;
}
