import { useMemo, useState } from "react";
import {
  Plus,
  Package,
  AlertTriangle,
  Trash2,
  Edit,
  Calendar,
  ClipboardList,
  Filter,
  XCircle,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { logActivity as writeActivityLog } from "@/lib/activityLog";
import { supabase } from "@/lib/supabase";
import { useAuth, getCurrentUserProfile } from "@/hooks/useAuth";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { toast } from "sonner";
import { getCustomers } from "@/lib/api/customers";
import { phoneSearchTokens } from "@/lib/phone";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import {
  groupDoctorTotals,
  movementTotalForMedicine,
  requiredQuantity,
  targetAchieved,
} from "@/lib/medicinePerformance";
import { persistPointsTransaction } from "@/lib/pointsPersistence";

interface ExpiryBatch {
  expiry_date: string;
  quantity: number;
}

interface StagnantMedicine {
  id: string;
  product_name?: string | null;
  medicine_name: string;
  usage: string | null;
  product_type?: string | null;
  expiry_date: string | null;
  quantity_available: number | null;
  product_price?: number | null;
  unit_price?: number | null;
  batch_details?: ExpiryBatch[] | string | null;
  branch: string | null;
  priority: string | null;
  notes: string | null;
  responsible_doctor?: string | null;
  dispensed_quantity?: number | null;
  target_min_percent?: number | null;
  target_min_quantity?: number | null;
  doctor_id?: string | null;
  last_dispensed_at?: string | null;
  uploaded_by: string | null;
  upload_date: string | null;
  source_file_date?: string | null;
  // New fields
  product_code?: string | null;
  category?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  responsible_doctor_id?: string | null;
  responsible_doctor_name?: string | null;
  total_quantity?: number | null;
  remaining_quantity?: number | null;
  nearest_expiry_date?: string | null;
  stagnant_file_date?: string | null;
  last_dispense_date?: string | null;
  minimum_remaining_percent?: number | null;
  incentive_per_unit?: number | null;
  status?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
}

interface StagnantDispenseRecord {
  id: string;
  stagnant_medicine_id?: string | null;
  medicine_id?: string | null;
  product_name: string;
  medicine_name?: string;
  product_code?: string | null;
  doctor_id?: string | null;
  doctor_name: string;
  branch_id?: string | null;
  branch?: string | null;
  branch_name?: string | null;
  quantity: number | null;
  incentive_per_unit?: number | null;
  total_incentive?: number | null;
  product_expiry_date?: string | null;
  expiry_date?: string | null;
  dispensed_at?: string | null;
  transaction_date?: string | null;
  month_cycle?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  invoice_no?: string | null;
  notes?: string | null;
  points_awarded?: number | null;
  created_by?: string | null;
  created_at?: string | null;
}

interface ActivityLogRecord {
  id: string;
  operation?: string | null;
  action?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_title?: string | null;
  user_name?: string | null;
  branch_name?: string | null;
  details?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  route_path?: string | null;
  created_at?: string | null;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id?: string | null;
}

interface DoctorProfile {
  id: string;
  staff_id?: string | null;
  name: string;
  role?: string | null;
  branch?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  active?: boolean | null;
}

interface CustomerOption {
  id?: string | null;
  customer_code?: string | null;
  code?: string | null;
  name?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
  invoice_date?: string | null;
}

const blankForm = {
  medicine_name: "",
  product_code: "",
  usage: "",
  product_type: "",
  expiry_date: "",
  quantity_available: 0,
  product_price: 0,
  batches_text: "",
  responsible_doctor_id: "",
  responsible_doctor_name: "",
  responsible_doctor: "",
  dispensed_quantity: 0,
  target_min_percent: 0,
  last_dispensed_at: "",
  source_file_date: new Date().toISOString().split("T")[0],
  priority: "medium",
  incentive_per_unit: 0,
  status: "نشط",
  notes: "",
};

const blankDispenseForm = {
  doctor_id: "",
  doctor_name: "",
  quantity: 1,
  dispensed_at: new Date().toISOString().split("T")[0],
  product_expiry_date: "",
  incentive_per_unit: 0,
  customer_id: "",
  customer_name: "",
  customer_code: "",
  customer_phone: "",
  invoice_no: "",
  notes: "",
};

function missingColumn(message: string) {
  return (
    message.match(
      /column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i,
    )?.[1] || null
  );
}

function isAllBranches(branch?: string | null) {
  return !branch || branch === "الكل" || branch.includes("ÙƒÙ„");
}

function normalizeCustomerLookup(value: unknown) {
  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "ا")
    .replace(/\u0649/g, "ي")
    .replace(/\u0629/g, "ه")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const UUID_LIKE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanCustomerCode(value: unknown) {
  const text = String(value || "").trim();
  if (!text || UUID_LIKE_RE.test(text)) return "";
  return text;
}

function customerSearchText(customer: CustomerOption) {
  return normalizeCustomerLookup([
    customer.customer_name,
    customer.name,
    customer.customer_code,
    customer.code,
    customer.customer_phone,
    customer.phone,
  ].filter(Boolean).join(" "));
}

function parseBatches(text: string): ExpiryBatch[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [quantityRaw, expiryRaw] = line
        .split("|")
        .map((part) => part.trim());
      const quantity = Number(quantityRaw);
      return Number.isFinite(quantity) && expiryRaw
        ? { quantity, expiry_date: expiryRaw }
        : null;
    })
    .filter((batch): batch is ExpiryBatch => Boolean(batch));
}

function normalizeBatches(
  value: StagnantMedicine["batch_details"],
): ExpiryBatch[] {
  if (!value) return [];
  if (Array.isArray(value))
    return [...value].sort((a, b) =>
      String(a.expiry_date).localeCompare(String(b.expiry_date)),
    );
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.sort((a, b) =>
            String(a.expiry_date).localeCompare(String(b.expiry_date)),
          )
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function batchesToText(
  value: StagnantMedicine["batch_details"],
  fallbackQuantity?: number | null,
  fallbackExpiry?: string | null,
) {
  const batches = normalizeBatches(value);
  if (batches.length)
    return batches
      .map((batch) => `${batch.quantity} | ${batch.expiry_date}`)
      .join("\n");
  return fallbackQuantity && fallbackExpiry
    ? `${fallbackQuantity} | ${fallbackExpiry}`
    : "";
}

function getTotalQuantity(medicine: StagnantMedicine) {
  const batchTotal = normalizeBatches(medicine.batch_details).reduce(
    (sum, batch) => sum + Number(batch.quantity || 0),
    0,
  );
  return (
    batchTotal ||
    Number(medicine.total_quantity || medicine.quantity_available || 0)
  );
}

function getMedicineName(
  medicine: Pick<StagnantMedicine, "product_name" | "medicine_name">,
) {
  return medicine.product_name || medicine.medicine_name || "";
}

function getStoredRemaining(medicine: StagnantMedicine) {
  return Math.max(
    0,
    Number(
      medicine.remaining_quantity ??
        getTotalQuantity(medicine) - Number(medicine.dispensed_quantity || 0),
    ),
  );
}

async function saveWithMissingColumnRetry(
  table: "stagnant_medicines" | "stagnant_medicine_dispenses",
  payload: Record<string, unknown>,
  id?: string,
) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const query = id
      ? supabase.from(table).update(next).eq("id", id).select("id").single()
      : supabase.from(table).insert(next).select("id").single();
    const { data, error } = await query;
    if (!error) return { id: data?.id as string | undefined };
    const column = missingColumn(error.message);
    if (!column || !(column in next)) throw error;
    delete next[column];
    toast.warning(
      `عمود ${column} غير موجود في Supabase، تم تخطيه مؤقتًا. شغل ملف التحديث عشان يتسجل دائمًا.`,
    );
  }
  return { id };
}

