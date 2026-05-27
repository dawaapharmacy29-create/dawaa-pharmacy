import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  FileText,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { cleanEgyptianPhone, generateWhatsAppLink } from "@/lib/whatsapp";
import { selectableStaffChoices } from "@/lib/staffFallback";
import type { Staff } from "@/types/database";

type NoteStatus = "new" | "assigned_pending" | "in_progress" | "completed" | "cancelled" | "overdue";
type NotePriority = "normal" | "important" | "urgent" | "critical";
type NoteKind = "note" | "action_task";

interface ShiftNote {
  id: string;
  title: string;
  details: string | null;
  note_kind?: NoteKind | null;
  action_required?: string | null;
  note_type: string | null;
  branch: string | null;
  customer_id?: string | null;
  customer_name: string | null;
  customer_code?: string | null;
  customer_phone: string | null;
  invoice_no: string | null;
  author_id: string | null;
  author_name: string | null;
  due_at: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  priority: NotePriority | null;
  status: NoteStatus | null;
  received_by_name?: string | null;
  received_at?: string | null;
  postponed_until?: string | null;
  postponement_reason?: string | null;
  is_recurring: boolean | null;
  repeat_days: number | null;
  recurrence_times: string[] | null;
  handed_over: boolean | null;
  handed_over_at: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  closure_reason: string | null;
  amount_due?: number | null;
  expected_payment_method?: string | null;
  patient_address?: string | null;
  delivery_address?: string | null;
  complaint_level?: string | null;
  resolution_required?: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_by_name?: string | null;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
}

interface ShiftNoteLog {
  id: string;
  note_id: string;
  action: string;
  actor_name: string | null;
  details: string | null;
  created_at: string | null;
}

interface ShiftNoteOccurrence {
  id: string;
  note_id: string;
  occurrence_at: string | null;
  status: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  completion_note?: string | null;
}

const typeLabels: Record<string, string> = {
  customer: "عميل",
  collection: "تحصيل",
  nursing: "تمريض",
  delivery: "دليفري",
  follow_up: "متابعة",
  missing_item: "صنف ناقص",
  problem: "مشكلة",
  general: "عام",
  customer_complaint: "شكوى عميل",
};

const kindLabels: Record<NoteKind, string> = {
  note: "ملاحظة معلوماتية",
  action_task: "مهمة تنفيذ",
};

const actionLabels: Record<string, string> = {
  call_customer: "اتصال بالعميل",
  send_whatsapp: "إرسال واتساب",
  collect_payment: "تحصيل مبلغ",
  send_delivery: "إرسال دليفري",
  send_nurse: "إرسال تمريض",
  review_invoice: "مراجعة فاتورة",
  prepare_order: "تحضير أوردر",
  follow_up_customer: "متابعة عميل",
  wait_customer_reply: "انتظار رد العميل",
  general_action: "إجراء عام",
};

const priorityLabels: Record<NotePriority, string> = {
  normal: "عادي",
  important: "مهم",
  urgent: "عاجل",
  critical: "حرج",
};

const statusLabels: Record<NoteStatus, string> = {
  new: "جديدة",
  assigned_pending: "بانتظار الاستلام",
  in_progress: "قيد التنفيذ",
  completed: "مكتملة",
  cancelled: "ملغية",
  overdue: "متأخرة",
};

const emptyForm = {
  title: "",
  details: "",
  note_kind: "note" as NoteKind,
  action_required: "general_action",
  note_type: "general",
  branch: "فرع شكري",
  customer_name: "",
  customer_phone: "",
  invoice_no: "",
  due_at: "",
  assigned_to_name: "",
  priority: "normal" as NotePriority,
  amount_due: "",
  expected_payment_method: "",
  patient_address: "",
  delivery_address: "",
  complaint_level: "",
  resolution_required: "",
  is_recurring: false,
  repeat_days: 1,
  recurrence_times: "09:00,21:00",
};

function todayInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function isOverdue(note: ShiftNote) {
  if (!note.due_at || ["completed", "cancelled"].includes(note.status || "")) return false;
  return new Date(note.due_at).getTime() < Date.now();
}

function dateLabel(value?: string | null) {
  if (!value) return "غير محدد";
  return new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}


