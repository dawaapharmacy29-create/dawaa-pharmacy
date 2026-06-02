import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  PackageSearch,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { formatDate } from "@/lib/utils";
import { displayEgyptianPhone, generateWhatsAppLink } from "@/lib/whatsapp";
import ImageUploadBox from "@/components/ImageUploadBox";
import CustomerSmartSearch, { type CustomerSearchResult } from "@/components/CustomerSmartSearch";
import {
  createCustomerRequest,
  getCustomerRequestEvents,
  getCustomerRequests,
  moveCustomerRequestToShortage,
  requestNeedsAttention,
  requestStatusLabel,
  REQUEST_STATUS_FLOW,
  updateCustomerRequestStatus,
  type CustomerRequest,
  type CustomerRequestEvent,
} from "@/lib/api/customerRequests";

type CustomerRow = {
  id?: string;
  customer_code?: string | null;
  code?: string | null;
  name?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
};

type StaffOption = { id: string; name: string; role: string | null; branch: string | null };

const statusGroups = [
  { key: "all", label: "كل الطلبات" },
  { key: "new", label: "طلبات جديدة" },
  { key: "purchasing_review", label: "مراجعة المشتريات" },
  { key: "searching_suppliers", label: "بحث عند الموردين" },
  { key: "needs_customer_confirmation", label: "تحتاج تأكيد العميل" },
  { key: "available", label: "تم توفيرها" },
  { key: "arrived", label: "وصلت للصيدلية" },
  { key: "delivered", label: "تم التسليم" },
];

