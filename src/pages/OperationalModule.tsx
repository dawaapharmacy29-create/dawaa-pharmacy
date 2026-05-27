import { useCallback, useEffect, useMemo, useState, type ElementType } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Filter, Loader2, Plus, RefreshCw, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth, getSafeCurrentUserId } from "@/hooks/useAuth";
import { logActivity, useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { BRANCHES } from "@/lib/constants";
import { normalizeBranchName, branchMatches } from "@/lib/branch";
import { mergeStaffChoices, type StaffChoice } from "@/lib/staffFallback";
import ImageUploadBox from "@/components/ImageUploadBox";

type FieldKind = "text" | "number" | "date" | "select" | "textarea" | "staff" | "checklist" | "image";

interface ModuleField {
  key: string;
  label: string;
  kind?: FieldKind;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  staffIdKey?: string;
  checklistItems?: string[];
}

interface ModuleConfig {
  title: string;
  route: string;
  table: string;
  icon: ElementType;
  description: string;
  primaryField: string;
  statusField: string;
  branchField?: string;
  dueDateField?: string;
  staffNameField?: string;
  defaultStatus: string;
  statuses: Array<{ value: string; label: string; tone: string }>;
  fields: ModuleField[];
  defaultValues: Record<string, string | number | boolean | null>;
  searchKeys: string[];
  dashboardHint: string;
}

const STATUS_TONES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  planned: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  in_progress: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  completed: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  resolved: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  needs_review: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  delayed: "bg-red-500/15 text-red-300 border-red-500/25",
  critical: "bg-red-500/15 text-red-300 border-red-500/25",
  low: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  shortage: "bg-red-500/15 text-red-300 border-red-500/25",
  active: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  scheduled: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  assigned: "bg-blue-500/15 text-blue-300 border-blue-500/25",
};

const COMMON_STATUSES = [
  { value: "pending", label: "لم تبدأ", tone: STATUS_TONES.pending },
  { value: "in_progress", label: "قيد التنفيذ", tone: STATUS_TONES.in_progress },
  { value: "completed", label: "مكتملة", tone: STATUS_TONES.completed },
  { value: "needs_review", label: "تحتاج مراجعة", tone: STATUS_TONES.needs_review },
  { value: "delayed", label: "متأخرة", tone: STATUS_TONES.delayed },
];

const REQUEST_STAGES = [
  { value: "registered", label: "تم تسجيل الطلب", tone: STATUS_TONES.pending },
  { value: "sent_to_purchasing", label: "تم تحويله للمشتريات", tone: STATUS_TONES.planned },
  { value: "searching", label: "جاري البحث", tone: STATUS_TONES.in_progress },
  { value: "awaiting_customer_confirmation", label: "بانتظار تأكيد العميل", tone: STATUS_TONES.needs_review },
  { value: "customer_confirmed", label: "تم التأكيد", tone: STATUS_TONES.in_progress },
  { value: "provided", label: "تم توفير الصنف", tone: STATUS_TONES.completed },
  { value: "arrived_branch", label: "وصل الفرع", tone: STATUS_TONES.completed },
  { value: "customer_contacted", label: "تم التواصل مع العميل", tone: STATUS_TONES.completed },
  { value: "delivered", label: "تم التسليم", tone: STATUS_TONES.completed },
  { value: "unavailable", label: "تعذر التوفير", tone: STATUS_TONES.delayed },
  { value: "cancelled", label: "ملغي", tone: STATUS_TONES.delayed },
];

const BRANCH_OPTIONS = [...BRANCHES, "كل الفروع"];
const STAFF_PLACEHOLDER = "اسم المسؤول";

const SHORTAGE_CATEGORIES = [
  "أدوية ناقصة حرجة",
  "أدوية مزمنة",
  "سكر وضغط",
  "أدوية أطفال",
  "مضادات حيوية",
  "مسكنات",
  "جلدية",
  "حقن وأمبولات",
  "أدوية مستوردة",
  "بدائل مطلوبة",
  "أصناف روشتات متكررة",
  "أخرى",
];

const DEFAULT_SUPPLY_ITEMS = [
  "سرنجة 3 سم", "سرنجة 5 سم", "سرنجة 10 سم", "سرنجة أنسولين", "كانيولا صفراء", "كانيولا زرقاء",
  "كانيولا وردي", "محلول ملح 500", "محلول جلوكوز 5%", "قطن طبي", "شاش معقم", "شاش فازلين",
  "بلاستر طبي", "بلاستر ورقي", "دريسينج شفاف", "رباط ضاغط", "قفازات لاتكس", "قفازات نيتريل",
  "كمامات طبية", "ترمومتر", "جهاز قياس ضغط", "شرائط قياس سكر", "لانست", "كحول 70%",
  "مطهر بيتادين", "محلول عدسات", "قساطر بول", "أكياس بول", "خافض لسان", "أكياس نفايات طبية",
];

const ACCESSORY_SUPPLIERS = [
  "مندوب العناية الشخصية",
  "شركة مستلزمات أطفال",
  "مورد منتجات التجميل",
  "مورد الشعر والبشرة",
  "مورد المنتجات الموسمية",
  "مخزن الفرع",
  "مورد آخر",
];