function dayKey(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function statusClass(note: ShiftNote) {
  if (isOverdue(note)) return "bg-red-950/60 border-red-500/35 text-red-100";
  if (note.status === "completed") return "bg-emerald-500/10 border-emerald-400/25 text-emerald-200";
  if (note.status === "cancelled") return "bg-slate-500/10 border-slate-400/25 text-slate-300";
  if (note.note_type === "nursing" || note.note_type === "medical") return "bg-amber-500/10 border-amber-400/25 text-amber-100";
  if (note.priority === "critical" || note.priority === "urgent") return "bg-red-500/10 border-red-400/25 text-red-100";
  if (note.note_type === "nursing") return "bg-amber-500/10 border-amber-300/30 text-amber-100";
  if (note.priority === "important") return "bg-amber-500/10 border-amber-400/25 text-amber-100";
  return "bg-blue-500/10 border-blue-400/25 text-blue-100";
}

export default function ShiftNotes() {
  const { user, isAdmin } = useAuth();
  const { data: staffRows } = useSupabaseQuery<Staff>({ table: "staff", realtimeEnabled: false });
  const { data: customerRows } = useSupabaseQuery<Record<string, unknown>>({ table: "customers", realtimeEnabled: false, limit: 5000 });
  const staffChoices = useMemo(() => selectableStaffChoices(staffRows as unknown as Record<string, unknown>[]), [staffRows]);
  const [notes, setNotes] = useState<ShiftNote[]>([]);
  const [logs, setLogs] = useState<ShiftNoteLog[]>([]);
  const [occurrences, setOccurrences] = useState<ShiftNoteOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<ShiftNote | null>(null);
  const [editing, setEditing] = useState<ShiftNote | null>(null);
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState("today");
  const [dimensionFilter, setDimensionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const canManage = isAdmin || /مدير|admin/i.test(user?.role || "");

  const loadNotes = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shift_notes")
      .select("*")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) {
      toast.error("تعذر تحميل ملاحظات الشيفتات. تأكد من تشغيل ترقية قاعدة البيانات.");
      setLoading(false);
      return;
    }
    const all = (data || []) as ShiftNote[];
    setNotes(all.filter((n) => !n.deleted_at));
    setDeletedNotes(all.filter((n) => Boolean(n.deleted_at)));
    setLoading(false);
  };

  const loadDetails = async (note: ShiftNote) => {
    setSelected(note);
    const [{ data: logRows }, { data: occurrenceRows }] = await Promise.all([
      supabase.from("shift_note_logs").select("*").eq("note_id", note.id).order("created_at", { ascending: false }),
      supabase.from("shift_note_occurrences").select("*").eq("note_id", note.id).order("occurrence_at", { ascending: true }),
    ]);
    setLogs((logRows || []) as ShiftNoteLog[]);
    setOccurrences((occurrenceRows || []) as ShiftNoteOccurrence[]);
  };

  useEffect(() => {
    loadNotes();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const addLog = async (noteId: string, action: string, details?: string) => {
    await supabase.from("shift_note_logs").insert({
      note_id: noteId,
      action,
      actor_id: user?.id || null,
      actor_name: user?.name || "النظام",
      details: details || null,
    });
  };

  const createOccurrences = async (noteId: string) => {
    if (!form.is_recurring) return;
    const days = Math.max(1, Number(form.repeat_days || 1));
    const times = form.recurrence_times.split(",").map((time) => time.trim()).filter(Boolean);
    if (times.length === 0) return;
    const rows = [];
    const base = new Date(form.due_at || new Date());
    for (let day = 0; day < days; day += 1) {
      for (const time of times) {
        const [hour, minute] = time.split(":").map(Number);
        const occurrence = new Date(base);
        occurrence.setDate(base.getDate() + day);
        occurrence.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
        rows.push({ note_id: noteId, occurrence_at: occurrence.toISOString(), status: "pending" });
      }
    }
    if (rows.length) await supabase.from("shift_note_occurrences").insert(rows);
  };

  const resetForm = () => {
    setEditing(null);
    setForm({ ...emptyForm, due_at: todayInput() });
  };

  const saveNote = async () => {
    if (!form.title.trim()) {
      toast.error("اكتب عنوان الملحوظة");
      return;
    }
    setSaving(true);
    const selectedStaff = staffChoices.find((item) => item.name === form.assigned_to_name);
    const payload = {
      title: form.title.trim(),
      details: form.details.trim() || null,
      note_kind: form.note_kind,
      action_required: form.note_kind === "action_task" ? form.action_required : null,
      note_type: form.note_type,
      branch: form.branch,
      customer_name: form.customer_name.trim() || null,
      customer_code: form.customer_code.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      invoice_no: form.invoice_no.trim() || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      assigned_to_id: selectedStaff?.id || null,
      assigned_to_name: form.assigned_to_name || null,
      priority: form.priority,
      amount_due: form.note_type === "collection" && form.amount_due ? Number(form.amount_due) : null,
      expected_payment_method: form.note_type === "collection" ? form.expected_payment_method || null : null,
      patient_address: form.note_type === "nursing" ? form.patient_address || null : null,
      delivery_address: form.note_type === "delivery" ? form.delivery_address || null : null,
      complaint_level: form.note_type === "customer_complaint" ? form.complaint_level || null : null,
      resolution_required: form.note_type === "customer_complaint" ? form.resolution_required || null : null,
      is_recurring: form.is_recurring,
      repeat_days: form.is_recurring ? Number(form.repeat_days || 1) : null,
      recurrence_times: form.is_recurring ? form.recurrence_times.split(",").map((item) => item.trim()).filter(Boolean) : null,
      author_id: editing?.author_id || user?.id || null,
      author_name: editing?.author_name || user?.name || null,
      status: editing?.status || (form.note_kind === "action_task" && form.assigned_to_name ? "assigned_pending" : "new"),
      updated_at: new Date().toISOString(),
    };
    const request = editing
      ? supabase.from("shift_notes").update(payload).eq("id", editing.id).select("*").single()
      : supabase.from("shift_notes").insert(payload).select("*").single();
    const { data, error } = await request;
    if (error) {
      toast.error(`تعذر حفظ الملحوظة: ${error.message}`);
      setSaving(false);
      return;
    }
    await addLog(data.id, editing ? "update" : "create", editing ? "تعديل بيانات الملحوظة" : "إنشاء ملحوظة جديدة");
    if (!editing) await createOccurrences(data.id);
    toast.success(editing ? "تم تعديل الملحوظة" : "تم إنشاء ملحوظة الشيفت");
    resetForm();
    await loadNotes();
    setSaving(false);
  };

  const updateStatus = async (note: ShiftNote, status: NoteStatus, reason?: string) => {
    if (status === "completed" && !user?.name) {
      toast.error("يجب تحديد الدكتور المنفذ قبل تنفيذ الملحوظة");
      return;
    }
    if (status === "completed" && note.note_kind === "action_task" && ["important", "urgent", "critical"].includes(note.priority || "") && !reason) {
      const completionNote = window.prompt("اكتب تعليق التنفيذ قبل إغلاق المهمة");
      if (!completionNote?.trim()) {
        toast.error("لا يمكن إغلاق المهمة المهمة بدون تعليق تنفيذ");
        return;
      }
      reason = completionNote.trim();
    }
    const payload: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (["completed", "cancelled"].includes(status)) {
      payload.closed_at = new Date().toISOString();
      payload.closed_by_id = user?.id || null;
      payload.closed_by_name = user?.name || null;
      payload.closure_reason = reason || null;
      if (status === "completed") {
        payload.completed_by_name = user?.name || null;
      }
    }
    const { data, error } = await supabase.from("shift_notes").update(payload).eq("id", note.id).select("*").single();
    if (error) {
      toast.error(`تعذر تحديث حالة الملحوظة: ${error.message}`);
      return;
    }
    await addLog(note.id, status, reason || statusLabels[status]);
    toast.success(status === "completed" ? "تم تنفيذ الملحوظة" : "تم تحديث الملحوظة");
    await loadNotes();
    if (selected?.id === note.id) await loadDetails(data as ShiftNote);
  };

  const deleteNote = async (note: ShiftNote) => {
    if (!canManage && note.author_name !== user?.name) {
      toast.error("ليس لديك صلاحية حذف هذه الملاحظة");
      return;
    }
    const ok = window.confirm("هل تريد حذف هذه الملاحظة؟");
    if (!ok) return;

    const { error } = await supabase.from("shift_notes").delete().eq("id", note.id);
    if (error) {
      toast.error(`تعذر حذف الملاحظة: ${error.message}`);
      return;
    }

    toast.success("تم حذف الملاحظة");
    if (selected?.id === note.id) setSelected(null);
    await loadNotes();
  };

  const receiveNote = async (note: ShiftNote) => {
    const { data, error } = await supabase
      .from("shift_notes")
      .update({
        status: "in_progress",
        received_by_id: user?.id || null,
        received_by_name: user?.name || null,
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", note.id)
      .select("*")
      .single();
    if (error) {
      toast.error(`تعذر استلام المتابعة: ${error.message}`);
      return;
    }
    await addLog(note.id, "receive", "تم استلام مسؤولية المتابعة");
    toast.success("تم استلام المتابعة");
    await loadNotes();
    if (selected?.id === note.id) await loadDetails(data as ShiftNote);
  };

  const postponeNote = async (note: ShiftNote) => {
    const choice = window.prompt("اكتب مدة التأجيل: 30m أو 1h أو tonight أو tomorrow أو تاريخ بصيغة 2026-05-26 20:00");
    if (!choice) return;
    const reason = window.prompt("سبب التأجيل");
    if (!reason?.trim()) {
      toast.error("سبب التأجيل مطلوب");
      return;
    }
    const next = new Date();
    if (choice === "30m") next.setMinutes(next.getMinutes() + 30);
    else if (choice === "1h") next.setHours(next.getHours() + 1);
    else if (choice === "tonight") next.setHours(21, 0, 0, 0);
    else if (choice === "tomorrow") {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    } else {
      const custom = new Date(choice);
      if (Number.isNaN(custom.getTime())) {
        toast.error("وقت التأجيل غير صحيح");
        return;
      }
      next.setTime(custom.getTime());
    }
    const { data, error } = await supabase
      .from("shift_notes")
      .update({
        due_at: next.toISOString(),
        postponed_until: next.toISOString(),
        postponement_reason: reason.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", note.id)
      .select("*")
      .single();
    if (error) {
      toast.error(`تعذر تأجيل الملاحظة: ${error.message}`);
      return;
    }
    await addLog(note.id, "postpone", `تم التأجيل إلى ${dateLabel(next.toISOString())}. السبب: ${reason.trim()}`);
    toast.success("تم تأجيل الملاحظة");
    await loadNotes();
    if (selected?.id === note.id) await loadDetails(data as ShiftNote);
  };

  const completeOccurrence = async (occurrence: ShiftNoteOccurrence) => {
    if (!selected) return;
    const note = window.prompt("تعليق تنفيذ هذه المرة");
    if (!note?.trim()) {
      toast.error("تعليق التنفيذ مطلوب");
      return;
    }
    const { error } = await supabase
      .from("shift_note_occurrences")
      .update({
        status: "completed",
        completed_by_id: user?.id || null,
        completed_by_name: user?.name || null,
        completed_at: new Date().toISOString(),
        completion_note: note.trim(),
        notes: note.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", occurrence.id);
    if (error) {
      toast.error(`تعذر تنفيذ هذه المرة: ${error.message}`);
      return;
    }
    await addLog(selected.id, "complete_occurrence", `تم تنفيذ مرة متكررة: ${dateLabel(occurrence.occurrence_at)} - ${note.trim()}`);
    await loadDetails(selected);
    toast.success("تم تسجيل تنفيذ هذه المرة");
  };

  const addComment = async () => {
    if (!selected || !comment.trim()) return;
    await addLog(selected.id, "comment", comment.trim());
    setComment("");
    await loadDetails(selected);
  };

  const softDeleteNote = async (note: ShiftNote) => {
    const ok = window.confirm(`حذف الملحوظة: ${note.title} ؟ يمكن استرجاعها لاحقًا.`);
    if (!ok) return;
    const { error } = await supabase.from("shift_notes").update({
      deleted_at: new Date().toISOString(),
      deleted_by_id: user?.id || null,
      deleted_by_name: user?.name || null,
      updated_at: new Date().toISOString(),
    }).eq("id", note.id);
    if (error) return toast.error(`تعذر حذف الملحوظة: ${error.message}`);
    await addLog(note.id, "delete", `تم حذف الملحوظة بواسطة ${user?.name || "النظام"}`);
    await loadNotes();
  };

  const restoreNote = async (note: ShiftNote) => {
    const { error } = await supabase.from("shift_notes").update({
      deleted_at: null,
      deleted_by_id: null,
      deleted_by_name: null,
      updated_at: new Date().toISOString(),
    }).eq("id", note.id);
    if (error) return toast.error(`تعذر استرجاع الملحوظة: ${error.message}`);
    await addLog(note.id, "restore", `تم استرجاع الملحوظة بواسطة ${user?.name || "النظام"}`);
    await loadNotes();
  };

  const handoverOpenNotes = async () => {
    const openNotes = notes.filter((note) => !["completed", "cancelled"].includes(note.status || ""));
    const openIds = openNotes.map((note) => note.id);
    if (openIds.length === 0) {
      toast.info("لا توجد ملاحظات مفتوحة للتسليم");
      return;
    }
    const overdue = openNotes.filter(isOverdue).length;
    const urgent = openNotes.filter((note) => ["urgent", "critical"].includes(note.priority || "")).length;
    const recurring = openNotes.filter((note) => note.is_recurring).length;
    const ok = window.confirm(`سيتم تسليم ${openIds.length} ملاحظة للشيفت التالي.\nالمتأخرة: ${overdue}\nالعاجلة: ${urgent}\nالمتكررة: ${recurring}\nهل تريد المتابعة؟`);
    if (!ok) return;
    const handoverNote = window.prompt("تعليق تسليم اختياري للشيفت التالي") || "";
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("shift_notes")
      .update({
        handed_over: true,
        handed_over_at: now,
        handed_over_by_id: user?.id || null,
        handed_over_by_name: user?.name || "النظام",
        handover_note: handoverNote || null,
        updated_at: now,
      })
      .in("id", openIds);
    if (error) {
      toast.error(`تعذر تسليم الشيفت: ${error.message}`);
      return;
    }
    await Promise.all(openIds.map((id) => addLog(id, "handover", handoverNote ? `تم تسليم الملحوظة للشيفت التالي: ${handoverNote}` : "تم تسليم الملحوظة للشيفت التالي")));
    toast.success(`تم تسليم ${openIds.length} ملاحظة للشيفت التالي`);
    await loadNotes();
  };

  const startEdit = (note: ShiftNote) => {
    setEditing(note);
    setForm({
      title: note.title || "",
      details: note.details || "",
      note_kind: note.note_kind || "note",
      action_required: note.action_required || "general_action",
      note_type: note.note_type || "general",
      branch: note.branch || "فرع شكري",
      customer_name: note.customer_name || "",
      customer_phone: note.customer_phone || "",
      invoice_no: note.invoice_no || "",
      due_at: note.due_at ? new Date(note.due_at).toISOString().slice(0, 16) : todayInput(),
      assigned_to_name: note.assigned_to_name || "",
      priority: note.priority || "normal",
      amount_due: note.amount_due ? String(note.amount_due) : "",
      expected_payment_method: note.expected_payment_method || "",
      patient_address: note.patient_address || "",
      delivery_address: note.delivery_address || "",
      complaint_level: note.complaint_level || "",
      resolution_required: note.resolution_required || "",
      is_recurring: Boolean(note.is_recurring),
      repeat_days: note.repeat_days || 1,
      recurrence_times: (note.recurrence_times || ["09:00", "21:00"]).join(","),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filteredNotes = useMemo(() => {
    const q = debouncedSearch;
    const today = dayKey(new Date().toISOString());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = dayKey(tomorrowDate.toISOString());

    return notes.filter((note) => {
      const dueKey = dayKey(note.due_at);
      const closedKey = dayKey(note.closed_at);
      const matchesPrimary =
        filter === "all" ||
        (filter === "mine" && [note.assigned_to_name, note.author_name].includes(user?.name || "")) ||
        (filter === "today" && dueKey === today) ||
        (filter === "tomorrow" && dueKey === tomorrow) ||
        (filter === "overdue" && isOverdue(note)) ||
        (filter === "urgent" && ["urgent", "critical"].includes(note.priority || "")) ||
        (filter === "recurring" && Boolean(note.is_recurring)) ||
        (filter === "assigned_pending" && note.status === "assigned_pending") ||
        (filter === "completed_today" && note.status === "completed" && closedKey === today) ||
        (filter === "archive" && ["completed", "cancelled"].includes(note.status || "")) ||
        filter === note.status;

      const matchesDimension =
        dimensionFilter === "all" ||
        dimensionFilter === note.branch ||
        dimensionFilter === note.note_type ||
        dimensionFilter === note.assigned_to_name;

      if (!matchesPrimary || !matchesDimension) return false;
      if (!q) return true;

      const haystack = [note.title, note.details, note.customer_name, note.customer_phone, note.invoice_no, note.branch, note.assigned_to_name, note.note_type, note.action_required]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [debouncedSearch, dimensionFilter, filter, notes, user?.name]);

  const summary = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    let todayCount = 0;
    let overdue = 0;
    let urgent = 0;
    let pending = 0;
    let recurring = 0;
    let completed = 0;

    for (const note of notes) {
      const dueKey = dayKey(note.due_at);
      const closedKey = dayKey(note.closed_at);
      if (dueKey === today) todayCount += 1;
      if (isOverdue(note)) overdue += 1;
      if (["urgent", "critical"].includes(note.priority || "")) urgent += 1;
      if (note.status === "assigned_pending") pending += 1;
      if (note.is_recurring && dueKey === today) recurring += 1;
      if (note.status === "completed" && closedKey === today) completed += 1;
    }

    return { today: todayCount, overdue, urgent, pending, recurring, completed };
  }, [notes]);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <div className="page-title flex items-center gap-3">
            <MessageSquare className="text-teal-300" /> ملاحظات الشيفتات
          </div>
          <p className="text-slate-400 text-sm mt-2">متابعة أي ملحوظة بين الشيفتات تخص عميل أو تحصيل أو دليفري أو تمريض أو مهمة في وقت محدد.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handoverOpenNotes} className="btn-primary flex items-center gap-2"><Send size={16} /> تسليم للشيفت التالي</button>
          <button onClick={loadNotes} className="btn-secondary flex items-center gap-2"><RefreshCw size={16} /> تحديث</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
      </div>

      {deletedNotes.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="section-title mb-2">الملاحظات المحذوفة (يمكن استرجاعها)</div>
          <div className="space-y-2">
            {deletedNotes.slice(0, 10).map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="text-slate-200">{n.title} - حذفها: {n.deleted_by_name || "غير محدد"}</div>
                <button className="btn-secondary text-xs" onClick={() => restoreNote(n)}>استرجاع</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="section-title">{editing ? "تعديل ملحوظة" : "إضافة ملحوظة جديدة"}</div>
          {editing && <button onClick={resetForm} className="btn-secondary text-sm">إلغاء التعديل</button>}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <input className="input-dark lg:col-span-2" placeholder="عنوان مختصر للملحوظة" value={form.title} onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))} />
          <select className="input-dark" value={form.note_kind} onChange={(event) => setForm((f) => ({ ...f, note_kind: event.target.value as NoteKind }))}>
            {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="input-dark" value={form.action_required} disabled={form.note_kind !== "action_task"} onChange={(event) => setForm((f) => ({ ...f, action_required: event.target.value }))}>
            {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="input-dark" value={form.note_type} onChange={(event) => setForm((f) => ({ ...f, note_type: event.target.value }))}>
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="input-dark" value={form.priority} onChange={(event) => setForm((f) => ({ ...f, priority: event.target.value as NotePriority }))}>
            {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="input-dark" value={form.branch} onChange={(event) => setForm((f) => ({ ...f, branch: event.target.value }))}>
            <option>فرع شكري</option>
            <option>فرع الشامي</option>
            <option>كل الفروع</option>
          </select>
          <input className="input-dark" placeholder="ابحث باسم/كود العميل (يدعم *)" value={form.customer_name} onChange={(event) => {
            const q = event.target.value;
            const raw = q.toLowerCase().replace(/\*/g, ".*");
            const regex = new RegExp(raw);
            const match = (customerRows || []).find((row) => regex.test(String(row.name || row.customer_name || "").toLowerCase()) || regex.test(String(row.customer_code || row.code || "").toLowerCase()));
            setForm((f) => ({ ...f, customer_name: q, customer_code: String(match?.customer_code || match?.code || ""), customer_phone: match ? String(match.phone || match.customer_phone || f.customer_phone || "") : f.customer_phone }));
          }} />
          <input className="input-dark" placeholder="رقم تليفون العميل" value={form.customer_phone} onChange={(event) => setForm((f) => ({ ...f, customer_phone: event.target.value }))} />
          <input className="input-dark" placeholder="رقم الفاتورة إن وجد" value={form.invoice_no} onChange={(event) => setForm((f) => ({ ...f, invoice_no: event.target.value }))} />
          <input className="input-dark" type="datetime-local" value={form.due_at} onChange={(event) => setForm((f) => ({ ...f, due_at: event.target.value }))} />
          <select className="input-dark lg:col-span-2" value={form.assigned_to_name} onChange={(event) => setForm((f) => ({ ...f, assigned_to_name: event.target.value }))}>
            <option value="">الشخص المسؤول عن المتابعة</option>
            {staffChoices.map((person) => <option key={person.id} value={person.name}>{person.name} - {person.branch}</option>)}
          </select>
          <label className="flex items-center gap-2 bg-white/5 rounded-xl px-4 text-slate-200">
            <input type="checkbox" checked={form.is_recurring} onChange={(event) => setForm((f) => ({ ...f, is_recurring: event.target.checked }))} />
            ملحوظة متكررة
          </label>
          {form.note_type === "collection" && (
            <>
              <input className="input-dark" placeholder="المبلغ المطلوب تحصيله" value={form.amount_due} onChange={(event) => setForm((f) => ({ ...f, amount_due: event.target.value }))} />
              <input className="input-dark" placeholder="طريقة الدفع المتوقعة" value={form.expected_payment_method} onChange={(event) => setForm((f) => ({ ...f, expected_payment_method: event.target.value }))} />
            </>
          )}
          {form.note_type === "nursing" && (
            <input className="input-dark lg:col-span-2" placeholder="عنوان المريض / مكان التمريض" value={form.patient_address} onChange={(event) => setForm((f) => ({ ...f, patient_address: event.target.value }))} />
          )}
          {form.note_type === "delivery" && (
            <input className="input-dark lg:col-span-2" placeholder="عنوان الدليفري" value={form.delivery_address} onChange={(event) => setForm((f) => ({ ...f, delivery_address: event.target.value }))} />
          )}
          {form.note_type === "customer_complaint" && (
            <>
              <input className="input-dark" placeholder="درجة الشكوى" value={form.complaint_level} onChange={(event) => setForm((f) => ({ ...f, complaint_level: event.target.value }))} />
              <input className="input-dark" placeholder="الإجراء المطلوب لحل الشكوى" value={form.resolution_required} onChange={(event) => setForm((f) => ({ ...f, resolution_required: event.target.value }))} />
            </>
          )}
          <input className="input-dark" type="number" min={1} placeholder="عدد أيام التكرار" value={form.repeat_days} disabled={!form.is_recurring} onChange={(event) => setForm((f) => ({ ...f, repeat_days: Number(event.target.value) }))} />
          <input className="input-dark lg:col-span-2" placeholder="أوقات التكرار مثل 09:00,21:00" value={form.recurrence_times} disabled={!form.is_recurring} onChange={(event) => setForm((f) => ({ ...f, recurrence_times: event.target.value }))} />
          <textarea className="input-dark lg:col-span-4 resize-none" rows={3} placeholder="تفاصيل الملحوظة" value={form.details} onChange={(event) => setForm((f) => ({ ...f, details: event.target.value }))} />
        </div>
        <button onClick={saveNote} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {editing ? "حفظ التعديل" : "إضافة الملحوظة"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/customer-requests" className="btn-secondary">الذهاب لطلبات العملاء</Link>
        <Link to="/shift-notes" className="btn-secondary">تحديث صفحة الملحوظات</Link>
      </div>

      {deletedNotes.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="section-title mb-2">الملاحظات المحذوفة (يمكن استرجاعها)</div>
          <div className="space-y-2">
            {deletedNotes.slice(0, 10).map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="text-slate-200">{n.title} - حذفها: {n.deleted_by_name || "غير محدد"}</div>
                <button className="btn-secondary text-xs" onClick={() => restoreNote(n)}>استرجاع</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={notesSectionRef} className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
        <input className="input-dark lg:col-span-2" placeholder="بحث بالعميل أو الهاتف أو العنوان أو المسؤول..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="input-dark" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">كل الملاحظات</option>
          <option value="mine">ملاحظاتي</option>
          <option value="today">ملاحظات اليوم</option>
          <option value="tomorrow">ملاحظات بكرة</option>
          <option value="overdue">المتأخرة</option>
          <option value="urgent">العاجلة</option>
          <option value="recurring">المتكررة</option>
          <option value="assigned_pending">بانتظار الاستلام</option>
          <option value="completed_today">تمت اليوم</option>
          <option value="archive">الأرشيف</option>
          <option value="new">جديدة</option>
          <option value="in_progress">قيد التنفيذ</option>
          <option value="completed">مكتملة</option>
          <option value="cancelled">ملغية</option>
        </select>
        <select className="input-dark" value={dimensionFilter} onChange={(event) => setDimensionFilter(event.target.value)}>
          <option value="all">حسب الفرع/النوع/المسؤول</option>
          <option value="فرع شكري">فرع شكري</option>
          <option value="فرع الشامي">فرع الشامي</option>
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          {staffChoices.map((person) => <option key={person.id} value={person.name}>{person.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="stat-card text-slate-300">جاري تحميل ملاحظات الشيفتات...</div>
      ) : filteredNotes.length === 0 ? (
        <div className="stat-card text-center text-slate-400 py-10">لا توجد ملاحظات مطابقة حاليًا.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredNotes.map((note) => {
            const phone = cleanEgyptianPhone(note.customer_phone || "");
            return (
              <div key={note.id} className={`rounded-2xl border p-5 ${statusClass(note)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-black text-white">{note.title}</div>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      <span className="badge-info">{typeLabels[note.note_type || "general"] || "عام"}</span>
                      <span className="badge-info">{kindLabels[note.note_kind || "note"]}</span>
                      {note.action_required && <span className="badge-info">{actionLabels[note.action_required] || note.action_required}</span>}
                      <span className="badge-info">{note.branch || "غير محدد"}</span>
                      <span className="badge-info">{priorityLabels[note.priority || "normal"]}</span>
                      <span className="badge-info">{isOverdue(note) ? "متأخرة" : statusLabels[note.status || "new"]}</span>
                      {note.is_recurring && <span className="badge-info">متكررة</span>}
                      {note.received_by_name && <span className="badge-success">استلمها {note.received_by_name}</span>}
                      {note.is_recurring && <span className="badge-warning">متكررة</span>}
                      {note.postponed_until && <span className="badge-warning">مؤجلة إلى {dateLabel(note.postponed_until)}</span>}
                      {note.handed_over && <span className="badge-warning">تم تسليمها للشيفت التالي</span>}
                    </div>
                  </div>
                  <button onClick={() => loadDetails(note)} className="btn-secondary text-sm">عرض التفاصيل</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
                  <Info icon={UserRound} label="العميل" value={note.customer_name || "لا يوجد"} />
                  <Info icon={Phone} label="الهاتف" value={note.customer_phone || "لا يوجد"} />
                  <Info icon={Clock} label="وقت التنفيذ" value={dateLabel(note.due_at)} />
                  <Info icon={UserRound} label="المسؤول" value={note.assigned_to_name || "غير محدد"} />
                  <Info icon={FileText} label="رقم الفاتورة" value={note.invoice_no || "لا يوجد"} />
                  <Info icon={UserRound} label="أنشأها" value={note.author_name || "غير محدد"} />
                  <Info icon={Clock} label="تاريخ الإنشاء" value={dateLabel(note.created_at)} />
                  <Info icon={Clock} label="آخر تحديث" value={dateLabel(note.updated_at)} />
                </div>
                {note.details && <p className="text-slate-300 text-sm leading-7 mt-4 line-clamp-2">{note.details}</p>}
                <div className="flex flex-wrap gap-2 mt-4">
                  {note.status === "assigned_pending" && <button onClick={() => receiveNote(note)} className="btn-primary text-sm flex items-center gap-2"><CheckCircle2 size={15} /> استلام المتابعة</button>}
                  <button onClick={() => updateStatus(note, "completed")} className="btn-primary text-sm flex items-center gap-2"><CheckCircle2 size={15} /> تم التنفيذ</button>
                  <button onClick={() => postponeNote(note)} className="btn-secondary text-sm flex items-center gap-2"><Clock size={15} /> تأجيل</button>
                  <button onClick={() => startEdit(note)} disabled={!canManage && note.author_name !== user?.name} className="btn-secondary text-sm flex items-center gap-2"><Edit3 size={15} /> تعديل</button>
                  {phone && <a href={`tel:${phone}`} className="btn-secondary text-sm flex items-center gap-2"><Phone size={15} /> اتصال</a>}
                  {phone && <button onClick={() => navigator.clipboard?.writeText(phone)} className="btn-secondary text-sm flex items-center gap-2"><Copy size={15} /> نسخ الرقم</button>}
                  {phone && <a href={generateWhatsAppLink(phone, `حضرتك مع صيدليات دواء، بنتابع مع حضرتك بخصوص الطلب / المتابعة الخاصة بحضرتك.`)} target="_blank" rel="noreferrer" className="btn-secondary text-sm flex items-center gap-2"><MessageSquare size={15} /> واتساب</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#10213b] border border-[#2d4063] rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-5" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 bg-[#10213b] pb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-2xl font-black text-white">{selected.title}</div>
                <div className="text-slate-400 text-sm mt-1">كتبت بواسطة {selected.author_name || "غير محدد"} - {dateLabel(selected.created_at)}</div>
              </div>
              <button className="btn-secondary" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Detail label="النوع" value={typeLabels[selected.note_type || "general"] || "عام"} />
              <Detail label="نوع التسجيل" value={kindLabels[selected.note_kind || "note"]} />
              <Detail label="الإجراء المطلوب" value={selected.action_required ? (actionLabels[selected.action_required] || selected.action_required) : "لا يوجد"} />
              <Detail label="الحالة" value={isOverdue(selected) ? "متأخرة" : statusLabels[selected.status || "new"]} />
              <Detail label="الأولوية" value={priorityLabels[selected.priority || "normal"]} />
              <Detail label="الفرع" value={selected.branch || "غير محدد"} />
              <Detail label="المسؤول" value={selected.assigned_to_name || "غير محدد"} />
              <Detail label="استلام المسؤولية" value={selected.received_by_name ? `${selected.received_by_name} - ${dateLabel(selected.received_at)}` : "لم يتم الاستلام"} />
              <Detail label="وقت التنفيذ" value={dateLabel(selected.due_at)} />
              <Detail label="التأجيل" value={selected.postponed_until ? `${dateLabel(selected.postponed_until)} - ${selected.postponement_reason || ""}` : "لا يوجد"} />
              <Detail label="العميل" value={selected.customer_name || "لا يوجد"} />
              <Detail label="هاتف العميل" value={selected.customer_phone || "لا يوجد"} />
              <Detail label="رقم الفاتورة" value={selected.invoice_no || "لا يوجد"} />
              {selected.note_type === "collection" && <Detail label="التحصيل" value={`${selected.amount_due || "غير محدد"} - ${selected.expected_payment_method || "طريقة غير محددة"}`} />}
              {selected.note_type === "nursing" && <Detail label="عنوان التمريض" value={selected.patient_address || "غير محدد"} />}
              {selected.note_type === "delivery" && <Detail label="عنوان الدليفري" value={selected.delivery_address || "غير محدد"} />}
              {selected.note_type === "customer_complaint" && <Detail label="مستوى الشكوى" value={`${selected.complaint_level || "غير محدد"} - ${selected.resolution_required || ""}`} />}
            </div>
            {selected.details && <div className="mt-4 bg-white/5 rounded-xl p-4 text-slate-200 leading-8">{selected.details}</div>}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <div className="bg-white/5 rounded-xl p-4">
                <div className="section-title mb-3">التعليقات وسجل التعديلات</div>
                <div className="flex gap-2 mb-3">
                  <input className="input-dark" placeholder="إضافة تعليق..." value={comment} onChange={(event) => setComment(event.target.value)} />
                  <button onClick={addComment} className="btn-primary">إضافة</button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {logs.length === 0 ? <div className="text-slate-400 text-sm">لا يوجد سجل بعد.</div> : logs.map((log) => (
                    <div key={log.id} className="bg-black/15 rounded-lg p-3 text-sm">
                      <div className="text-white font-bold">{log.action} - {log.actor_name || "النظام"}</div>
                      <div className="text-slate-400 text-xs">{dateLabel(log.created_at)}</div>
                      {log.details && <div className="text-slate-300 mt-1">{log.details}</div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <div className="section-title mb-3">جدول التكرارات</div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {occurrences.length === 0 ? <div className="text-slate-400 text-sm">لا توجد تكرارات لهذه الملحوظة.</div> : occurrences.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 bg-black/15 rounded-lg p-3 text-sm">
                      <div>
                        <div>{dateLabel(item.scheduled_time || item.occurrence_at)}</div>
                        {item.completion_note && <div className="text-xs text-slate-400 mt-1">{item.completion_note}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="badge-info">{item.status || "pending"}</span>
                        {item.status !== "completed" && <button onClick={() => completeOccurrence(item)} className="btn-secondary text-xs">تم تنفيذ هذه المرة</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
      <div className="text-slate-400 text-sm">{label}</div>
      <div className={`text-3xl font-black mt-2 ${danger ? "text-red-300" : success ? "text-emerald-300" : "text-teal-300"}`}>{value}</div>
    </button>
  );
}

function Info({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-black/15 rounded-xl p-3">
      <div className="text-slate-400 text-xs flex items-center gap-1"><Icon size={14} /> {label}</div>
      <div className="text-white font-bold mt-1">{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold mt-1">{value}</div>
    </div>
  );
}