function valueOf(row: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function customerLabel(c: CustomerRow) {
  const row = c as Record<string, unknown>;
  const name = valueOf(row, ["name", "customer_name"], "عميل بدون اسم");
  const code = valueOf(row, ["customer_code", "code"]);
  const phone = valueOf(row, ["phone", "customer_phone"]);
  return `${name}${code ? ` - كود ${code}` : ""}${phone ? ` - ${phone}` : ""}`;
}

function normalizeCustomer(c: CustomerRow) {
  const row = c as Record<string, unknown>;
  return {
    id: valueOf(row, ["id", "customer_code", "code"]),
    code: valueOf(row, ["customer_code", "code"]),
    name: valueOf(row, ["name", "customer_name"], ""),
    phone: valueOf(row, ["phone", "customer_phone"], ""),
    branch: valueOf(row, ["branch"], ""),
  };
}

export default function CustomerRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [selected, setSelected] = useState<CustomerRequest | null>(null);
  const [events, setEvents] = useState<CustomerRequestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const [newStatus, setNewStatus] = useState("");

  const { data: customers } = useSupabaseQuery<CustomerRow>({ table: "customers", realtimeEnabled: false });
  const { data: staff } = useSupabaseQuery<StaffOption>({ table: "staff", realtimeEnabled: false });

  const doctors = useMemo(
    () =>
      (staff || []).filter((item) =>
        [item.name, item.role].filter(Boolean).some((value) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist/i.test(String(value))),
      ),
    [staff],
  );

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCustomerRequests({ status: statusFilter, branch: branchFilter, search });
      setRequests(data);
      setSelected((current) => (current ? data.find((item) => item.id === current.id) || data[0] || null : data[0] || null));
    } catch (error) {
      toast.error(`تعذر تحميل طلبات العملاء: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, branchFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRequests();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  useEffect(() => {
    if (!selected) {
      setEvents([]);
      setNewStatus("");
      return;
    }
    setNewStatus(selected.status || "new");
    getCustomerRequestEvents(selected.id).then(setEvents);
  }, [selected]);

  const stats = useMemo(() => {
    const open = requests.filter((item) => !["closed", "delivered", "cancelled", "not_available"].includes(String(item.status))).length;
    return {
      total: requests.length,
      open,
      urgent: requests.filter((item) => ["urgent", "high", "عاجل", "مهم"].includes(String(item.urgency))).length,
      needsConfirm: requests.filter((item) => item.status === "needs_customer_confirmation").length,
      arrived: requests.filter((item) => ["available", "arrived"].includes(String(item.status))).length,
    };
  }, [requests]);

  const handleStatusUpdate = async () => {
    if (!selected || !newStatus) return;
    setSaving(true);
    try {
      const updated = await updateCustomerRequestStatus(selected, {
        status: newStatus,
        notes: statusNote,
        purchasing_notes: ["purchasing_review", "searching_suppliers", "sourcing", "available", "arrived"].includes(newStatus) ? statusNote : undefined,
        contact_summary: ["customer_contacted", "delivered", "closed"].includes(newStatus) ? statusNote : undefined,
        customer_confirmation_status: newStatus === "customer_confirmed" ? "confirmed" : undefined,
        user_id: user?.id,
        user_name: user?.name,
      });
      setSelected(updated);
      setRequests((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setStatusNote("");
      setEvents(await getCustomerRequestEvents(updated.id));
      toast.success("تم تحديث حالة طلب العميل");
    } catch (error) {
      toast.error(`تعذر تحديث الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = () => {
    if (!selected?.customer_phone) return toast.error("لا يوجد رقم هاتف صالح للعميل");
    const message = `أهلاً ${selected.customer_name || "حضرتك"}، مع حضرتك صيدليات دواء بخصوص طلب صنف ${selected.medicine_name}.`;
    window.open(generateWhatsAppLink(selected.customer_phone, message), "_blank", "noopener,noreferrer");
  };

  const handleMoveToShortage = async () => {
    if (!selected) return;
    const confirmed = window.confirm("سيتم نقل الطلب إلى صفحة النواقص مع الاحتفاظ ببيانات العميل والطلب. هل تريد المتابعة؟");
    if (!confirmed) return;
    setSaving(true);
    try {
      const result = await moveCustomerRequestToShortage(selected, {
        user_id: user?.id,
        user_name: user?.name,
      });
      setSelected(result.request);
      setRequests((items) => items.map((item) => (item.id === selected.id ? result.request : item)));
      setEvents(await getCustomerRequestEvents(selected.id));
      toast.success("تم نقل الطلب إلى النواقص وربطه بطلب العميل");
    } catch (error) {
      toast.error(`تعذر نقل الطلب للنواقص: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearFollowupHistory = async () => {
    const confirmed = window.confirm("⚠️ تحذير شديد: سيتم حذف سجل المتابعات بالكامل من الجداول التالية:\n\n• customer_request_events\n• customer_requests\n• customer_notes\n• customer_flags\n\nلن يتم حذف بيانات العملاء من جدول customers.\n\nهل أنت متأكد تمامًا من أنك تريد مسح سجل المتابعات؟");
    if (!confirmed) return;
    setSaving(true);
    try {
      const { error: eventsError } = await supabase.from("customer_request_events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (eventsError) throw new Error(eventsError.message);
      
      const { error: requestsError } = await supabase.from("customer_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (requestsError) throw new Error(requestsError.message);
      
      const { error: notesError } = await supabase.from("customer_notes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (notesError) throw new Error(notesError.message);
      
      const { error: flagsError } = await supabase.from("customer_flags").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (flagsError) throw new Error(flagsError.message);
      
      toast.success("تم مسح سجل المتابعات بالكامل");
      await loadRequests();
    } catch (error) {
      toast.error(`تعذر مسح سجل المتابعات: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="section-title">طلبات العملاء</div>
        {[1, 2, 3].map((item) => <div key={item} className="stat-card h-24 animate-pulse bg-white/5" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1">
          <div className="section-title flex items-center gap-2">
            <PackageSearch size={24} className="text-teal-300" /> طلبات العملاء
          </div>
          <div className="text-slate-400 text-sm mt-1">
            تتبع الأصناف المطلوبة من العملاء من لحظة تسجيل الدكتور حتى البحث والتوفير والتواصل والتسليم.
          </div>
        </div>
        <button onClick={() => setShowCreate((value) => !value)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> تسجيل طلب عميل
        </button>
        <button onClick={loadRequests} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={16} /> تحديث
        </button>
        {user?.role === "مدير عام" && (
          <button onClick={handleClearFollowupHistory} disabled={saving} className="btn-danger flex items-center gap-2">
            <AlertTriangle size={16} /> مسح سجل المتابعات
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="إجمالي الطلبات" value={stats.total} />
        <Stat label="طلبات مفتوحة" value={stats.open} color="text-amber-300" />
        <Stat label="طلبات عاجلة" value={stats.urgent} color="text-red-300" />
        <Stat label="تحتاج تأكيد" value={stats.needsConfirm} color="text-purple-300" />
        <Stat label="تم توفيرها/وصلت" value={stats.arrived} color="text-green-300" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {REQUEST_STATUS_FLOW.slice(0, 7).map((stage, idx) => {
          const count = requests.filter((item) => String(item.status || "new") === stage.value).length;
          return (
            <button
              key={stage.value}
              type="button"
              onClick={() => setStatusFilter(stage.value)}
              className={`rounded-2xl border p-3 text-right transition-all ${statusFilter === stage.value ? "border-teal-400 bg-teal-500/15" : "border-white/10 bg-white/5 hover:border-teal-400/30"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="w-7 h-7 rounded-xl bg-teal-500/15 text-teal-300 flex items-center justify-center font-black num">{idx + 1}</span>
                <span className="badge-info">{count}</span>
              </div>
              <div className="mt-2 text-sm font-bold text-white leading-6">{stage.label}</div>
            </button>
          );
        })}
      </div>

      {showCreate && (
        <CreateRequestPanel
          customers={customers || []}
          doctors={doctors}
          user={user}
          onCreated={(request) => {
            setRequests((items) => [request, ...items]);
            setSelected(request);
            setShowCreate(false);
            toast.success("تم تسجيل طلب العميل وإرساله للمتابعة");
          }}
        />
      )}

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className="relative lg:col-span-2">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input className="input-dark pl-9" placeholder="بحث باسم العميل أو الكود أو الصنف أو الدكتور... مثال: *ا*س*لا*م" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="input-dark" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          {statusGroups.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
          <option value="all">كل الفروع</option>
          <option value="فرع شكري">فرع شكري</option>
          <option value="فرع الشامي">فرع الشامي</option>
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="space-y-2 max-h-[calc(100vh-330px)] overflow-y-auto">
          {requests.length === 0 ? (
            <div className="stat-card text-center py-12 text-slate-400">لا توجد متابعات مسجلة حاليًا</div>
          ) : (
            requests.map((request) => (
              <button
                key={request.id}
                onClick={() => setSelected(request)}
                className={`w-full text-right p-4 rounded-2xl border transition-all ${selected?.id === request.id ? "bg-teal-500/10 border-teal-400/40" : "bg-[#1B2B4B] border-[#2d4063] hover:border-teal-400/25"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center text-teal-300">
                    <PackageSearch size={19} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-white font-bold truncate">{request.medicine_name}</div>
                      <span className={requestNeedsAttention(request) ? "badge-warning" : "badge-info"}>{requestStatusLabel(request.status)}</span>
                    </div>
                    <div className="text-slate-400 text-xs mt-1 truncate">
                      {request.customer_name || "عميل غير محدد"} — كود {request.customer_code || "غير محدد"} — {displayEgyptianPhone(request.customer_phone || "")}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-slate-400">
                      <span>الكمية: {request.quantity || 1}</span>
                      <span>الدكتور: {request.doctor_name || "غير محدد"}</span>
                      <span>{request.branch || "كل الفروع"}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="xl:col-span-2">
          {selected ? (
            <div className="space-y-4">
              <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-teal-500/15 border border-teal-400/25 flex items-center justify-center text-teal-300">
                    <ShoppingCart size={26} />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-white text-xl font-bold">{selected.medicine_name}</h2>
                      <span className={requestNeedsAttention(selected) ? "badge-warning" : "badge-info"}>{requestStatusLabel(selected.status)}</span>
                      {selected.is_expensive_or_special && <span className="badge-danger">صنف غالي/خاص</span>}
                      {selected.needs_customer_confirmation && <span className="badge-warning">يحتاج تأكيد العميل</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                      <Detail icon={UserRound} label="العميل" value={`${selected.customer_name || "غير محدد"} — كود ${selected.customer_code || "غير محدد"}`} />
                      <Detail icon={Phone} label="الهاتف" value={displayEgyptianPhone(selected.customer_phone || "")} />
                      <Detail icon={Truck} label="الفرع/الكمية" value={`${selected.branch || "غير محدد"} — ${selected.quantity || 1} علبة`} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button onClick={openWhatsApp} className="btn-primary">واتساب العميل</button>
                    <button onClick={handleMoveToShortage} disabled={saving || selected.status === "not_available"} className="btn-secondary text-sm">
                      نقل للنواقص
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <InfoCard title="ملاحظات الدكتور ومصدر البحث">
                  <Line label="الدكتور الذي سجل الطلب" value={selected.doctor_name || "غير محدد"} />
                  <Line label="ملاحظة الدكتور" value={selected.doctor_notes || "لا توجد ملاحظات"} />
                  <Line label="مورد/صيدلية محتملة" value={selected.supplier_hint || "غير محدد"} />
                  <Line label="تاريخ التسجيل" value={selected.created_at ? formatDate(selected.created_at) : "غير محدد"} />
                </InfoCard>

                <InfoCard title="إدارة الحالة والمتابعة">
                  <select className="input-dark" value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>
                    {REQUEST_STATUS_FLOW.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                  <textarea className="input-dark min-h-[92px] mt-3" value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="اكتب نتيجة البحث، رد المورد، تأكيد العميل، أو ملخص التواصل..." />
                  <button onClick={handleStatusUpdate} disabled={saving || newStatus === selected.status} className="btn-primary mt-3 w-full flex items-center justify-center gap-2">
                    {saving && <Loader2 size={16} className="animate-spin" />} تحديث حالة الطلب
                  </button>
                </InfoCard>
              </div>

              <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
                <div className="section-title flex items-center gap-2 mb-4"><History size={20} /> سجل تتبع الطلب</div>
                {events.length === 0 ? (
                  <div className="text-slate-400 text-sm">لا توجد أحداث مسجلة لهذا الطلب بعد.</div>
                ) : (
                  <div className="space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-white font-semibold">{event.action || "تحديث طلب"}</div>
                          <div className="text-slate-400 text-xs">{event.created_at ? formatDate(event.created_at) : ""}</div>
                        </div>
                        <div className="text-slate-300 text-sm mt-1">{event.notes || "بدون ملاحظات"}</div>
                        <div className="text-slate-500 text-xs mt-1">
                          {event.old_status ? requestStatusLabel(event.old_status) : "بداية"} ← {requestStatusLabel(event.new_status)} — بواسطة {event.created_by_name || "النظام"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="stat-card text-center py-16 text-slate-400">اختر طلبًا لعرض التفاصيل.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateRequestPanel({
  customers,
  doctors,
  user,
  onCreated,
}: {
  customers: CustomerRow[];
  doctors: StaffOption[];
  user: { id?: string; name?: string } | null;
  onCreated: (request: CustomerRequest) => void;
}) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [medicineName, setMedicineName] = useState("");
  const [image, setImage] = useState({ publicUrl: "", path: "" });
  const [quantity, setQuantity] = useState(1);
  const [requestedAt, setRequestedAt] = useState(new Date().toISOString().slice(0, 16));
  const [neededByDate, setNeededByDate] = useState("");
  const [expectedDays, setExpectedDays] = useState(0);
  const [urgency, setUrgency] = useState("normal");
  const [doctorId, setDoctorId] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [supplierHint, setSupplierHint] = useState("");
  const [special, setSpecial] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedDoctor = doctors.find((item) => item.id === doctorId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer?.name) return toast.error("اختر العميل أولًا");
    if (!medicineName.trim()) return toast.error("اكتب اسم الصنف المطلوب");
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
        is_expensive_or_special: special,
        needs_customer_confirmation: special,
        doctor_id: selectedDoctor?.id || null,
        doctor_name: selectedDoctor?.name || null,
        doctor_notes: doctorNotes,
        supplier_hint: supplierHint,
        requested_at: requestedAt ? new Date(requestedAt).toISOString() : new Date().toISOString(),
        needed_by_date: neededByDate || null,
        expected_fulfillment_days: expectedDays || null,
        potential_source_text: supplierHint || null,
        created_by: user?.id,
        created_by_name: user?.name,
      });
      onCreated(created);
    } catch (error) {
      toast.error(`تعذر تسجيل الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-[#1B2B4B] border border-teal-400/25 rounded-2xl p-5 space-y-4">
      <div className="section-title flex items-center gap-2"><ClipboardList size={20} /> تسجيل طلب صنف غير متوفر</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-3">
          <label className="text-slate-300 text-xs">بحث عن العميل</label>
          <div className="mt-1">
            <CustomerSmartSearch
              value={selectedCustomer}
              onSelect={setSelectedCustomer}
              placeholder="ابحث باسم العميل أو الكود أو الهاتف، مثال: محمد* أو 010*"
              disabled={saving}
              allowCreate
            />
          </div>
        </div>
        <div>
          <label className="text-slate-300 text-xs">اسم الصنف المطلوب *</label>
          <input className="input-dark mt-1" value={medicineName} onChange={(event) => setMedicineName(event.target.value)} placeholder="مثال: كرومكس 30 قرص" />
        </div>
        <div className="lg:col-span-3">
          <ImageUploadBox
            bucket="customer-request-images"
            folder="customer-requests"
            label="رفع صورة الصنف"
            valueUrl={image.publicUrl}
            valuePath={image.path}
            onUploaded={setImage}
            disabled={saving}
          />
        </div>
        <div>
          <label className="text-slate-300 text-xs">الكمية المطلوبة</label>
          <input className="input-dark mt-1" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value || 1))} />
        </div>
        <div>
          <label className="text-slate-300 text-xs">درجة الاستعجال</label>
          <select className="input-dark mt-1" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
            <option value="normal">عادي</option>
            <option value="high">مهم</option>
            <option value="urgent">عاجل</option>
          </select>
        </div>
        <div>
          <label className="text-slate-300 text-xs">تاريخ تسجيل الطلب</label>
          <input className="input-dark mt-1" type="datetime-local" value={requestedAt} onChange={(event) => setRequestedAt(event.target.value)} />
        </div>
        <div>
          <label className="text-slate-300 text-xs">العميل يحتاج الصنف في تاريخ</label>
          <input className="input-dark mt-1" type="date" value={neededByDate} onChange={(event) => setNeededByDate(event.target.value)} />
        </div>
        <div>
          <label className="text-slate-300 text-xs">أو يحتاجه خلال كام يوم</label>
          <input className="input-dark mt-1" type="number" min={0} value={expectedDays} onChange={(event) => setExpectedDays(Number(event.target.value || 0))} />
        </div>
        <div>
          <label className="text-slate-300 text-xs">الدكتور الذي سجل الطلب</label>
          <select className="input-dark mt-1" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
            <option value="">اختر الدكتور</option>
            {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} - {doctor.branch || ""}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-slate-200 bg-white/5 rounded-xl px-3 py-3 mt-5">
          <input type="checkbox" checked={special} onChange={(event) => setSpecial(event.target.checked)} />
          صنف غالي/خاص ويحتاج تأكيد العميل قبل التوفير
        </label>
        <div className="lg:col-span-2">
          <label className="text-slate-300 text-xs">ملاحظة الدكتور</label>
          <textarea className="input-dark mt-1 min-h-[84px]" value={doctorNotes} onChange={(event) => setDoctorNotes(event.target.value)} placeholder="مثال: العميل محتاج علبتين / سأل عليه في مورد معين / يفضل المستورد" />
        </div>
        <div>
          <label className="text-slate-300 text-xs">مصدر محتمل للصنف</label>
          <textarea className="input-dark mt-1 min-h-[84px]" value={supplierHint} onChange={(event) => setSupplierHint(event.target.value)} placeholder="مورد / صيدلية / مندوب محتمل" />
        </div>
      </div>
      <button disabled={saving} className="btn-primary flex items-center justify-center gap-2 min-w-52">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ طلب العميل
      </button>
    </form>
  );
}

function Stat({ label, value, color = "text-white" }: { label: string; value: number; color?: string }) {
  return (
    <div className="stat-card text-center">
      <div className={`text-2xl font-bold num ${color}`}>{value.toLocaleString("ar-EG")}</div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 text-slate-400 text-xs"><Icon size={14} /> {label}</div>
      <div className="text-white font-semibold mt-1 break-words">{value || "غير محدد"}</div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
      <div className="section-title mb-4">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-slate-100 text-sm mt-1 whitespace-pre-line">{value || "غير محدد"}</div>
    </div>
  );
}