const CLEANING_CHECKLIST = [
  "تنظيف الأرضيات",
  "ترتيب الرفوف",
  "تنظيف منطقة الكاشير",
  "التخلص من الكراتين",
  "تنظيف الواجهة",
  "تنظيف منطقة المعمل",
  "مراجعة الثلاجة",
  "ترتيب المخزن",
  "رفع ملاحظات للإدارة إن وجدت",
];

const configs: Record<string, ModuleConfig> = {
  shelf: {
    title: "تنظيم الأدوية والرفوف",
    route: "/shelf-organization",
    table: "shelf_tasks",
    icon: ClipboardList,
    description: "إدارة مهام ترتيب الأقراص والكبسولات والمعمل والإكسسوار والمستلزمات حسب الفرع والنطاق الأبجدي.",
    primaryField: "title",
    statusField: "status",
    branchField: "branch",
    dueDateField: "due_date",
    staffNameField: "responsible_staff_name",
    defaultStatus: "pending",
    statuses: COMMON_STATUSES,
    dashboardHint: "تظهر المهام المتأخرة والمستحقة اليوم في لوحة القيادة.",
    defaultValues: { title: "", branch: BRANCHES[0], zone: "منطقة الأقراص والكبسول", section: "", alphabet_from: "", alphabet_to: "", responsible_staff_name: "", responsible_staff_id: "", reviewer_staff_name: "", reviewer_staff_id: "", due_date: new Date().toISOString().slice(0, 10), frequency: "one_time", status: "pending", notes: "" },
    fields: [
      { key: "title", label: "عنوان المهمة", required: true, placeholder: "ترتيب الأقراص من A إلى H" },
      { key: "branch", label: "الفرع", kind: "select", options: BRANCH_OPTIONS, required: true },
      { key: "zone", label: "المنطقة", kind: "select", options: ["منطقة الأقراص والكبسول", "منطقة المعمل", "منطقة الإكسسوار", "منطقة المستلزمات", "منطقة البامبرز والأولويز", "الثلاجة", "المخزن الداخلي"] },
      { key: "section", label: "القسم/الدرج" },
      { key: "alphabet_from", label: "من حرف" },
      { key: "alphabet_to", label: "إلى حرف" },
      { key: "responsible_staff_name", label: "المسؤول", kind: "staff", staffIdKey: "responsible_staff_id", placeholder: STAFF_PLACEHOLDER },
      { key: "reviewer_staff_name", label: "الدكتور المراجع", kind: "staff", staffIdKey: "reviewer_staff_id", placeholder: "اختر المراجع" },
      { key: "due_date", label: "تاريخ الاستحقاق", kind: "date" },
      { key: "frequency", label: "التكرار", kind: "select", options: ["one_time", "daily", "weekly", "monthly"] },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
    searchKeys: ["title", "branch", "zone", "section", "responsible_staff_name"],
  },
  cleaning: {
    title: "نظافة الفروع",
    route: "/branch-cleaning",
    table: "branch_cleaning_tasks",
    icon: CheckCircle2,
    description: "متابعة نظافة الفروع حسب الشيفت والمسؤول ومراجعة المدير.",
    primaryField: "branch",
    statusField: "status",
    branchField: "branch",
    dueDateField: "task_date",
    staffNameField: "responsible_staff_name",
    defaultStatus: "pending",
    statuses: COMMON_STATUSES,
    dashboardHint: "أي فرع لم يغلق مهمة النظافة يظهر كتنبيه يومي.",
    defaultValues: { branch: BRANCHES[0], task_date: new Date().toISOString().slice(0, 10), date: new Date().toISOString().slice(0, 10), shift: "morning", responsible_staff_name: "", cleaner_name: "", responsible_staff_id: "", reviewer_staff_name: "", reviewer_staff_id: "", cleanliness_rating: 0, review_photo_url: "", review_photo_path: "", checklist: "{}", status: "pending", notes: "" },
    fields: [
      { key: "branch", label: "الفرع", kind: "select", options: BRANCH_OPTIONS, required: true },
      { key: "task_date", label: "التاريخ", kind: "date" },
      { key: "shift", label: "الشيفت", kind: "select", options: ["morning", "evening", "closing"] },
      { key: "responsible_staff_name", label: "مسؤول النظافة", kind: "select", options: ["", "حبيبه", "هبه"] },
      { key: "reviewer_staff_name", label: "الدكتور المراجع اليومي", kind: "staff", staffIdKey: "reviewer_staff_id" },
      { key: "cleanliness_rating", label: "تقييم مستوى النظافة", kind: "select", options: ["0", "1", "2", "3", "4", "5"] },
      { key: "review_photo_url", label: "صورة مراجعة النظافة", kind: "image" },
      { key: "checklist", label: "جدول النظافة اليومي", kind: "checklist", checklistItems: CLEANING_CHECKLIST },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
    searchKeys: ["branch", "responsible_staff_name", "shift", "notes"],
  },
  inventory: {
    title: "الجرد",
    route: "/inventory-counts",
    table: "inventory_count_sessions",
    icon: ClipboardList,
    description: "جلسات جرد كاملة أو حسب قسم أو نطاق حروف أو رواكد ونواقص.",
    primaryField: "title",
    statusField: "status",
    branchField: "branch",
    dueDateField: "due_date",
    staffNameField: "responsible_staff_name",
    defaultStatus: "planned",
    statuses: [
      { value: "planned", label: "مخطط", tone: STATUS_TONES.planned },
      ...COMMON_STATUSES.slice(1),
      { value: "closed", label: "مغلق", tone: STATUS_TONES.completed },
    ],
    dashboardHint: "فروق الجرد الخطيرة والجلسات المتأخرة تظهر للمدير.",
    defaultValues: { title: "", branch: BRANCHES[0], count_type: "جرد قسم", alphabet_from: "", alphabet_to: "", responsible_staff_name: "", responsible_staff_id: "", reviewer_staff_name: "", reviewer_staff_id: "", due_date: new Date().toISOString().slice(0, 10), status: "planned", notes: "" },
    fields: [
      { key: "title", label: "عنوان الجرد", required: true },
      { key: "branch", label: "الفرع", kind: "select", options: BRANCH_OPTIONS, required: true },
      { key: "count_type", label: "نوع الجرد", kind: "select", options: ["جرد كامل", "جرد قسم", "جرد أصناف محددة", "جرد نطاق حروف", "جرد رواكد", "جرد نواقص", "جرد أدوية لستة"] },
      { key: "alphabet_from", label: "من حرف" },
      { key: "alphabet_to", label: "إلى حرف" },
      { key: "responsible_staff_name", label: "المسؤول", kind: "staff", staffIdKey: "responsible_staff_id" },
      { key: "reviewer_staff_name", label: "الدكتور المراجع", kind: "staff", staffIdKey: "reviewer_staff_id" },
      { key: "due_date", label: "تاريخ الاستحقاق", kind: "date" },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
    searchKeys: ["title", "branch", "count_type", "responsible_staff_name"],
  },
  shortages: {
    title: "النواقص",
    route: "/shortages",
    table: "shortage_items",
    icon: AlertTriangle,
    description: "متابعة الأصناف الناقصة والحرجة وتحويلها لمهام شراء أو طلبات عملاء.",
    primaryField: "item_name",
    statusField: "status",
    branchField: "branch",
    staffNameField: "responsible_staff_name",
    defaultStatus: "shortage",
    statuses: [
      { value: "available", label: "متوفر", tone: STATUS_TONES.completed },
      { value: "low", label: "قليل", tone: STATUS_TONES.low },
      { value: "shortage", label: "ناقص", tone: STATUS_TONES.shortage },
      { value: "unavailable", label: "غير متوفر", tone: STATUS_TONES.delayed },
      { value: "purchase_required", label: "مطلوب شراء", tone: STATUS_TONES.needs_review },
      { value: "resolved", label: "تم الحل", tone: STATUS_TONES.resolved },
    ],
    dashboardHint: "الأصناف الحرجة تظهر ضمن أولويات اليوم.",
    defaultValues: { item_name: "", branch: BRANCHES[0], current_qty: 0, min_qty: 1, max_qty: 0, requested_qty: 1, priority: "medium", category: SHORTAGE_CATEGORIES[0], status: "shortage", responsible_staff_name: "", responsible_staff_id: "", registered_by_staff_id: "", registered_by_staff_name: "", notes: "" },
    fields: [
      { key: "item_name", label: "اسم الصنف", required: true },
      { key: "branch", label: "الفرع", kind: "select", options: BRANCH_OPTIONS },
      { key: "current_qty", label: "الكمية الحالية", kind: "number" },
      { key: "min_qty", label: "الحد الأدنى", kind: "number" },
      { key: "requested_qty", label: "الكمية المطلوبة", kind: "number" },
      { key: "priority", label: "الأولوية", kind: "select", options: ["high", "medium", "low"] },
      { key: "category", label: "التصنيف", kind: "select", options: SHORTAGE_CATEGORIES },
      { key: "responsible_staff_name", label: "المسؤول", kind: "staff", staffIdKey: "responsible_staff_id" },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
    searchKeys: ["item_name", "branch", "category", "supplier", "notes"],
  },
  supplies: stockConfig("المستلزمات", "/supplies", "supplies_items", "item_name", ["حقن وسرنجات", "كانيولات ومحاليل", "قطن وشاش", "بلاستر ودريسينج", "قساطر", "مستلزمات جروح", "جوانتيات وكمامات", "مستلزمات قياس", "أخرى"], { itemOptions: DEFAULT_SUPPLY_ITEMS, weeklyChecker: true }),
  accessories: stockConfig("الإكسسوار", "/accessories", "accessory_items", "item_name", ["عناية شخصية", "مستلزمات أطفال", "منتجات تجميل", "شعر وبشرة", "منتجات موسمية", "منتجات عرض", "منتجات بطيئة الحركة", "أخرى"], { supplierOptions: ACCESSORY_SUPPLIERS }),
  stories: {
    title: "الاستوريز والعروض",
    route: "/stories-offers",
    table: "offers",
    icon: Filter,
    description: "إدارة العروض النشطة وتقارير استوري واتساب اليومية.",
    primaryField: "title",
    statusField: "status",
    branchField: "branch",
    dueDateField: "end_date",
    defaultStatus: "scheduled",
    statuses: [
      { value: "scheduled", label: "مجدول", tone: STATUS_TONES.planned },
      { value: "active", label: "نشط", tone: STATUS_TONES.active },
      { value: "expired", label: "انتهى", tone: STATUS_TONES.delayed },
      { value: "stopped", label: "متوقف", tone: STATUS_TONES.needs_review },
    ],
    dashboardHint: "العروض النشطة والاستوريز التي تحتاج تقرير تظهر في لوحة القيادة.",
    defaultValues: { title: "", description: "", image_url: "", branch: "كل الفروع", start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), discount_type: "note", discount_value: 0, initial_qty: 0, remaining_qty: 0, boxes_dispensed: 0, sales_count: 0, sales_value: 0, doctor_name: "", status: "scheduled", notes: "" },
    fields: [
      { key: "title", label: "عنوان العرض", required: true },
      { key: "branch", label: "الفرع", kind: "select", options: BRANCH_OPTIONS },
      { key: "start_date", label: "تاريخ البداية", kind: "date" },
      { key: "end_date", label: "تاريخ النهاية", kind: "date" },
      { key: "discount_type", label: "نوع الخصم", kind: "select", options: ["percentage", "fixed", "bundle", "note"] },
      { key: "discount_value", label: "قيمة الخصم", kind: "number" },
      { key: "image_url", label: "رابط صورة العرض" },
      { key: "initial_qty", label: "الكمية المبدئية", kind: "number" },
      { key: "boxes_dispensed", label: "علب تم صرفها", kind: "number" },
      { key: "remaining_qty", label: "المتبقي", kind: "number" },
      { key: "sales_value", label: "قيمة المبيعات", kind: "number" },
      { key: "doctor_name", label: "الدكتور المرتبط" },
      { key: "description", label: "الوصف", kind: "textarea" },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
    searchKeys: ["title", "description", "branch", "status", "doctor_name"],
  },
  training: {
    title: "أساسيات التدريب والاختبارات",
    route: "/training",
    table: "training_modules",
    icon: ClipboardList,
    description: "إنشاء مواد تدريبية وكويزات مرتبطة بجودة الواتساب والتشغيل والمخزون.",
    primaryField: "title",
    statusField: "active",
    defaultStatus: "true",
    statuses: [
      { value: "true", label: "نشط", tone: STATUS_TONES.completed },
      { value: "false", label: "متوقف", tone: STATUS_TONES.delayed },
    ],
    dashboardHint: "التدريبات الإجبارية غير المكتملة تظهر كتنبيه للمدير.",
    defaultValues: { title: "", category: "خدمة العملاء", description: "", content: "", active: true },
    fields: [
      { key: "title", label: "عنوان التدريب", required: true },
      { key: "category", label: "التصنيف", kind: "select", options: ["معلومات دوائية", "مبيعات وترشيحات", "خدمة العملاء", "التعامل مع الشكاوى", "الجرد والمخزون", "النواقص والبدائل", "الرواكد واللستة", "الانضباط والعمل الجماعي", "التوصيل والدليفري", "قواعد الخصم والمكافأة"] },
      { key: "description", label: "الوصف", kind: "textarea" },
      { key: "content", label: "محتوى مختصر", kind: "textarea" },
    ],
    searchKeys: ["title", "category", "description"],
  },
};

function stockConfig(
  title: string,
  route: string,
  table: string,
  primaryField: string,
  categories: string[],
  options: { itemOptions?: string[]; supplierOptions?: string[]; weeklyChecker?: boolean } = {},
): ModuleConfig {
  const itemField: ModuleField = options.itemOptions?.length
    ? { key: "item_name", label: "اسم الصنف", kind: "select", options: options.itemOptions, required: true }
    : { key: "item_name", label: "اسم الصنف", required: true };
  const supplierField: ModuleField = options.supplierOptions?.length
    ? { key: "supplier", label: "المورد", kind: "select", options: options.supplierOptions }
    : { key: "supplier", label: "المورد" };
  return {
    title,
    route,
    table,
    icon: PackageIcon,
    description: `إدارة ${title} بالكميات والحدود ومتابعة الفحص الدوري.`,
    primaryField,
    statusField: "status",
    branchField: "branch",
    defaultStatus: "available",
    statuses: [
      { value: "available", label: "متوفر", tone: STATUS_TONES.completed },
      { value: "low", label: "قليل", tone: STATUS_TONES.low },
      { value: "shortage", label: "ناقص", tone: STATUS_TONES.shortage },
      { value: "needs_review", label: "يحتاج مراجعة", tone: STATUS_TONES.needs_review },
    ],
    dashboardHint: `أي نقص حرج في ${title} يظهر في لوحة القيادة.`,
    defaultValues: { item_name: options.itemOptions?.[0] || "", category: categories[0], branch: BRANCHES[0], current_qty: 0, min_qty: 1, max_qty: 0, requested_qty: 0, status: "available", supplier: options.supplierOptions?.[0] || "", weekly_checker_staff_name: "", weekly_checker_staff_id: "", responsible_staff_name: "", responsible_staff_id: "", notes: "" },
    fields: [
      itemField,
      { key: "category", label: "التصنيف", kind: "select", options: categories },
      { key: "branch", label: "الفرع", kind: "select", options: BRANCH_OPTIONS },
      { key: "current_qty", label: "الكمية الحالية", kind: "number" },
      { key: "min_qty", label: "الحد الأدنى", kind: "number" },
      { key: "max_qty", label: "الحد الأقصى", kind: "number" },
      ...(options.weeklyChecker ? [{ key: "weekly_checker_staff_name", label: "مسؤول المراجعة الأسبوعية", kind: "staff" as const, staffIdKey: "weekly_checker_staff_id" }] : []),
      { key: "responsible_staff_name", label: "المسؤول", kind: "staff", staffIdKey: "responsible_staff_id" },
      supplierField,
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
    searchKeys: ["item_name", "category", "branch", "supplier", "weekly_checker_staff_name", "responsible_staff_name", "notes"],
  };
}

function PackageIcon(props: { className?: string; size?: number }) {
  return <ClipboardList {...props} />;
}

export function OperationalModulePage({ module }: { module: keyof typeof configs }) {
  const config = configs[module];
  const { user } = useAuth();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [storyRows, setStoryRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [form, setForm] = useState<Record<string, string | number | boolean | null>>(config.defaultValues);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const { data: staffRows } = useSupabaseQuery<StaffChoice>({
    table: "staff",
    orderBy: { column: "name", ascending: true },
    realtimeEnabled: false,
  });

  const staffOptions = useMemo(() => mergeStaffChoices(staffRows), [staffRows]);
  const currentStaff = useMemo(() => {
    return staffOptions.find((staff) => staff.id === user?.staffId || staff.id === user?.id || staff.name === user?.name);
  }, [staffOptions, user?.id, user?.name, user?.staffId]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from(config.table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (loadError) {
      setError("تعذر تحميل البيانات. تأكد من تشغيل ترقية قاعدة البيانات.");
      setRows([]);
    } else {
      setRows((data || []) as Array<Record<string, unknown>>);
    }
    if (module === "stories") {
      const { data: storiesData, error: storiesError } = await supabase
        .from("whatsapp_stories")
        .select("*")
        .order("story_date", { ascending: false })
        .limit(500);
      setStoryRows(storiesError ? [] : ((storiesData || []) as Array<Record<string, unknown>>));
    }
    setLoading(false);
  }, [config.table, module]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const status = String(row[config.statusField] ?? "");
      const branch = config.branchField ? String(row[config.branchField] ?? "") : "";
      if (statusFilter !== "الكل" && status !== statusFilter) return false;
      if (branchFilter !== "الكل" && branch !== branchFilter) return false;
      if (!needle) return true;
      return config.searchKeys.some((key) => String(row[key] ?? "").toLowerCase().includes(needle));
    });
  }, [branchFilter, config, query, rows, statusFilter]);

  const stats = useMemo(() => {
    const open = rows.filter((row) => !["completed", "resolved", "closed", "delivered", "false"].includes(String(row[config.statusField] ?? ""))).length;
    const delayed = rows.filter((row) => {
      const date = config.dueDateField ? String(row[config.dueDateField] || "") : "";
      return date && date < new Date().toISOString().slice(0, 10) && !["completed", "resolved", "closed"].includes(String(row[config.statusField] ?? ""));
    }).length;
    const urgent = rows.filter((row) => ["high", "critical", "shortage", "delayed"].includes(String(row.priority || row[config.statusField] || ""))).length;
    return { total: rows.length, open, delayed, urgent };
  }, [config.dueDateField, config.statusField, rows]);

  const submit = async () => {
    const missing = config.fields.find((field) => field.required && !String(form[field.key] ?? "").trim());
    if (missing) {
      toast.error(`أكمل حقل ${missing.label}`);
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      ...(typeof form.checklist === "string" ? { checklist: safeJsonObject(form.checklist) } : {}),
      [config.statusField]: form[config.statusField] ?? config.defaultStatus,
      created_by: getSafeCurrentUserId(),
      created_by_name: user?.name || "النظام",
      ...(config.table === "shortage_items"
        ? {
            registered_by_staff_id: currentStaff?.id || user?.staffId || user?.id || null,
            registered_by_staff_name: currentStaff?.name || user?.name || "غير محدد",
          }
        : {}),
    };
    const insertQuery = supabase.from(config.table).insert(payload).select("id").single();
    const { data: insertedRow, error: saveError } = await insertQuery;
    if (saveError) {
      toast.error("تعذر الحفظ. تأكد من تشغيل ترقية قاعدة البيانات.");
    } else {
      if (module === "inventory" && inventoryFile && insertedRow?.id) {
        const imported = await importInventoryItems(String(insertedRow.id), inventoryFile);
        if (imported > 0) toast.success(`تم رفع ${imported} صنف للجرد من ملف Excel`);
      }
      toast.success("تم الحفظ بنجاح");
      await logActivity(getSafeCurrentUserId(), user?.name || "النظام", `إضافة ${config.title}`, config.title, String(form[config.primaryField] || config.title), String(form[config.branchField || "branch"] || "كل الفروع"), { route_path: config.route, new_value: payload });
      setForm(config.defaultValues);
      setInventoryFile(null);
      await loadRows();
    }
    setSaving(false);
  };

  const updateStatus = async (row: Record<string, unknown>, status: string) => {
    const { error: statusError } = await supabase
      .from(config.table)
      .update({ [config.statusField]: module === "training" ? status === "true" : status, updated_at: new Date().toISOString(), ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}) })
      .eq("id", row.id);
    if (statusError) toast.error("تعذر تحديث الحالة");
    else {
      toast.success("تم تحديث الحالة");
      await loadRows();
    }
  };

  const returnShortageToCustomerRequest = async (row: Record<string, unknown>) => {
    const requestId = String(row.source_customer_request_id || "");
    if (!requestId) {
      toast.error("هذا الصنف غير مرتبط بطلب عميل.");
      return;
    }
    const now = new Date().toISOString();
    const { error: requestError } = await supabase
      .from("customer_requests")
      .update({
        status: "available",
        moved_to_shortage_at: null,
        updated_at: now,
      })
      .eq("id", requestId);
    if (requestError) {
      toast.error(`تعذر إعادة الطلب: ${requestError.message}`);
      return;
    }
    const { error: shortageError } = await supabase
      .from("shortage_items")
      .update({
        status: "resolved",
        returned_to_customer_request_at: now,
        updated_at: now,
      })
      .eq("id", row.id);
    if (shortageError) {
      toast.error(`تم تحديث الطلب لكن تعذر تحديث النواقص: ${shortageError.message}`);
      return;
    }
    await supabase.from("customer_request_events").insert({
      request_id: requestId,
      old_status: "not_available",
      new_status: "available",
      action: "إعادة الطلب من النواقص",
      notes: `تمت إعادة متابعة الصنف من النواقص: ${String(row.item_name || row.title || "")}`,
      created_by: getSafeCurrentUserId(),
      created_by_name: user?.name || "النظام",
      created_at: now,
    });
    toast.success("تمت إعادة الطلب إلى طلبات العملاء");
    await loadRows();
  };

  const Icon = config.icon;
  const branchOptions = Array.from(new Set(rows.map((row) => normalizeBranchName(row[config.branchField || "branch"])).filter(Boolean)));

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-teal-500/15 p-3 text-teal-300"><Icon size={22} /></div>
            <div>
              <h1 className="text-2xl font-black text-white">{config.title}</h1>
              <p className="mt-1 text-sm text-slate-400">{config.description}</p>
              <p className="mt-2 text-xs text-teal-300">{config.dashboardHint}</p>
            </div>
          </div>
          <button type="button" onClick={loadRows} className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            تحديث
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={stats.total} label="إجمالي السجلات" />
        <Stat value={stats.open} label="مفتوح" />
        <Stat value={stats.delayed} label="متأخر" danger />
        <Stat value={stats.urgent} label="أولوية عالية" danger={stats.urgent > 0} />
      </div>

      {module === "stories" && <StoriesOffersAnalytics offers={rows} stories={storyRows} />}

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-5">
        <div className="mb-4 flex items-center gap-2 text-white font-bold">
          <Plus size={18} className="text-teal-300" />
          إضافة سجل جديد
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {config.fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={form[field.key]}
              staffOptions={staffOptions}
              form={form}
              onChange={(value, extra) => setForm((current) => ({ ...current, [field.key]: value, ...(extra || {}) }))}
            />
          ))}
        </div>
        {module === "inventory" && (
          <label className="mt-3 block rounded-xl border border-dashed border-teal-400/30 bg-teal-500/5 p-4 text-sm text-slate-300">
            <span className="mb-2 block font-bold text-teal-300">استيراد ملف الجرد Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => setInventoryFile(event.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-300 file:ml-3 file:rounded-lg file:border-0 file:bg-teal-500 file:px-3 file:py-2 file:font-bold file:text-[#07111f]"
            />
            <span className="mt-2 block text-xs text-slate-500">
              الأعمدة المقبولة: اسم الصنف، الكمية المتوقعة، الكمية الفعلية، تاريخ الصلاحية، السعر، سبب الفرق، الإجراء.
            </span>
          </label>
        )}
        <button type="button" onClick={submit} disabled={saving} className="btn-primary mt-4 flex items-center gap-2 px-4 py-2 text-sm">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          حفظ
        </button>
      </div>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <label className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input className="input-dark pr-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث..." />
          </label>
          <select className="input-dark" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option>الكل</option>
            {config.statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option>الكل</option>
            {branchOptions.map((branch) => <option key={branch}>{branch}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-3 p-10 text-slate-300"><Loader2 className="animate-spin text-teal-300" /> جاري التحميل...</div>
        ) : error ? (
          <div className="p-10 text-center text-red-200">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center text-slate-400">لا توجد بيانات مطابقة حاليا.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>العنوان</th>
                  {config.branchField && <th>الفرع</th>}
                  {config.staffNameField && <th>المسؤول</th>}
                  {config.dueDateField && <th>الاستحقاق</th>}
                  <th>الحالة</th>
                  <th>تغيير الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const status = String(row[config.statusField] ?? config.defaultStatus);
                  const statusMeta = config.statuses.find((item) => item.value === status);
                  return (
                    <tr key={String(row.id)}>
                      <td className="font-bold text-white">{String(row[config.primaryField] || row.title || row.item_name || row.branch || "-")}</td>
                      {config.branchField && <td>{normalizeBranchName(row[config.branchField])}</td>}
                      {config.staffNameField && <td>{String(row[config.staffNameField] || "-")}</td>}
                      {config.dueDateField && <td>{formatArabicDate(row[config.dueDateField])}</td>}
                      <td><span className={`rounded-full border px-2 py-1 text-xs ${statusMeta?.tone || STATUS_TONES.pending}`}>{statusMeta?.label || status}</span></td>
                      <td>
                        <select className="input-dark min-w-40" value={status} onChange={(event) => updateStatus(row, event.target.value)}>
                          {config.statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                        {module === "shortages" && row.source_customer_request_id && (
                          <button type="button" onClick={() => returnShortageToCustomerRequest(row)} className="btn-secondary mt-2 text-xs">
                            إعادة لطلبات العملاء
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StoriesOffersAnalytics({
  offers,
  stories,
}: {
  offers: Array<Record<string, unknown>>;
  stories: Array<Record<string, unknown>>;
}) {
  const asNumber = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const offerSales = offers.reduce((sum, row) => sum + asNumber(row.sales_value), 0);
  const offerBoxes = offers.reduce((sum, row) => sum + asNumber(row.boxes_dispensed), 0);
  const storyViews = stories.reduce((sum, row) => sum + asNumber(row.views_count), 0);
  const storySales = stories.reduce((sum, row) => sum + asNumber(row.sales_value), 0);
  const topStories = [...stories]
    .sort((a, b) => asNumber(b.sales_value) - asNumber(a.sales_value) || asNumber(b.views_count) - asNumber(a.views_count))
    .slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">تحليل العروض</h2>
          <span className="rounded-full bg-teal-500/10 px-3 py-1 text-xs font-bold text-teal-200">{offers.length.toLocaleString("ar-EG")} عرض</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={offerBoxes} label="علب مصروفة" />
          <Stat value={Math.round(offerSales)} label="قيمة المبيعات" />
          <Stat value={offers.filter((row) => String(row.status || "") === "active").length} label="عروض نشطة" />
        </div>
        <div className="mt-4 space-y-2">
          {offers.slice(0, 4).map((offer) => (
            <div key={String(offer.id || offer.title)} className="rounded-xl border border-[#2d4063] bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-white">{String(offer.title || "عرض بدون عنوان")}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(offer.branch || "كل الفروع")} · المتبقي {asNumber(offer.remaining_qty).toLocaleString("ar-EG")} · دكتور {String(offer.doctor_name || "غير محدد")}
                  </div>
                </div>
                {offer.image_url ? <img src={String(offer.image_url)} alt="" className="h-12 w-12 rounded-lg object-cover" /> : null}
              </div>
            </div>
          ))}
          {offers.length === 0 && <div className="rounded-xl bg-white/[0.03] p-4 text-center text-sm text-slate-400">لا توجد عروض مسجلة للتحليل حاليًا.</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">تحليل الاستوريز</h2>
          <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200">{stories.length.toLocaleString("ar-EG")} ستوري</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={storyViews} label="مشاهدات" />
          <Stat value={Math.round(storySales)} label="مبيعات" />
          <Stat value={stories.reduce((sum, row) => sum + asNumber(row.inquiries_count), 0)} label="استفسارات" />
        </div>
        <div className="mt-4 space-y-2">
          {topStories.map((story, index) => (
            <div key={String(story.id || story.title || index)} className="rounded-xl border border-[#2d4063] bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-white">#{index + 1} {String(story.title || "ستوري بدون عنوان")}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    ترتيب {String(story.story_order || "-")} · {formatArabicDate(story.story_date)} · {String(story.story_time || "")}
                  </div>
                  <div className="mt-1 text-xs text-teal-200">
                    {asNumber(story.views_count).toLocaleString("ar-EG")} مشاهدة · {asNumber(story.boxes_dispensed || story.sales_count).toLocaleString("ar-EG")} علبة · {String(story.branch || "كل الفروع")} · {String(story.doctor_name || "غير محدد")}
                  </div>
                </div>
                {story.image_url ? <img src={String(story.image_url)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : null}
              </div>
            </div>
          ))}
          {stories.length === 0 && <div className="rounded-xl bg-white/[0.03] p-4 text-center text-sm text-slate-400">لا توجد استوريز مسجلة للتحليل حاليًا.</div>}
        </div>
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  staffOptions,
  form,
}: {
  field: ModuleField;
  value: unknown;
  staffOptions: StaffChoice[];
  form: Record<string, string | number | boolean | null>;
  onChange: (value: string | number | boolean, extra?: Record<string, string>) => void;
}) {
  const kind = field.kind || "text";
  const common = "input-dark";
  const selectedStaffId = field.staffIdKey ? String(form[field.staffIdKey] || "") : "";
  const selectedByName = staffOptions.find((staff) => staff.name === String(value || ""));
  const staffSelectValue = selectedStaffId || selectedByName?.id || "";
  const checklistValue = typeof value === "string" ? safeJsonObject(value) : {};
  const imagePathKey = field.key.endsWith("_url") ? field.key.replace(/_url$/, "_path") : `${field.key}_path`;
  const [customChecklistItem, setCustomChecklistItem] = useState("");
  return (
    <label className={`text-xs text-slate-300 space-y-1 ${kind === "textarea" || kind === "checklist" || kind === "image" ? "md:col-span-3" : ""}`}>
      <span>{field.label}{field.required ? " *" : ""}</span>
      {kind === "select" ? (
        <select className={common} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : kind === "staff" ? (
        <select
          className={common}
          value={staffSelectValue}
          onChange={(event) => {
            const selected = staffOptions.find((staff) => staff.id === event.target.value);
            onChange(selected?.name || "", field.staffIdKey ? { [field.staffIdKey]: selected?.id || "" } : undefined);
          }}
        >
          <option value="">{field.placeholder || "اختر من قائمة الدكاترة"}</option>
          {staffOptions.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.name} — {staff.branch || "كل الفروع"}{staff.role ? ` — ${staff.role}` : ""}
            </option>
          ))}
        </select>
      ) : kind === "textarea" ? (
        <textarea className={common} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
      ) : kind === "checklist" ? (
        <div className="rounded-xl border border-[#2d4063] bg-[#162847] p-3">
          <div className="mb-3 flex gap-2">
            <input className={common} value={customChecklistItem} onChange={(event) => setCustomChecklistItem(event.target.value)} placeholder="إضافة بند جديد لجدول النظافة" />
            <button
              type="button"
              className="btn-secondary whitespace-nowrap px-4"
              onClick={() => {
                const item = customChecklistItem.trim();
                if (!item) return;
                const next = { ...(checklistValue as Record<string, boolean>), [item]: false };
                onChange(JSON.stringify(next));
                setCustomChecklistItem("");
              }}
            >
              إضافة
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
          {[...(field.checklistItems || []), ...Object.keys(checklistValue).filter((item) => !(field.checklistItems || []).includes(item))].map((item) => {
            const checked = Boolean((checklistValue as Record<string, unknown>)[item]);
            return (
              <label key={item} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = { ...(checklistValue as Record<string, boolean>), [item]: event.target.checked };
                    onChange(JSON.stringify(next));
                  }}
                  className="h-4 w-4 accent-teal-400"
                />
                <span>{item}</span>
              </label>
            );
          })}
          </div>
        </div>
      ) : kind === "image" ? (
        <ImageUploadBox
          bucket="customer-request-images"
          folder="cleaning-reviews"
          label={field.label}
          valueUrl={String(value || "")}
          valuePath={String(form[imagePathKey] || "")}
          onUploaded={({ publicUrl, path }) => onChange(publicUrl, { [imagePathKey]: path })}
        />
      ) : (
        <input className={common} type={kind} value={String(value ?? "")} onChange={(event) => onChange(kind === "number" ? Number(event.target.value) : event.target.value)} placeholder={field.placeholder} />
      )}
    </label>
  );
}

function Stat({ value, label, danger = false }: { value: number; label: string; danger?: boolean }) {
  return (
    <div className="stat-card">
      <div className={`text-2xl font-black ${danger ? "text-red-300" : "text-teal-300"}`}>{value.toLocaleString("ar-EG")}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

function formatArabicDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

function safeJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function importInventoryItems(sessionId: string, file: File) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const pick = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const found = Object.keys(row).find((item) => item.trim().toLowerCase() === key.trim().toLowerCase());
      if (found && row[found] !== "") return row[found];
    }
    return "";
  };
  const toNumber = (value: unknown) => {
    const next = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(next) ? next : null;
  };
  const toDate = (value: unknown) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
  };
  const items = rows
    .map((row) => ({
      session_id: sessionId,
      item_name: String(pick(row, ["اسم الصنف", "الصنف", "item_name", "name"])).trim(),
      expected_qty: toNumber(pick(row, ["الكمية المتوقعة", "expected_qty", "السيستم", "الرصيد"])),
      actual_qty: toNumber(pick(row, ["الكمية الفعلية", "actual_qty", "الفعلي", "الكمية"])),
      expiry_date: toDate(pick(row, ["تاريخ الصلاحية", "expiry_date", "الصلاحية", "تاريخ الانتهاء"])),
      unit_price: toNumber(pick(row, ["السعر", "سعر الصنف", "unit_price", "price"])),
      reason: String(pick(row, ["سبب الفرق", "reason"])).trim() || null,
      action: String(pick(row, ["الإجراء", "action"])).trim() || null,
      notes: String(pick(row, ["ملاحظات", "notes"])).trim() || null,
    }))
    .filter((row) => row.item_name);
  if (!items.length) return 0;
  const { error } = await supabase.from("inventory_count_items").insert(items);
  if (error) {
    toast.error(`تم حفظ جلسة الجرد، لكن تعذر رفع الأصناف: ${error.message}`);
    return 0;
  }
  return items.length;
}

export default OperationalModulePage;