export default function StagnantMedicines() {
  const { user, canManage } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [showDispenseModal, setShowDispenseModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  useEscapeKey(() => setShowModal(false), showModal);
  useEscapeKey(() => setShowDispenseModal(false), showDispenseModal);
  useEscapeKey(() => setShowDetailsModal(false), showDetailsModal);
  const [selectedMedicine, setSelectedMedicine] =
    useState<StagnantMedicine | null>(null);
  const [editingMedicine, setEditingMedicine] =
    useState<StagnantMedicine | null>(null);
  const [form, setForm] = useState(blankForm);
  const [dispenseForm, setDispenseForm] = useState(blankDispenseForm);
  const [filterBranch, setFilterBranch] = useState("");
  const [filterDoctor, setFilterDoctor] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterExpiry, setFilterExpiry] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSearchSubmitted, setCustomerSearchSubmitted] = useState("");
  const [remoteCustomerOptions, setRemoteCustomerOptions] = useState<CustomerOption[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);

  const {
    data: medicines,
    loading,
    refetch,
  } = useSupabaseQuery<StagnantMedicine>({
    table: "stagnant_medicines",
    orderBy: { column: "priority", ascending: false },
    realtimeEnabled: true,
  });
  const { data: dispenseRecords, refetch: refetchDispenses } =
    useSupabaseQuery<StagnantDispenseRecord>({
      table: "stagnant_medicine_dispenses",
      orderBy: { column: "dispensed_at", ascending: false },
      realtimeEnabled: true,
    });
  const { data: userProfiles } = useSupabaseQuery<DoctorProfile>({
    table: "user_profiles",
    orderBy: { column: "name", ascending: true },
    realtimeEnabled: true,
  });
  const { data: staffFallback } = useSupabaseQuery<StaffMember>({
    table: "staff",
    orderBy: { column: "name", ascending: true },
    realtimeEnabled: false,
  });
  const { data: customers } = useSupabaseQuery<CustomerOption>({
    table: "customers",
    limit: 10000,
    realtimeEnabled: false,
  });
  const { data: invoiceCustomers } = useSupabaseQuery<CustomerOption>({
    table: "sales_invoices",
    orderBy: { column: "invoice_date", ascending: false },
    limit: 10000,
    realtimeEnabled: false,
  });
  const { data: activityLogs } = useSupabaseQuery<ActivityLogRecord>({
    table: "activity_logs",
    orderBy: { column: "created_at", ascending: false },
    limit: 500,
    realtimeEnabled: true,
  });
  const cycle = getCurrentCycle();

  const doctors = useMemo(() => {
    // مصدر واحد للدكاترة: public.staff فقط، لتجنب تكرار الأسماء من user_profiles + staff.
    const byId = new Map<string, DoctorProfile>();
    (staffFallback || []).forEach((item) => {
      const role = String(item.role || "").toLowerCase();
      const isDoctor =
        role.includes("دكتور") ||
        role.includes("صيدلي") ||
        role.includes("صيدلاني") ||
        role.includes("doctor") ||
        role.includes("pharmacist");
      if (item.id && item.name && isDoctor && !byId.has(item.id)) {
        byId.set(item.id, {
          id: item.id,
          staff_id: item.id,
          name: item.name,
          role: item.role,
          branch: item.branch,
          branch_id: item.branch_id,
          branch_name: item.branch,
          active: true,
        });
      }
    });
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ar"),
    );
  }, [staffFallback]);

  const customerOptions = useMemo(() => {
    const byKey = new Map<string, CustomerOption>();
    for (const customer of [
      ...(invoiceCustomers || []),
      ...(customers || []),
    ]) {
      const name = customer.customer_name || customer.name || "";
      const code = cleanCustomerCode(customer.customer_code || customer.code);
      const phone = customer.customer_phone || customer.phone || "";
      const key = code || phone || name;
      if (!key || (!name && !code && !phone)) continue;
      if (
        !isAllBranches(user?.branch) &&
        customer.branch &&
        customer.branch !== user?.branch
      )
        continue;
      if (!byKey.has(key)) byKey.set(key, customer);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      String(a.customer_name || a.name || "").localeCompare(
        String(b.customer_name || b.name || ""),
        "ar",
      ),
    );
  }, [customers, invoiceCustomers, user?.branch]);

  const filteredCustomerOptions = useMemo(() => {
    const query = customerSearchSubmitted.trim();
    if (!query) return [];
    const segments = query.split("*").map(normalizeCustomerLookup).filter(Boolean);
    const normalizedQuery = normalizeCustomerLookup(query);
    const allOptions = [...remoteCustomerOptions, ...customerOptions];
    const byKey = new Map<string, CustomerOption>();
    for (const customer of allOptions) {
      const key =
        customer.customer_code ||
        customer.code ||
        customer.customer_phone ||
        customer.phone ||
        customer.customer_name ||
        customer.name ||
        customer.id ||
        Math.random().toString();
      if (!byKey.has(String(key))) byKey.set(String(key), customer);
    }
    return Array.from(byKey.values()).filter((customer) => {
      const text = customerSearchText(customer);
      if (segments.length) return segments.every((segment) => text.includes(segment));
      return text.includes(normalizedQuery);
    }).slice(0, 50);
  }, [customerOptions, customerSearchSubmitted, remoteCustomerOptions]);

  const runCustomerSearch = async () => {
    const raw = customerSearch.trim();
    setCustomerSearchSubmitted(raw);
    setRemoteCustomerOptions([]);
    if (!raw) return;

    setCustomerSearchLoading(true);
    try {
      const tokens = phoneSearchTokens(raw.replace(/\*/g, " "));
      const terms = Array.from(
        new Set([
          raw,
          raw.replace(/\*/g, " ").trim(),
          tokens.local,
          tokens.whatsapp,
          tokens.last5,
          tokens.last4,
        ]),
      ).filter(Boolean) as string[];

      const results: CustomerOption[] = [];

      const mapRecord = (row: Record<string, unknown>): CustomerOption => {
        const code = cleanCustomerCode(row.customer_code || row.code);
        const phone = String(row.customer_phone || row.phone || row.phone_number || row.mobile || "");
        const name = String(row.customer_name || row.name || row.full_name || "");
        return {
          id: String(row.id || row.customer_id || ""),
          customer_id: String(row.customer_id || row.id || ""),
          customer_name: name,
          name,
          customer_code: code,
          code,
          customer_phone: phone,
          phone,
          branch: String(row.branch || row.branch_name || ""),
        } as CustomerOption;
      };

      const searchTable = async (table: string, term: string) => {
        const columns = [
          "customer_name",
          "name",
          "full_name",
          "customer_code",
          "code",
          "customer_phone",
          "phone",
          "phone_number",
          "mobile",
        ];
        for (const column of columns) {
          const { data, error } = await supabase
            .from(table)
            .select("*")
            .ilike(column, `%${term}%`)
            .limit(40);
          if (error) {
            const message = String(error.message || "").toLowerCase();
            if (message.includes("does not exist") || message.includes("schema cache")) continue;
            continue;
          }
          results.push(...((data || []) as Record<string, unknown>[]).map(mapRecord));
        }
      };

      for (const term of terms.slice(0, 4)) {
        const result = await getCustomers({
          search: term,
          branch: isAllBranches(user?.branch) ? "الكل" : user?.branch,
          limit: 50,
          offset: 0,
        });
        results.push(
          ...result.customers.map((customer) => ({
            id: customer.id,
            customer_id: customer.id,
            customer_name: customer.name,
            name: customer.name,
            customer_code: cleanCustomerCode(customer.customer_code),
            code: cleanCustomerCode(customer.customer_code),
            customer_phone: customer.phone,
            phone: customer.phone,
            branch: customer.branch || undefined,
          } as CustomerOption)),
        );
        await searchTable("customers", term);
        await searchTable("sales_invoices", term);
      }

      const unique = new Map<string, CustomerOption>();
      for (const customer of results) {
        const key = customer.customer_code || customer.code || customer.customer_phone || customer.phone || customer.id || customer.customer_name || customer.name;
        if (key && !unique.has(String(key))) unique.set(String(key), customer);
      }
      setRemoteCustomerOptions(Array.from(unique.values()));
    } catch (error) {
      console.error("[stagnant customer search]", error);
      toast.error("تعذر البحث في كل العملاء. راجع الاتصال أو أعمدة العملاء في Supabase.");
    } finally {
      setCustomerSearchLoading(false);
    }
  };

  const selectCustomerForDispense = (customer: CustomerOption) => {
    setDispenseForm((current) => ({
      ...current,
      customer_id: customer.id || "",
      customer_name: customer.customer_name || customer.name || "",
      customer_code: customer.customer_code || customer.code || "",
      customer_phone: customer.customer_phone || customer.phone || "",
    }));
    setCustomerSearch(
      customer.customer_name ||
        customer.name ||
        customer.customer_code ||
        customer.code ||
        customer.customer_phone ||
        customer.phone ||
        "",
    );
    setCustomerSearchSubmitted("");
    setRemoteCustomerOptions([]);
  };

  const filteredMedicines = useMemo(() => {
    let filtered = (medicines || []).filter(
      (medicine) =>
        isAllBranches(user?.branch) || medicine.branch === user?.branch,
    );

    if (filterBranch) {
      filtered = filtered.filter(
        (m) => m.branch === filterBranch || m.branch_name === filterBranch,
      );
    }
    if (filterDoctor) {
      filtered = filtered.filter(
        (m) =>
          m.responsible_doctor_id === filterDoctor ||
          m.responsible_doctor_name === filterDoctor,
      );
    }
    if (filterStatus) {
      filtered = filtered.filter((m) => m.status === filterStatus);
    }
    if (filterPriority) {
      filtered = filtered.filter((m) => m.priority === filterPriority);
    }
    if (filterExpiry) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      filtered = filtered.filter((m) => {
        const rawDate = m.nearest_expiry_date || m.expiry_date;
        if (!rawDate) return false;
        const expiryDate = new Date(`${rawDate.slice(0, 10)}T12:00:00`);
        const diffDays = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / 86400000,
        );
        if (filterExpiry === "expired") return diffDays < 0;
        if (filterExpiry === "30") return diffDays >= 0 && diffDays <= 30;
        if (filterExpiry === "60") return diffDays >= 0 && diffDays <= 60;
        return true;
      });
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          (getMedicineName(m) || "").toLowerCase().includes(query) ||
          (m.product_code || "").toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [
    medicines,
    user?.branch,
    filterBranch,
    filterDoctor,
    filterStatus,
    filterPriority,
    filterExpiry,
    searchQuery,
  ]);

  const stats = useMemo(() => {
    const totalQuantity = filteredMedicines.reduce(
      (sum, medicine) =>
        sum + (medicine.total_quantity || getTotalQuantity(medicine)),
      0,
    );
    const highPriority = filteredMedicines.filter(
      (medicine) =>
        medicine.priority === "high" || medicine.priority === "عالية",
    ).length;
    const dispensed = filteredMedicines.reduce(
      (sum, medicine) =>
        sum + movementTotalForMedicine(dispenseRecords, medicine.id, cycle),
      0,
    );
    const remaining = Math.max(0, totalQuantity - dispensed);
    const achieved = filteredMedicines.filter(
      (medicine) => medicine.status === "محقق",
    ).length;
    const totalIncentive = filteredMedicines.reduce((sum, medicine) => {
      const medicineDispenses = (dispenseRecords || []).filter(
        (d) =>
          d.stagnant_medicine_id === medicine.id ||
          d.medicine_id === medicine.id,
      );
      return (
        sum +
        medicineDispenses.reduce((s, d) => s + (d.total_incentive || 0), 0)
      );
    }, 0);
    return {
      totalQuantity,
      highPriority,
      dispensed,
      remaining,
      achieved,
      totalIncentive,
    };
  }, [cycle, dispenseRecords, filteredMedicines]);

  const doctorTotals = useMemo(
    () => groupDoctorTotals(dispenseRecords, cycle),
    [cycle, dispenseRecords],
  );
  const branchOptions = useMemo(() => {
    const branches = new Set<string>();
    [
      ...(medicines || []).map((item) => item.branch_name || item.branch),
      ...(doctors || []).map((item) => item.branch_name || item.branch),
    ]
      .filter(Boolean)
      .forEach((branch) => branches.add(String(branch)));
    return [...branches].sort((a, b) => a.localeCompare(b, "ar"));
  }, [doctors, medicines]);
  const canCreateStagnant =
    canManage || user?.permissions?.create_stagnant_medicine === true;
  const canEditStagnant =
    canManage || user?.permissions?.edit_stagnant_medicine === true;
  const canDeleteStagnant =
    canManage || user?.permissions?.delete_stagnant_medicine === true;
  const canDispenseStagnant =
    canManage ||
    user?.permissions?.dispense_stagnant_medicine === true ||
    ["دكتور", "صيدلاني", "دكتور صيدلي"].includes(user?.role || "");

  const resetModal = () => {
    setShowModal(false);
    setEditingMedicine(null);
    setForm(blankForm);
  };

  const resetDispenseModal = () => {
    setShowDispenseModal(false);
    setSelectedMedicine(null);
    setDispenseForm(blankDispenseForm);
    setCustomerSearch("");
    setCustomerSearchSubmitted("");
  };

  const openDispenseModal = (medicine: StagnantMedicine) => {
    setSelectedMedicine(medicine);
    setDispenseForm({
      ...blankDispenseForm,
      doctor_id: medicine.responsible_doctor_id || "",
      doctor_name:
        medicine.responsible_doctor_name || medicine.responsible_doctor || "",
      product_expiry_date:
        medicine.nearest_expiry_date || medicine.expiry_date || "",
      incentive_per_unit: Number(medicine.incentive_per_unit || 0),
    });
    setShowDispenseModal(true);
  };

  const openDetailsModal = (medicine: StagnantMedicine) => {
    setSelectedMedicine(medicine);
    setShowDetailsModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!user) {
        toast.error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
        return;
      }

      const currentUserProfile = getCurrentUserProfile();
      const batches = parseBatches(form.batches_text);
      const totalFromBatches = batches.reduce(
        (sum, batch) => sum + batch.quantity,
        0,
      );
      const selectedDoctor = doctors.find(
        (d) => d.id === form.responsible_doctor_id,
      );
      if (!form.responsible_doctor_id || !selectedDoctor) {
        toast.error("يجب اختيار الدكتور المسؤول عن تحريك الصنف");
        return;
      }
      const totalQuantity =
        totalFromBatches || Number(form.quantity_available || 0);
      const dispensedQuantity = Number(form.dispensed_quantity || 0);
      if (!form.medicine_name.trim()) {
        toast.error("اسم الصنف مطلوب");
        return;
      }
      if (totalQuantity < dispensedQuantity) {
        toast.error("لا يمكن جعل الكمية الإجمالية أقل من الكمية المصروفة");
        return;
      }
      if (
        editingMedicine &&
        totalQuantity < Number(editingMedicine.dispensed_quantity || 0)
      ) {
        toast.error(
          `لا يمكن تقليل الكمية الإجمالية عن المصروف فعليًا (${editingMedicine.dispensed_quantity || 0})`,
        );
        return;
      }

      const payload = {
        product_name: form.medicine_name.trim(),
        medicine_name: form.medicine_name,
        product_code: form.product_code || null,
        usage: form.usage || null,
        category: form.usage || null,
        product_type: form.product_type || null,
        expiry_date: form.expiry_date || batches[0]?.expiry_date || null,
        quantity_available: totalQuantity,
        product_price: Number(form.product_price || 0),
        unit_price: Number(form.product_price || 0),
        total_quantity: totalQuantity,
        batch_details: batches,
        responsible_doctor: selectedDoctor.name,
        responsible_doctor_id: selectedDoctor.id,
        responsible_doctor_name: selectedDoctor.name,
        dispensed_quantity: dispensedQuantity,
        remaining_quantity: Math.max(0, totalQuantity - dispensedQuantity),
        target_min_percent: Number(form.target_min_percent || 0),
        minimum_remaining_percent: Number(form.target_min_percent || 0),
        target_min_quantity: Math.ceil(
          (totalQuantity * Number(form.target_min_percent || 0)) / 100,
        ),
        last_dispensed_at: form.last_dispensed_at || null,
        source_file_date:
          form.source_file_date || new Date().toISOString().split("T")[0],
        stagnant_file_date:
          form.source_file_date || new Date().toISOString().split("T")[0],
        nearest_expiry_date:
          form.expiry_date || batches[0]?.expiry_date || null,
        incentive_per_unit: Number(form.incentive_per_unit || 0),
        status: form.status || "نشط",
        priority: form.priority,
        notes: form.notes || null,
        branch: user?.branch || "الكل",
        branch_id: selectedDoctor?.branch_id || null,
        branch_name:
          selectedDoctor?.branch_name ||
          selectedDoctor?.branch ||
          user?.branch ||
          "الكل",
        ...(!editingMedicine ? { created_by: currentUserProfile.id } : {}),
        updated_at: new Date().toISOString(),
      };

      const saved = await saveWithMissingColumnRetry(
        "stagnant_medicines",
        payload,
        editingMedicine?.id,
      );

      toast.success(
        editingMedicine
          ? "تم تحديث الصنف الراكد بنجاح"
          : "تم إضافة الصنف الراكد بنجاح",
      );
      await writeActivityLog({
        user_id: currentUserProfile.id,
        user_name: currentUserProfile.name,
        user_role: currentUserProfile.role,
        action: editingMedicine ? "تعديل صنف راكد" : "إضافة صنف راكد",
        module: "الأدوية الرواكد",
        target_type: "stagnant_medicine",
        target_id: editingMedicine?.id || saved?.id || null,
        branch_name: payload.branch_name,
        old_value: editingMedicine
          ? {
              product_name: getMedicineName(editingMedicine),
              responsible_doctor_id: editingMedicine.responsible_doctor_id,
              total_quantity:
                editingMedicine.total_quantity ||
                getTotalQuantity(editingMedicine),
              dispensed_quantity: editingMedicine.dispensed_quantity || 0,
              incentive_per_unit: editingMedicine.incentive_per_unit || 0,
            }
          : null,
        new_value: payload,
        details: {
          target_title: form.medicine_name,
          summary: editingMedicine
            ? "تم تعديل بيانات صنف راكد"
            : "تم إضافة صنف راكد جديد",
        },
        route_path: `/stagnant-medicines?id=${editingMedicine?.id || saved?.id || ""}`,
      });

      resetModal();
      refetch();
    } catch (error) {
      toast.error(`حدث خطأ: ${(error as Error).message}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`هل أنت متأكد من حذف ${name}؟`)) return;

    try {
      if (!user) {
        toast.error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
        return;
      }

      const currentUserProfile = getCurrentUserProfile();
      const deletedMedicine = medicines.find((item) => item.id === id);
      const { error } = await supabase
        .from("stagnant_medicines")
        .delete()
        .eq("id", id);
      if (error) throw error;

      toast.success("تم حذف الصنف بنجاح");
      await writeActivityLog({
        user_id: currentUserProfile.id,
        user_name: currentUserProfile.name,
        user_role: currentUserProfile.role,
        action: "حذف صنف راكد",
        module: "الأدوية الرواكد",
        target_type: "stagnant_medicine",
        target_id: id,
        branch_name:
          deletedMedicine?.branch_name ||
          deletedMedicine?.branch ||
          user?.branch ||
          "",
        old_value: deletedMedicine
          ? { ...deletedMedicine }
          : { product_name: name },
        new_value: null,
        details: { target_title: name, summary: "تم حذف صنف راكد" },
        route_path: `/stagnant-medicines?id=${id}`,
      });
      refetch();
    } catch (error) {
      toast.error(`حدث خطأ: ${(error as Error).message}`);
    }
  };

  const handleEdit = (medicine: StagnantMedicine) => {
    setEditingMedicine(medicine);
    setForm({
      medicine_name: getMedicineName(medicine),
      product_code: medicine.product_code || "",
      usage: medicine.usage || "",
      product_type: medicine.product_type || "",
      expiry_date: medicine.expiry_date || medicine.nearest_expiry_date || "",
      quantity_available: Number(
        medicine.quantity_available || medicine.total_quantity || 0,
      ),
      product_price: Number(medicine.product_price || medicine.unit_price || 0),
      batches_text: batchesToText(
        medicine.batch_details,
        medicine.quantity_available,
        medicine.expiry_date,
      ),
      responsible_doctor_id: medicine.responsible_doctor_id || "",
      responsible_doctor_name:
        medicine.responsible_doctor_name || medicine.responsible_doctor || "",
      responsible_doctor: medicine.responsible_doctor || "",
      dispensed_quantity: Number(medicine.dispensed_quantity || 0),
      target_min_percent: Number(
        medicine.target_min_percent || medicine.minimum_remaining_percent || 0,
      ),
      last_dispensed_at: (
        medicine.last_dispensed_at ||
        medicine.last_dispense_date ||
        ""
      ).split("T")[0],
      source_file_date:
        medicine.source_file_date ||
        medicine.stagnant_file_date ||
        medicine.upload_date ||
        new Date().toISOString().split("T")[0],
      priority: medicine.priority || "medium",
      incentive_per_unit: Number(medicine.incentive_per_unit || 0),
      status: medicine.status || "نشط",
      notes: medicine.notes || "",
    });
    setShowModal(true);
  };

  const handleRecordDispense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicine || !user) return;

    const quantity = Number(dispenseForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("أدخل كمية صحيحة");
      return;
    }

    const remaining = getStoredRemaining(selectedMedicine);

    if (quantity > remaining) {
      toast.error(`لا يمكن صرف كمية أكبر من المتبقي (${remaining})`);
      return;
    }

    if (
      !dispenseForm.customer_name.trim() &&
      !dispenseForm.customer_code.trim() &&
      !dispenseForm.customer_phone.trim()
    ) {
      toast.error("يجب اختيار العميل قبل تسجيل الصرف");
      return;
    }

    const selectedDoctor = doctors.find((d) => d.id === dispenseForm.doctor_id);
    const doctorName = selectedDoctor?.name || dispenseForm.doctor_name;
    if (!dispenseForm.doctor_id || !doctorName) {
      toast.error("يجب اختيار الدكتور الذي صرف الصنف");
      return;
    }
    const incentivePerUnit = Number(
      dispenseForm.incentive_per_unit ??
        selectedMedicine.incentive_per_unit ??
        0,
    );
    const totalIncentive = quantity * incentivePerUnit;
    const dispensedAt = dispenseForm.dispensed_at
      ? new Date(dispenseForm.dispensed_at).toISOString()
      : new Date().toISOString();
    const productName = getMedicineName(selectedMedicine);

    const currentUserProfile = getCurrentUserProfile();
    const payload = {
      stagnant_medicine_id: selectedMedicine.id,
      product_name: productName,
      product_code: selectedMedicine.product_code || null,
      doctor_id: dispenseForm.doctor_id,
      doctor_name: doctorName,
      branch_id:
        selectedDoctor?.branch_id || selectedMedicine.branch_id || null,
      branch_name:
        selectedDoctor?.branch_name ||
        selectedDoctor?.branch ||
        selectedMedicine.branch_name ||
        selectedMedicine.branch ||
        user.branch ||
        "",
      quantity,
      incentive_per_unit: incentivePerUnit,
      total_incentive: totalIncentive,
      product_expiry_date:
        dispenseForm.product_expiry_date ||
        selectedMedicine.nearest_expiry_date ||
        selectedMedicine.expiry_date ||
        null,
      dispensed_at: dispensedAt,
      customer_id: dispenseForm.customer_id || null,
      customer_name: dispenseForm.customer_name || null,
      customer_code: dispenseForm.customer_code || null,
      customer_phone: dispenseForm.customer_phone || null,
      invoice_no: dispenseForm.invoice_no || null,
      notes: dispenseForm.notes || null,
      created_by: currentUserProfile.id,
    };

    let insertedDispense: { id?: string } | null = null;
    try {
      insertedDispense = await saveWithMissingColumnRetry(
        "stagnant_medicine_dispenses",
        payload,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      return;
    }

    // Update medicine record
    const nextDispensedQuantity =
      Number(selectedMedicine.dispensed_quantity || 0) + quantity;
    const nextRemainingQuantity = Math.max(
      0,
      getTotalQuantity(selectedMedicine) - nextDispensedQuantity,
    );
    const { error: updateError } = await supabase
      .from("stagnant_medicines")
      .update({
        dispensed_quantity: nextDispensedQuantity,
        remaining_quantity: nextRemainingQuantity,
        last_dispense_date: dispensedAt.split("T")[0],
        status: nextRemainingQuantity <= 0 ? "محقق" : selectedMedicine.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedMedicine.id);
    if (updateError) {
      toast.warning(
        `تم تسجيل الصرف، لكن تحديث كميات الصنف لم يكتمل: ${updateError.message}`,
      );
    }

    // Log activity
    await writeActivityLog({
      user_id: currentUserProfile.id,
      user_name: currentUserProfile.name,
      user_role: currentUserProfile.role,
      action: "تسجيل صرف صنف راكد",
      module: "الأدوية الرواكد",
      target_type: "stagnant_medicine_dispense",
      target_id: insertedDispense?.id || selectedMedicine.id,
      branch_name: payload.branch_name,
      old_value: {
        remaining_quantity: remaining,
        dispensed_quantity: selectedMedicine.dispensed_quantity || 0,
      },
      new_value: {
        ...payload,
        dispensed_quantity: nextDispensedQuantity,
        remaining_quantity: nextRemainingQuantity,
      },
      details: {
        target_title: productName,
        summary: `${quantity} × ${productName} - ${doctorName}`,
        stagnant_medicine_id: selectedMedicine.id,
      },
      route_path: `/stagnant-medicines?id=${selectedMedicine.id}`,
    });

    // Add points if incentive > 0
    if (totalIncentive > 0 && dispenseForm.doctor_id) {
      try {
        const pointsResult = await persistPointsTransaction({
          employeeId: dispenseForm.doctor_id,
          employeeName: doctorName,
          branch:
            selectedMedicine.branch_name ||
            selectedMedicine.branch ||
            user.branch ||
            "",
          branchId: selectedMedicine.branch_id,
          operation: "bonus",
          rule: null,
          pointsToStore: totalIncentive,
          userNote: `حافز صرف صنف راكد: ${productName}`,
          createdByName: currentUserProfile.name,
          createdById: currentUserProfile.id,
          createdByRole: currentUserProfile.role,
          status: "approved",
          cycle,
          sourceModule: "stagnant_medicines",
          source: "stagnant_medicine_dispense",
          sourceRecordId: insertedDispense?.id || selectedMedicine.id,
          reasonLabel: `حافز صرف صنف راكد: ${productName}`,
          description: `صرف ${quantity} وحدة من ${productName}`,
        });
        if (pointsResult.error) {
          toast.warning(
            `تم تسجيل الصرف، لكن لم يتم تسجيل النقاط: ${pointsResult.error}`,
          );
        } else {
          toast.success(`تم تسجيل الصرف وإضافة ${totalIncentive} نقطة للدكتور`);
        }
      } catch (e) {
        console.warn("Failed to add points for dispense:", e);
      }
    } else {
      toast.success("تم تسجيل صرف الصنف الراكد");
    }

    resetDispenseModal();
    refetch();
    refetchDispenses();
  };

  const getPriorityColor = (priority?: string | null) => {
    switch (priority) {
      case "high":
      case "عالية":
        return "bg-red-500/15 text-red-300 border-red-500/25";
      case "medium":
      case "متوسطة":
        return "bg-amber-500/15 text-amber-300 border-amber-500/25";
      case "low":
      case "منخفضة":
        return "bg-green-500/15 text-green-300 border-green-500/25";
      default:
        return "bg-slate-500/15 text-slate-300 border-slate-500/20";
    }
  };

  const getPriorityLabel = (priority?: string | null) => {
    switch (priority) {
      case "high":
      case "عالية":
        return "عالية";
      case "medium":
      case "متوسطة":
        return "متوسطة";
      case "low":
      case "منخفضة":
        return "منخفضة";
      default:
        return "غير محدد";
    }
  };

  const getStatusColor = (status?: string | null) => {
    switch (status) {
      case "نشط":
        return "bg-teal-500/15 text-teal-300 border-teal-500/25";
      case "محقق":
        return "bg-green-500/15 text-green-300 border-green-500/25";
      case "متوقف":
        return "bg-slate-500/15 text-slate-300 border-slate-500/25";
      case "انتهى":
        return "bg-red-500/15 text-red-300 border-red-500/25";
      default:
        return "bg-slate-500/15 text-slate-300 border-slate-500/20";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 flex items-center justify-center text-amber-400">
            <Package size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">الأدوية الرواكد</h2>
            <p className="text-slate-400 text-sm mt-1">
              قائمة يومية للأصناف المطلوب تحريكها قبل انتهاء الصلاحية
            </p>
          </div>
        </div>
        {canCreateStagnant && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> إضافة صنف
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <div className="stat-card">
          <div className="text-slate-400 text-xs mb-2">إجمالي الأصناف</div>
          <div className="text-white font-bold text-2xl num">
            {filteredMedicines.length}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-slate-400 text-xs mb-2">إجمالي الكمية</div>
          <div className="text-white font-bold text-2xl num">
            {stats.totalQuantity}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-slate-400 text-xs mb-2">تم صرفه</div>
          <div className="text-teal-300 font-bold text-2xl num">
            {stats.dispensed}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-slate-400 text-xs mb-2">باقي</div>
          <div className="text-red-300 font-bold text-2xl num">
            {stats.remaining}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-slate-400 text-xs mb-2">أولوية عالية</div>
          <div className="text-amber-300 font-bold text-2xl num">
            {stats.highPriority}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-slate-400 text-xs mb-2">إجمالي الحوافز</div>
          <div className="text-teal-300 font-bold text-2xl num">
            {stats.totalIncentive.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="stat-card">
        <div className="section-title text-sm mb-3">
          تقرير صرف الرواكد حسب الدكتور - {cycle.shortLabel}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {doctorTotals.length ? (
            doctorTotals.map((item) => (
              <div key={item.doctor} className="bg-white/5 rounded-xl p-3">
                <div className="text-white font-bold text-sm">
                  {item.doctor}
                </div>
                <div className="text-slate-400 text-xs mt-1">
                  {item.count} سجل صرف
                </div>
                <div className="text-teal-300 font-bold num mt-2">
                  {item.quantity} علبة
                </div>
              </div>
            ))
          ) : (
            <div className="text-slate-400 text-sm">
              لا توجد سجلات صرف في الدورة الحالية.
            </div>
          )}
        </div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 text-slate-300 text-sm">
            <Filter size={16} /> الفلاتر
          </div>
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              placeholder="بحث باسم الصنف أو الكود..."
              className="input-dark text-sm flex-1"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="input-dark text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">كل الحالات</option>
              <option value="نشط">نشط</option>
              <option value="محقق">محقق</option>
              <option value="متوقف">متوقف</option>
              <option value="انتهى">انتهى</option>
            </select>
            <select
              className="input-dark text-sm"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="">كل الأولويات</option>
              <option value="عالية">عالية</option>
              <option value="متوسطة">متوسطة</option>
              <option value="منخفضة">منخفضة</option>
            </select>
            <select
              className="input-dark text-sm"
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
            >
              <option value="">كل الفروع</option>
              {branchOptions.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
            <select
              className="input-dark text-sm"
              value={filterDoctor}
              onChange={(e) => setFilterDoctor(e.target.value)}
            >
              <option value="">كل الدكاترة</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} - {d.branch_name || d.branch || "بدون فرع"} -{" "}
                  {d.role || "بدون دور"}
                </option>
              ))}
            </select>
            <select
              className="input-dark text-sm"
              value={filterExpiry}
              onChange={(e) => setFilterExpiry(e.target.value)}
            >
              <option value="">كل تواريخ الانتهاء</option>
              <option value="30">ينتهي خلال 30 يوم</option>
              <option value="60">ينتهي خلال 60 يوم</option>
              <option value="expired">منتهي</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 text-sm text-slate-300">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="text-amber-400 flex-shrink-0 mt-0.5"
            size={18}
          />
          <div>
            <div className="font-semibold text-amber-200 mb-1">تنبيه مهم</div>
            <p>
              حدّث هذه القائمة يوميًا من ملف الرواكد. لو الصنف له أكثر من تاريخ
              انتهاء، سجّل كل دفعة بكمية منفصلة عشان الدكتور يعرف يركز على
              الأقرب انتهاءً.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="stat-card text-center py-10 text-slate-400">
          جاري التحميل...
        </div>
      ) : filteredMedicines.length === 0 ? (
        <div className="stat-card text-center py-10 text-slate-400">
          لا توجد أدوية رواكد حاليًا
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredMedicines.map((medicine) => {
            const batches = normalizeBatches(medicine.batch_details);
            const dispensedInCycle = movementTotalForMedicine(
              dispenseRecords,
              medicine.id,
              cycle,
            );
            const total = getTotalQuantity(medicine);
            const storedRemaining = getStoredRemaining(medicine);
            const target = {
              id: medicine.id,
              name: getMedicineName(medicine),
              totalQuantity: total,
              targetMinPercent: medicine.target_min_percent,
            };
            const required =
              medicine.target_min_quantity || requiredQuantity(target);
            const achieved = targetAchieved(target, dispensedInCycle);
            return (
              <div
                key={medicine.id}
                className="stat-card hover:border-amber-500/30 transition-colors cursor-pointer"
                onClick={() => openDetailsModal(medicine)}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex-1">
                    <div className="text-white font-bold text-base">
                      {getMedicineName(medicine)}
                    </div>
                    <div className="text-slate-400 text-xs mt-1">
                      {medicine.usage ||
                        medicine.category ||
                        medicine.product_type ||
                        "استخدام غير محدد"}
                    </div>
                    {medicine.product_code && (
                      <div className="text-slate-500 text-xs mt-1">
                        كود: {medicine.product_code}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <span
                      className={`text-xs px-2 py-1 rounded border ${getPriorityColor(medicine.priority)}`}
                    >
                      {getPriorityLabel(medicine.priority)}
                    </span>
                    {medicine.status && (
                      <span
                        className={`text-xs px-2 py-1 rounded border ${getStatusColor(medicine.status)}`}
                      >
                        {medicine.status}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">إجمالي الكمية</div>
                    <div className="text-white font-bold num mt-1">{total}</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">
                      المسؤول عن التحريك
                    </div>
                    <div className="text-white font-semibold mt-1">
                      {medicine.responsible_doctor_name ||
                        medicine.responsible_doctor ||
                        "غير محدد"}
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">تم صرفه</div>
                    <div className="text-teal-300 font-bold num mt-1">
                      {medicine.dispensed_quantity ?? dispensedInCycle}
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">المتبقي</div>
                    <div
                      className={`font-bold num mt-1 ${storedRemaining <= 0 ? "text-green-300" : "text-red-300"}`}
                    >
                      {storedRemaining}
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">أقرب انتهاء</div>
                    <div className="text-white mt-1">
                      {medicine.nearest_expiry_date ||
                        medicine.expiry_date ||
                        "غير محدد"}
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">حافز الوحدة</div>
                    <div className="text-teal-300 font-bold num mt-1">
                      {medicine.incentive_per_unit || 0} ج
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-slate-400 text-xs">سعر الصنف</div>
                    <div className="text-white font-bold num mt-1">
                      {Number(medicine.product_price || medicine.unit_price || 0).toLocaleString("ar-EG")} ج
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-white/5 rounded-xl p-2">
                    <div className="text-slate-400">إجمالي الحافز</div>
                    <div className="text-teal-300 font-bold num">
                      {(
                        storedRemaining * (medicine.incentive_per_unit || 0)
                      ).toFixed(0)}{" "}
                      ج
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-2">
                    <div className="text-slate-400">تارجت الصنف</div>
                    <div className="text-white font-bold num">
                      {required || "—"}
                    </div>
                  </div>
                  <div
                    className={`rounded-xl p-2 ${medicine.status === "محقق" || achieved ? "bg-teal-500/10 text-teal-300" : "bg-amber-500/10 text-amber-200"}`}
                  >
                    <div className="text-xs opacity-80">الحالة</div>
                    <div className="font-bold">
                      {medicine.status || (achieved ? "محقق" : "ناقص")}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center gap-2 text-slate-300 text-sm mb-2">
                    <Calendar size={15} /> تواريخ الانتهاء والدفعات
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {batches.length ? (
                      batches.map((batch, index) => (
                        <span
                          key={`${batch.expiry_date}-${index}`}
                          className="bg-amber-500/10 text-amber-200 border border-amber-500/20 rounded-lg px-3 py-1 text-xs"
                        >
                          {batch.quantity} علبة - {batch.expiry_date}
                        </span>
                      ))
                    ) : (
                      <span className="bg-white/5 text-slate-300 rounded-lg px-3 py-1 text-xs">
                        {medicine.quantity_available || 0} علبة -{" "}
                        {medicine.expiry_date || "بدون تاريخ"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 mt-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Package size={13} /> {medicine.branch || "كل الفروع"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ClipboardList size={13} /> تحديث:{" "}
                    {medicine.source_file_date ||
                      medicine.upload_date ||
                      "غير محدد"}
                  </span>
                </div>

                {medicine.notes && (
                  <div className="mt-3 p-3 bg-white/5 rounded-xl text-xs text-slate-300 leading-6">
                    {medicine.notes}
                  </div>
                )}

                {(canDispenseStagnant ||
                  canEditStagnant ||
                  canDeleteStagnant) && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-white/5">
                    {canDispenseStagnant && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDispenseModal(medicine);
                        }}
                        className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-1"
                      >
                        <Package size={14} /> تسجيل صرف
                      </button>
                    )}
                    {canEditStagnant && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(medicine);
                        }}
                        className="flex-1 btn-secondary text-sm py-2 flex items-center justify-center gap-1"
                      >
                        <Edit size={14} /> تعديل
                      </button>
                    )}
                    {canDeleteStagnant && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(medicine.id, getMedicineName(medicine));
                        }}
                        className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm py-2 flex items-center justify-center gap-1 transition-colors"
                      >
                        <Trash2 size={14} /> حذف
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4">
              {editingMedicine ? "تعديل صنف راكد" : "إضافة صنف راكد"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    اسم الصنف *
                  </label>
                  <input
                    className="input-dark"
                    value={form.medicine_name}
                    onChange={(e) =>
                      setForm({ ...form, medicine_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    كود الصنف
                  </label>
                  <input
                    className="input-dark"
                    value={form.product_code}
                    onChange={(e) =>
                      setForm({ ...form, product_code: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    الاستخدام / الفئة
                  </label>
                  <input
                    className="input-dark"
                    placeholder="معدة، تخسيس، مضاد حيوي..."
                    value={form.usage}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        usage: e.target.value,
                        product_type: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    الدكتور المسؤول *
                  </label>
                  <input
                    className="input-dark mb-2"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="ابحث بالاسم أو الكود أو الهاتف، ويمكن استخدام *"
                  />
                  <select
                    className="input-dark"
                    value={form.responsible_doctor_id}
                    onChange={(e) => {
                      const selectedDoctor = doctors.find(
                        (d) => d.id === e.target.value,
                      );
                      setForm({
                        ...form,
                        responsible_doctor_id: e.target.value,
                        responsible_doctor_name: selectedDoctor?.name || "",
                        responsible_doctor: selectedDoctor?.name || "",
                      });
                    }}
                    required
                  >
                    <option value="">اختر الدكتور المسؤول</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} - {d.branch_name || d.branch || "بدون فرع"} -{" "}
                        {d.role || "بدون دور"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    تاريخ ملف الرواكد
                  </label>
                  <input
                    className="input-dark"
                    type="date"
                    value={form.source_file_date}
                    onChange={(e) =>
                      setForm({ ...form, source_file_date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    الكمية الإجمالية *
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    value={form.quantity_available}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        quantity_available: Number(e.target.value),
                      })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    سعر الصنف
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.product_price}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        product_price: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    أقرب تاريخ انتهاء
                  </label>
                  <input
                    className="input-dark"
                    type="date"
                    value={form.expiry_date}
                    onChange={(e) =>
                      setForm({ ...form, expiry_date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    تم صرفه للعملاء
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    value={form.dispensed_quantity}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        dispensed_quantity: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    نسبة الحد الأدنى %
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    max={100}
                    value={form.target_min_percent}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        target_min_percent: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    حافز الوحدة (ج)
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.incentive_per_unit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        incentive_per_unit: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    الحالة
                  </label>
                  <select
                    className="input-dark"
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value })
                    }
                  >
                    <option value="نشط">نشط</option>
                    <option value="محقق">محقق</option>
                    <option value="متوقف">متوقف</option>
                    <option value="انتهى">انتهى</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-300 text-sm block mb-1">
                  دفعات الانتهاء
                </label>
                <textarea
                  className="input-dark resize-none"
                  rows={4}
                  placeholder={
                    "اكتب كل دفعة في سطر: الكمية | تاريخ الانتهاء\nمثال:\n1 | 2026-06-30\n2 | 2026-09-30\n2 | 2026-11-30"
                  }
                  value={form.batches_text}
                  onChange={(e) =>
                    setForm({ ...form, batches_text: e.target.value })
                  }
                />
                <p className="text-slate-500 text-xs mt-1">
                  لو ملأت الدفعات، سيتم حساب إجمالي الكمية منها تلقائيًا.
                </p>
              </div>

              <div>
                <label className="text-slate-300 text-sm block mb-1">
                  الأولوية
                </label>
                <select
                  className="input-dark"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                >
                  <option value="low">منخفضة</option>
                  <option value="medium">متوسطة</option>
                  <option value="high">عالية</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 text-sm block mb-1">
                  سجل الصرف أو ملاحظات المتابعة
                </label>
                <textarea
                  className="input-dark resize-none"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetModal}
                  className="flex-1 btn-secondary"
                >
                  إلغاء
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  {editingMedicine ? "تحديث" : "إضافة"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDispenseModal && selectedMedicine && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4">
              تسجيل صرف صنف راكد
            </h3>

            <div className="bg-white/5 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">اسم الصنف:</span>
                <span className="text-white font-semibold">
                  {getMedicineName(selectedMedicine)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">الدكتور المسؤول:</span>
                <span className="text-white">
                  {selectedMedicine.responsible_doctor_name ||
                    selectedMedicine.responsible_doctor ||
                    "غير محدد"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">الكمية المتبقية:</span>
                <span className="text-teal-300 font-bold num">
                  {getStoredRemaining(selectedMedicine)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">تاريخ انتهاء الصنف:</span>
                <span className="text-white">
                  {selectedMedicine.nearest_expiry_date ||
                    selectedMedicine.expiry_date ||
                    "غير محدد"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">حافز الوحدة:</span>
                <span className="text-teal-300 font-bold num">
                  {selectedMedicine.incentive_per_unit || 0} ج
                </span>
              </div>
            </div>

            <form onSubmit={handleRecordDispense} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    الدكتور الذي صرف الصنف *
                  </label>
                  <select
                    className="input-dark"
                    value={dispenseForm.doctor_id}
                    onChange={(e) => {
                      const selectedDoctor = doctors.find(
                        (d) => d.id === e.target.value,
                      );
                      setDispenseForm({
                        ...dispenseForm,
                        doctor_id: e.target.value,
                        doctor_name: selectedDoctor?.name || "",
                      });
                    }}
                    required
                  >
                    <option value="">اختر الدكتور</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} - {d.branch_name || d.branch || "بدون فرع"} -{" "}
                        {d.role || "بدون دور"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    الكمية المصروفة *
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={1}
                    value={dispenseForm.quantity}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        quantity: Number(e.target.value),
                      })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    تاريخ الصرف
                  </label>
                  <input
                    className="input-dark"
                    type="date"
                    value={dispenseForm.dispensed_at}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        dispensed_at: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    تاريخ انتهاء الصنف
                  </label>
                  <input
                    className="input-dark"
                    type="date"
                    value={dispenseForm.product_expiry_date}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        product_expiry_date: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    حافز الوحدة
                  </label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    step={0.01}
                    value={dispenseForm.incentive_per_unit}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        incentive_per_unit: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    اسم العميل
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      className="input-dark flex-1"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          runCustomerSearch();
                        }
                      }}
                      placeholder="ابحث باسم العميل أو الكود أو الهاتف"
                    />
                    <button
                      type="button"
                      className="btn-secondary px-4 shrink-0 flex items-center gap-2"
                      onClick={runCustomerSearch}
                    >
                      <Search size={16} />
                      بحث
                    </button>
                  </div>
                  {customerSearchSubmitted && (
                    <div className="rounded-xl border border-[#2d4063] bg-[#14233f] overflow-hidden">
                      {customerSearchLoading ? (
                        <div className="text-slate-400 text-xs px-3 py-3">جاري البحث في كل العملاء...</div>
                      ) : filteredCustomerOptions.length === 0 ? (
                        <div className="text-slate-400 text-xs px-3 py-3">
                          لا توجد نتائج مطابقة من العملاء أو التحليل أو الفواتير.
                        </div>
                      ) : (
                        <div className="max-h-44 overflow-y-auto divide-y divide-[#2d4063]/60">
                          {filteredCustomerOptions.map((customer) => {
                            const name =
                              customer.customer_name || customer.name || "";
                            const code =
                              customer.customer_code || customer.code || "";
                            const phone =
                              customer.customer_phone || customer.phone || "";
                            const selected =
                              dispenseForm.customer_name === name &&
                              dispenseForm.customer_code === code &&
                              dispenseForm.customer_phone === phone;
                            return (
                              <button
                                type="button"
                                key={`${code || "no-code"}-${phone || "no-phone"}-${name || "no-name"}`}
                                className={`w-full text-right px-3 py-2 text-xs hover:bg-white/5 ${
                                  selected ? "bg-teal-500/10 text-teal-200" : "text-slate-200"
                                }`}
                                onClick={() => selectCustomerForDispense(customer)}
                              >
                                <div className="font-semibold truncate">
                                  {name || "عميل بدون اسم"}
                                </div>
                                <div className="text-slate-400 mt-1 truncate">
                                  {(code || "بدون كود") + " - " + (phone || "بدون هاتف")}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    كود العميل
                  </label>
                  <input
                    className="input-dark"
                    value={dispenseForm.customer_code}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        customer_code: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    className="input-dark"
                    value={dispenseForm.customer_phone}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        customer_phone: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    رقم الفاتورة
                  </label>
                  <input
                    className="input-dark"
                    value={dispenseForm.invoice_no}
                    onChange={(e) =>
                      setDispenseForm({
                        ...dispenseForm,
                        invoice_no: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 text-sm block mb-1">
                  ملاحظات
                </label>
                <textarea
                  className="input-dark resize-none"
                  rows={3}
                  value={dispenseForm.notes}
                  onChange={(e) =>
                    setDispenseForm({ ...dispenseForm, notes: e.target.value })
                  }
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetDispenseModal}
                  className="flex-1 btn-secondary"
                >
                  إلغاء
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  تسجيل الصرف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetailsModal && selectedMedicine && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">
                تفاصيل الصنف الراكد
              </h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">بيانات الصنف</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">اسم الصنف:</span>
                    <span className="text-white">
                      {getMedicineName(selectedMedicine)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">كود الصنف:</span>
                    <span className="text-white">
                      {selectedMedicine.product_code || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">الاستخدام/الفئة:</span>
                    <span className="text-white">
                      {selectedMedicine.usage ||
                        selectedMedicine.category ||
                        selectedMedicine.product_type ||
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">الفرع:</span>
                    <span className="text-white">
                      {selectedMedicine.branch_name ||
                        selectedMedicine.branch ||
                        "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">
                  الدكتور المسؤول
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">الاسم:</span>
                    <span className="text-white">
                      {selectedMedicine.responsible_doctor_name ||
                        selectedMedicine.responsible_doctor ||
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">المعرف:</span>
                    <span className="text-slate-500 text-xs">
                      {selectedMedicine.responsible_doctor_id || "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">الكميات</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">إجمالي الكمية:</span>
                    <span className="text-white font-bold num">
                      {getTotalQuantity(selectedMedicine)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">تم صرفه:</span>
                    <span className="text-teal-300 font-bold num">
                      {selectedMedicine.dispensed_quantity ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">المتبقي:</span>
                    <span
                      className={`font-bold num ${getStoredRemaining(selectedMedicine) <= 0 ? "text-green-300" : "text-red-300"}`}
                    >
                      {getStoredRemaining(selectedMedicine)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">التواريخ</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">أقرب انتهاء:</span>
                    <span className="text-white">
                      {selectedMedicine.nearest_expiry_date ||
                        selectedMedicine.expiry_date ||
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">آخر صرف:</span>
                    <span className="text-white">
                      {selectedMedicine.last_dispense_date ||
                      selectedMedicine.last_dispensed_at
                        ? new Date(
                            selectedMedicine.last_dispense_date ||
                              selectedMedicine.last_dispensed_at,
                          ).toLocaleDateString("ar-EG")
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">تاريخ ملف الرواكد:</span>
                    <span className="text-white">
                      {selectedMedicine.stagnant_file_date ||
                        selectedMedicine.source_file_date ||
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">آخر تحديث:</span>
                    <span className="text-white">
                      {selectedMedicine.updated_at
                        ? new Date(
                            selectedMedicine.updated_at,
                          ).toLocaleDateString("ar-EG")
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">الحوافز</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">حافز الوحدة:</span>
                    <span className="text-teal-300 font-bold num">
                      {selectedMedicine.incentive_per_unit || 0} ج
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      إجمالي الحافز المتوقع:
                    </span>
                    <span className="text-teal-300 font-bold num">
                      {(
                        getStoredRemaining(selectedMedicine) *
                        (selectedMedicine.incentive_per_unit || 0)
                      ).toFixed(0)}{" "}
                      ج
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">
                  الحالة والأولوية
                </h4>
                <div className="flex gap-2">
                  <span
                    className={`text-xs px-3 py-1 rounded border ${getPriorityColor(selectedMedicine.priority)}`}
                  >
                    {getPriorityLabel(selectedMedicine.priority)}
                  </span>
                  {selectedMedicine.status && (
                    <span
                      className={`text-xs px-3 py-1 rounded border ${getStatusColor(selectedMedicine.status)}`}
                    >
                      {selectedMedicine.status}
                    </span>
                  )}
                </div>
              </div>

              {selectedMedicine.notes && (
                <div className="bg-white/5 rounded-xl p-4">
                  <h4 className="text-white font-semibold mb-3">ملاحظات</h4>
                  <p className="text-slate-300 text-sm">
                    {selectedMedicine.notes}
                  </p>
                </div>
              )}

              <div className="bg-white/5 rounded-xl p-4">
                <h4 className="text-white font-semibold mb-3">سجل الصرف</h4>
                {(() => {
                  const medicineDispenses = (dispenseRecords || []).filter(
                    (d) =>
                      d.stagnant_medicine_id === selectedMedicine.id ||
                      d.medicine_id === selectedMedicine.id,
                  );
                  if (medicineDispenses.length === 0) {
                    return (
                      <div className="text-slate-400 text-sm">
                        لا توجد سجلات صرف لهذا الصنف
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {medicineDispenses.map((record) => (
                        <div
                          key={record.id}
                          className="bg-white/5 rounded-lg p-3 text-sm"
                        >
                          <div className="flex justify-between mb-2">
                            <span className="text-white font-semibold">
                              {record.doctor_name}
                            </span>
                            <span className="text-slate-400">
                              {record.dispensed_at || record.transaction_date
                                ? new Date(
                                    record.dispensed_at ||
                                      record.transaction_date,
                                  ).toLocaleDateString("ar-EG")
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-slate-400">الصنف:</span>
                              <span className="text-white">
                                {record.product_name ||
                                  record.medicine_name ||
                                  getMedicineName(selectedMedicine)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">الكمية:</span>
                              <span className="text-teal-300 font-bold num">
                                {record.quantity}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">
                                تاريخ الانتهاء:
                              </span>
                              <span className="text-white">
                                {record.product_expiry_date ||
                                  record.expiry_date ||
                                  "—"}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">
                                حافز الوحدة:
                              </span>
                              <span className="text-teal-300 font-bold num">
                                {record.incentive_per_unit || 0} ج
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">الحافز:</span>
                              <span className="text-teal-300 font-bold num">
                                {record.total_incentive || 0} ج
                              </span>
                            </div>
                            {record.customer_name && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">العميل:</span>
                                <span className="text-white">
                                  {record.customer_name}
                                </span>
                              </div>
                            )}
                            {record.invoice_no && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">
                                  الفاتورة:
                                </span>
                                <span className="text-white">
                                  {record.invoice_no}
                                </span>
                              </div>
                            )}
                          </div>
                          {record.notes && (
                            <div className="mt-2 text-slate-400 text-xs">
                              {record.notes}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="text-white font-semibold">
                    سجل الأنشطة الخاصة بالصنف
                  </h4>
                  <Link
                    to={`/activity-log?entity=stagnant_medicine&id=${selectedMedicine.id}`}
                    className="text-teal-300 hover:text-teal-200 text-xs"
                  >
                    فتح سجل الأنشطة المرتبط
                  </Link>
                </div>
                {(() => {
                  const relatedLogs = (activityLogs || [])
                    .filter((log) => {
                      const routeMatched = String(
                        log.route_path || "",
                      ).includes(selectedMedicine.id);
                      return (
                        log.entity_id === selectedMedicine.id || routeMatched
                      );
                    })
                    .slice(0, 8);
                  if (!relatedLogs.length)
                    return (
                      <div className="text-slate-400 text-sm">
                        لا توجد أنشطة مسجلة لهذا الصنف حتى الآن.
                      </div>
                    );
                  return (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {relatedLogs.map((log) => (
                        <div
                          key={log.id}
                          className="bg-white/5 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-white font-semibold">
                              {log.operation || log.action || "نشاط"}
                            </span>
                            <span className="text-slate-400 text-xs">
                              {log.created_at
                                ? new Date(log.created_at).toLocaleString(
                                    "ar-EG",
                                  )
                                : "—"}
                            </span>
                          </div>
                          <div className="text-slate-400 text-xs mt-1">
                            {log.user_name || "النظام"} -{" "}
                            {log.branch_name ||
                              selectedMedicine.branch_name ||
                              selectedMedicine.branch ||
                              "بدون فرع"}
                          </div>
                          {log.details && (
                            <div className="text-slate-300 text-xs mt-2 leading-6">
                              {log.details}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="flex-1 btn-secondary"
                >
                  إغلاق
                </button>
                {canEditStagnant && (
                  <button
                    onClick={() => {
                      setShowDetailsModal(false);
                      handleEdit(selectedMedicine);
                    }}
                    className="flex-1 btn-primary"
                  >
                    تعديل الصنف
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
