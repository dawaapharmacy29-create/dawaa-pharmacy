import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock3,
  Edit3, Loader2, MessageSquare, Phone, Plus, RefreshCw, RotateCcw, Search, Send,
  Trash2, UserRound, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { supabase } from '@/lib/supabase';
import { cleanEgyptianPhone, generateWhatsAppLink } from '@/lib/whatsapp';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { selectableStaffChoices } from '@/lib/staffFallback';
import { notifyBranchDoctors } from '@/lib/staffNotificationService';
import type { Staff } from '@/types/database';

type Row = Record<string, any>;
type NoteStatus = 'new' | 'assigned_pending' | 'in_progress' | 'completed' | 'cancelled';
type NotePriority = 'normal' | 'important' | 'urgent' | 'critical';
type NoteKind = 'note' | 'action_task';

type Workspace = {
  rows: Row[];
  deleted_rows: Row[];
  total: number;
  page_size: number;
  offset: number;
  summary: {
    total: number; today: number; overdue: number; urgent: number; pending: number;
    recurring: number; completed: number; postponed: number; in_progress: number;
  };
};

const PAGE_SIZE = 100;
const typeLabels: Record<string, string> = {
  customer: 'عميل', collection: 'تحصيل', nursing: 'تمريض', delivery: 'دليفري',
  follow_up: 'متابعة', missing_item: 'صنف ناقص', problem: 'مشكلة', general: 'عام',
  customer_complaint: 'شكوى عميل',
};
const actionLabels: Record<string, string> = {
  call_customer: 'اتصال بالعميل', send_whatsapp: 'إرسال واتساب', collect_payment: 'تحصيل مبلغ',
  send_delivery: 'إرسال دليفري', send_nurse: 'إرسال تمريض', review_invoice: 'مراجعة فاتورة',
  prepare_order: 'تحضير أوردر', follow_up_customer: 'متابعة عميل', wait_customer_reply: 'انتظار رد العميل',
  general_action: 'إجراء عام',
};
const priorityLabels: Record<NotePriority, string> = {
  normal: 'عادي', important: 'مهم', urgent: 'عاجل', critical: 'حرج',
};
const statusLabels: Record<string, string> = {
  new: 'جديدة', assigned_pending: 'بانتظار الاستلام', in_progress: 'قيد التنفيذ',
  completed: 'مكتملة', cancelled: 'ملغية', overdue: 'متأخرة',
};

function nowInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const emptyForm = {
  title: '', details: '', note_kind: 'note' as NoteKind, action_required: 'general_action',
  note_type: 'general', branch: 'فرع شكري', customer_id: '', customer_name: '', customer_code: '',
  customer_phone: '', whatsapp_phone: '', invoice_no: '', due_at: nowInput(), assigned_to_name: '',
  priority: 'normal' as NotePriority, is_recurring: false, repeat_days: 1, recurrence_times: '09:00,21:00',
  amount_due: '', expected_payment_method: '', patient_address: '', delivery_address: '',
  complaint_level: '', resolution_required: '',
};

function dateLabel(value?: string | null) {
  if (!value) return 'غير محدد';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}
function isOverdue(row: Row) {
  return Boolean(row.due_at && new Date(row.due_at).getTime() < Date.now() && !['completed', 'cancelled'].includes(String(row.status || '')));
}
function noteBadge(row: Row) {
  if (isOverdue(row)) return 'dawaa-badge--danger';
  if (['urgent', 'critical'].includes(String(row.priority || ''))) return 'dawaa-badge--danger';
  if (row.status === 'completed') return 'dawaa-badge--success';
  if (row.postponed_until) return 'dawaa-badge--warning';
  return 'dawaa-badge--info';
}

export default function ShiftNotesV2() {
  const { user, checkPermission } = useAuth();
  const { data: staffRows } = useSupabaseQuery<Staff>({
    table: 'staff', filters: isActiveStaffFilter(), realtimeEnabled: false,
  });
  const staffChoices = useMemo(
    () => selectableStaffChoices(staffRows as unknown as Record<string, unknown>[]),
    [staffRows]
  );
  const [workspace, setWorkspace] = useState<Workspace>({
    rows: [], deleted_rows: [], total: 0, page_size: PAGE_SIZE, offset: 0,
    summary: { total: 0, today: 0, overdue: 0, urgent: 0, pending: 0, recurring: 0, completed: 0, postponed: 0, in_progress: 0 },
  });
  const [filter, setFilter] = useState('today');
  const [dimension, setDimension] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Row[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [logs, setLogs] = useState<Row[]>([]);
  const [occurrences, setOccurrences] = useState<Row[]>([]);

  useEscapeKey(() => setSelected(null), Boolean(selected));
  const canManage = checkPermission('edit_shift_evaluation');
  const canHandover = canManage;
  const seniorBranchScope = ['كل الفروع', 'all'].includes(String(user?.branch || '').trim());
  const branchOptions = seniorBranchScope
    ? ['فرع شكري', 'فرع الشامي', 'كل الفروع']
    : [String(user?.branch || 'فرع شكري')];

  const isOwnNote = (row: Row) =>
    String(row.author_id || '') === String(user?.id || '') ||
    (!row.author_id && Boolean(user?.name) && row.author_name === user?.name);
  const isAssignedNote = (row: Row) => {
    const assigned = String(row.assigned_to_id || '');
    return assigned === String(user?.staffId || '') || assigned === String(user?.id || '') ||
      (!assigned && Boolean(user?.name) && row.assigned_to_name === user?.name) ||
      String(row.received_by_id || '') === String(user?.id || '');
  };
  const canOperateNote = (row: Row) => canManage || isOwnNote(row) || isAssignedNote(row);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);
  useEffect(() => setPage(0), [filter, dimension, debouncedSearch]);
  useEffect(() => {
    if (!editing && !seniorBranchScope && user?.branch) {
      setForm((current) => current.branch === user.branch ? current : { ...current, branch: user.branch });
    }
  }, [editing, seniorBranchScope, user?.branch]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_shift_notes_workspace_v1', {
      p_filter: filter,
      p_dimension: dimension,
      p_search: debouncedSearch || null,
      p_user_name: user?.name || null,
      p_offset: page * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });
    if (error) {
      toast.error(`تعذر تحميل ملاحظات الشيفت: ${error.message}`);
      setLoading(false);
      return;
    }
    const next = (data || {}) as Workspace;
    setWorkspace({
      rows: Array.isArray(next.rows) ? next.rows : [],
      deleted_rows: Array.isArray(next.deleted_rows) ? next.deleted_rows : [],
      total: Number(next.total || 0),
      page_size: Number(next.page_size || PAGE_SIZE),
      offset: Number(next.offset || 0),
      summary: { ...workspace.summary, ...(next.summary || {}) },
    });
    setLoading(false);
  }, [debouncedSearch, dimension, filter, page, user?.name]);

  useEffect(() => { void load(); }, [load]);

  const addLog = async (noteId: string, action: string, details?: string) => {
    await supabase.from('shift_note_logs').insert({
      note_id: noteId, action, actor_id: user?.id || null, actor_name: user?.name || 'النظام', details: details || null,
    });
  };

  const searchCustomers = async () => {
    const q = customerQuery.trim();
    if (q.length < 2) return setCustomerResults([]);
    setCustomerLoading(true);
    try {
      const safe = q.replace(/[%,()]/g, ' ');
      const { data, error } = await supabase
        .from('customers')
        .select('id,name,customer_name,customer_code,code,phone,customer_phone,whatsapp_phone,branch')
        .or(`name.ilike.%${safe}%,customer_name.ilike.%${safe}%,customer_code.ilike.%${safe}%,code.ilike.%${safe}%,phone.ilike.%${safe}%,customer_phone.ilike.%${safe}%`)
        .limit(12);
      if (error) throw error;
      setCustomerResults((data || []) as Row[]);
    } catch (error) {
      console.error('[ShiftNotesV2] customer search failed', error);
      setCustomerResults([]);
    } finally {
      setCustomerLoading(false);
    }
  };

  useEffect(() => {
    if (customerQuery.trim().length < 2) { setCustomerResults([]); return; }
    const id = window.setTimeout(() => void searchCustomers(), 300);
    return () => window.clearTimeout(id);
  }, [customerQuery]);

  const pickCustomer = (row: Row) => {
    setForm((f) => ({
      ...f,
      customer_id: String(row.id || ''),
      customer_name: String(row.name || row.customer_name || ''),
      customer_code: String(row.customer_code || row.code || ''),
      customer_phone: String(row.phone || row.customer_phone || ''),
      whatsapp_phone: String(row.whatsapp_phone || row.phone || row.customer_phone || ''),
      branch: seniorBranchScope && row.branch ? String(row.branch) : f.branch,
    }));
    setCustomerQuery('');
    setCustomerResults([]);
  };

  const resetForm = () => {
    setEditing(null);
    setForm({ ...emptyForm, branch: seniorBranchScope ? 'فرع شكري' : String(user?.branch || 'فرع شكري'), due_at: nowInput() });
    setCustomerQuery('');
    setCustomerResults([]);
  };

  const createOccurrences = async (noteId: string) => {
    if (!form.is_recurring) return;
    const times = form.recurrence_times.split(',').map((v) => v.trim()).filter(Boolean);
    const days = Math.max(1, Number(form.repeat_days || 1));
    const base = new Date(form.due_at || Date.now());
    const rows: Row[] = [];
    for (let day = 0; day < days; day += 1) {
      for (const time of times) {
        const [h, m] = time.split(':').map(Number);
        const d = new Date(base);
        d.setDate(base.getDate() + day);
        d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
        rows.push({ note_id: noteId, occurrence_at: d.toISOString(), scheduled_time: d.toISOString(), status: 'pending' });
      }
    }
    if (rows.length) await supabase.from('shift_note_occurrences').insert(rows);
  };

  const save = async () => {
    if (!form.title.trim()) return toast.error('اكتب عنوان الملحوظة');
    if (editing && !canManage && !isOwnNote(editing)) return toast.error('ليس لديك صلاحية تعديل هذه الملحوظة');
    if (!seniorBranchScope && user?.branch && form.branch !== user.branch) return toast.error('يمكنك إنشاء الملاحظات داخل فرعك فقط');
    setSaving(true);
    const staff = staffChoices.find((item) => item.name === form.assigned_to_name);
    const payload: Row = {
      title: form.title.trim(), details: form.details.trim() || null,
      note_kind: form.note_kind, action_required: form.note_kind === 'action_task' ? form.action_required : null,
      note_type: form.note_type, branch: form.branch,
      customer_id: form.customer_id || null, customer_name: form.customer_name.trim() || null,
      customer_code: form.customer_code.trim() || null, customer_phone: form.customer_phone.trim() || null,
      whatsapp_phone: form.whatsapp_phone.trim() || null, invoice_no: form.invoice_no.trim() || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      assigned_to_id: staff?.id || null, assigned_to_name: form.assigned_to_name || null,
      priority: form.priority, is_recurring: form.is_recurring,
      repeat_days: form.is_recurring ? Number(form.repeat_days || 1) : null,
      recurrence_times: form.is_recurring ? form.recurrence_times.split(',').map((v) => v.trim()).filter(Boolean) : null,
      amount_due: form.note_type === 'collection' && form.amount_due ? Number(form.amount_due) : null,
      expected_payment_method: form.note_type === 'collection' ? form.expected_payment_method || null : null,
      patient_address: form.note_type === 'nursing' ? form.patient_address || null : null,
      delivery_address: form.note_type === 'delivery' ? form.delivery_address || null : null,
      complaint_level: form.note_type === 'customer_complaint' ? form.complaint_level || null : null,
      resolution_required: form.note_type === 'customer_complaint' ? form.resolution_required || null : null,
      author_id: editing?.author_id || user?.id || null,
      author_name: editing?.author_name || user?.name || null,
      status: editing?.status || (form.note_kind === 'action_task' && form.assigned_to_name ? 'assigned_pending' : 'new'),
      updated_at: new Date().toISOString(),
    };
    const query = editing
      ? supabase.from('shift_notes').update(payload).eq('id', editing.id).select('*').single()
      : supabase.from('shift_notes').insert(payload).select('*').single();
    const { data, error } = await query;
    if (error) { setSaving(false); return toast.error(`تعذر الحفظ: ${error.message}`); }
    await addLog(data.id, editing ? 'update' : 'create', editing ? 'تعديل بيانات الملحوظة' : 'إنشاء ملحوظة جديدة');
    if (!editing) {
      await createOccurrences(data.id);
      if (data.branch) void notifyBranchDoctors(String(data.branch), {
        type: 'shift_note', title: 'ملاحظة شيفت جديدة في فرعك', message: data.title,
        priority: ['urgent', 'critical'].includes(String(data.priority || '')) ? 'high' : 'normal',
        entityType: 'shift_note', entityId: String(data.id), actionUrl: '/shift-notes',
      }).catch(() => null);
    }
    toast.success(editing ? 'تم تعديل الملحوظة' : 'تم إنشاء الملحوظة');
    resetForm();
    await load();
    setSaving(false);
  };

  const startEdit = (row: Row) => {
    if (!canManage && !isOwnNote(row)) return toast.error('ليس لديك صلاحية تعديل هذه الملحوظة');
    setEditing(row);
    setForm({
      ...emptyForm,
      title: row.title || '', details: row.details || '', note_kind: row.note_kind || 'note',
      action_required: row.action_required || 'general_action', note_type: row.note_type || 'general',
      branch: row.branch || 'فرع شكري', customer_id: row.customer_id || '', customer_name: row.customer_name || '',
      customer_code: row.customer_code || '', customer_phone: row.customer_phone || '', whatsapp_phone: row.whatsapp_phone || '',
      invoice_no: row.invoice_no || '', due_at: row.due_at ? new Date(row.due_at).toISOString().slice(0, 16) : nowInput(),
      assigned_to_name: row.assigned_to_name || '', priority: row.priority || 'normal', is_recurring: Boolean(row.is_recurring),
      repeat_days: row.repeat_days || 1, recurrence_times: (row.recurrence_times || ['09:00', '21:00']).join(','),
      amount_due: row.amount_due ? String(row.amount_due) : '', expected_payment_method: row.expected_payment_method || '',
      patient_address: row.patient_address || '', delivery_address: row.delivery_address || '', complaint_level: row.complaint_level || '',
      resolution_required: row.resolution_required || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updateStatus = async (row: Row, status: NoteStatus) => {
    if (!canOperateNote(row)) return toast.error('المهمة ليست ضمن صلاحياتك');
    let reason = '';
    if (status === 'completed' && row.note_kind === 'action_task' && ['important', 'urgent', 'critical'].includes(String(row.priority || ''))) {
      reason = window.prompt('اكتب تعليق التنفيذ قبل إغلاق المهمة')?.trim() || '';
      if (!reason) return toast.error('تعليق التنفيذ مطلوب');
    }
    const patch: Row = { status, updated_at: new Date().toISOString() };
    if (['completed', 'cancelled'].includes(status)) {
      patch.closed_at = new Date().toISOString(); patch.closed_by_id = user?.id || null;
      patch.closed_by_name = user?.name || null; patch.closure_reason = reason || (status === 'cancelled' ? 'إلغاء من المستخدم' : null);
      if (status === 'completed') { patch.completed_at = patch.closed_at; patch.completed_by_name = user?.name || null; }
    }
    const { error } = await supabase.from('shift_notes').update(patch).eq('id', row.id);
    if (error) return toast.error(`تعذر تحديث الحالة: ${error.message}`);
    await addLog(row.id, status, reason || statusLabels[status]);
    await load();
    toast.success('تم تحديث الملحوظة');
  };

  const receive = async (row: Row) => {
    if (!canManage && !isAssignedNote(row)) return toast.error('المهمة غير مسندة إليك');
    const { error } = await supabase.from('shift_notes').update({
      status: 'in_progress', received_by_id: user?.id || null, received_by_name: user?.name || null,
      received_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return toast.error(`تعذر الاستلام: ${error.message}`);
    await addLog(row.id, 'receive', 'تم استلام مسؤولية المتابعة');
    await load();
  };

  const postpone = async (row: Row) => {
    if (!canOperateNote(row)) return toast.error('المهمة ليست ضمن صلاحياتك');
    const raw = window.prompt('أجل كام؟ اكتب 30m أو 1h أو tomorrow أو تاريخ مثل 2026-08-24 09:00', '1h');
    if (!raw) return;
    const next = new Date();
    if (raw.trim() === '30m') next.setMinutes(next.getMinutes() + 30);
    else if (raw.trim() === '1h') next.setHours(next.getHours() + 1);
    else if (/tomorrow|بكره|بكرة/i.test(raw)) { next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0); }
    else {
      const parsed = new Date(raw.replace(' ', 'T'));
      if (Number.isNaN(parsed.getTime())) return toast.error('وقت التأجيل غير صحيح');
      next.setTime(parsed.getTime());
    }
    const reason = window.prompt('سبب التأجيل', 'تأجيل حسب ظروف المتابعة')?.trim();
    if (!reason) return toast.error('سبب التأجيل مطلوب');
    const { error } = await supabase.from('shift_notes').update({
      due_at: next.toISOString(), postponed_until: next.toISOString(), postponement_reason: reason, updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return toast.error(`تعذر التأجيل: ${error.message}`);
    await addLog(row.id, 'postpone', `إلى ${dateLabel(next.toISOString())} — ${reason}`);
    await load();
  };

  const softDelete = async (row: Row) => {
    if (!canManage && !isOwnNote(row)) return toast.error('ليس لديك صلاحية الحذف');
    if (!window.confirm(`حذف «${row.title}»؟ يمكن استرجاعها لاحقًا.`)) return;
    const { error } = await supabase.from('shift_notes').update({
      deleted_at: new Date().toISOString(), deleted_by_id: user?.id || null, deleted_by_name: user?.name || null, updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return toast.error(`تعذر الحذف: ${error.message}`);
    await addLog(row.id, 'delete', 'حذف منطقي للملحوظة');
    await load();
  };

  const restore = async (row: Row) => {
    if (!canManage && !isOwnNote(row)) return toast.error('ليس لديك صلاحية الاسترجاع');
    const { error } = await supabase.from('shift_notes').update({ deleted_at: null, deleted_by_id: null, deleted_by_name: null, updated_at: new Date().toISOString() }).eq('id', row.id);
    if (error) return toast.error(`تعذر الاسترجاع: ${error.message}`);
    await addLog(row.id, 'restore', 'تم استرجاع الملحوظة');
    await load();
  };

  const handover = async () => {
    if (!canHandover) return toast.error('تسليم الشيفت متاح لمدير الفرع أو مشرف الشيفت فقط');
    const note = window.prompt('تعليق تسليم اختياري للشيفت التالي') || '';
    const { data, error } = await supabase.rpc('handover_open_shift_notes_v1', {
      p_user_id: user?.id || '', p_user_name: user?.name || 'النظام', p_note: note || null,
    });
    if (error) return toast.error(`تعذر تسليم الشيفت: ${error.message}`);
    toast.success(`تم تسليم ${Number(data || 0)} ملاحظة مفتوحة`);
    await load();
  };

  const openDetails = async (row: Row) => {
    setSelected(row);
    const [{ data: logRows }, { data: occRows }] = await Promise.all([
      supabase.from('shift_note_logs').select('*').eq('note_id', row.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('shift_note_occurrences').select('*').eq('note_id', row.id).order('occurrence_at').limit(200),
    ]);
    setLogs((logRows || []) as Row[]);
    setOccurrences((occRows || []) as Row[]);
  };

  const completeOccurrence = async (row: Row) => {
    if (!selected || !canOperateNote(selected)) return toast.error('التكرار ليس ضمن صلاحياتك');
    const note = window.prompt('تعليق تنفيذ هذه المرة')?.trim();
    if (!note) return;
    const { error } = await supabase.from('shift_note_occurrences').update({
      status: 'completed', completed_by_id: user?.id || null, completed_by_name: user?.name || null,
      completed_at: new Date().toISOString(), completion_note: note, notes: note, updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return toast.error(`تعذر تنفيذ التكرار: ${error.message}`);
    if (selected) await openDetails(selected);
  };

  const pageCount = Math.max(1, Math.ceil(workspace.total / PAGE_SIZE));
  const summaryCards = [
    ['all', 'الإجمالي', workspace.summary.total, ClipboardList],
    ['today', 'اليوم', workspace.summary.today, Clock3],
    ['assigned_pending', 'بانتظار الاستلام', workspace.summary.pending, UserRound],
    ['overdue', 'متأخرة', workspace.summary.overdue, AlertTriangle],
    ['urgent', 'عاجلة', workspace.summary.urgent, AlertTriangle],
    ['postponed', 'مؤجلة', workspace.summary.postponed, Clock3],
    ['completed_today', 'تمت اليوم', workspace.summary.completed, CheckCircle2],
    ['in_progress', 'قيد التنفيذ', workspace.summary.in_progress, RefreshCw],
  ] as const;

  return <div className="space-y-5" dir="rtl">
    <section className="dawaa-card dawaa-card--raised">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="dawaa-title flex items-center gap-2 text-2xl"><MessageSquare size={24} /> ملاحظات الشيفتات</h1>
          <p className="dawaa-caption mt-1">مسار واحد سريع للملاحظات، مع pagination من السيرفر وبحث العميل عند الطلب فقط.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canHandover ? <button onClick={() => void handover()} className="dawaa-button dawaa-button--primary"><Send size={16} /> تسليم المفتوح للشيفت التالي</button> : null}
          <button onClick={() => void load()} className="dawaa-button dawaa-button--secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
      {summaryCards.map(([key, label, value, Icon]) => <button key={key} onClick={() => setFilter(key)} className={`dawaa-card dawaa-card--interactive p-3 text-right ${filter === key ? 'dawaa-card--raised' : ''}`}>
        <Icon size={16} className="mb-2" /><div className="dawaa-title text-xl">{Number(value || 0).toLocaleString('ar-EG')}</div><div className="dawaa-caption text-xs">{label}</div>
      </button>)}
    </section>

    <section className="dawaa-card space-y-4">
      <div className="flex items-center justify-between"><h2 className="dawaa-title">{editing ? 'تعديل الملحوظة' : 'إضافة ملحوظة'}</h2>{editing ? <button onClick={resetForm} className="dawaa-button dawaa-button--ghost">إلغاء التعديل</button> : null}</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input className="dawaa-input xl:col-span-2" placeholder="عنوان الملحوظة *" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <select className="dawaa-select" value={form.note_kind} onChange={(e) => setForm((f) => ({ ...f, note_kind: e.target.value as NoteKind }))}><option value="note">ملاحظة معلوماتية</option><option value="action_task">مهمة تنفيذ</option></select>
        <select className="dawaa-select" value={form.action_required} disabled={form.note_kind !== 'action_task'} onChange={(e) => setForm((f) => ({ ...f, action_required: e.target.value }))}>{Object.entries(actionLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="dawaa-select" value={form.note_type} onChange={(e) => setForm((f) => ({ ...f, note_type: e.target.value }))}>{Object.entries(typeLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="dawaa-select" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as NotePriority }))}>{Object.entries(priorityLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="dawaa-select" value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}>{branchOptions.map((value) => <option key={value}>{value}</option>)}</select>
        <input type="datetime-local" className="dawaa-input" value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} />

        <div className="relative md:col-span-2 xl:col-span-4">
          <div className="dawaa-caption mb-1">العميل — بحث عند الطلب فقط</div>
          <div className="flex gap-2"><input className="dawaa-input flex-1" placeholder="اسم / كود / هاتف" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} /><button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => void searchCustomers()}>{customerLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} بحث</button></div>
          {customerResults.length ? <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border p-1" style={{ background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' }}>{customerResults.map((row) => <button key={String(row.id)} type="button" onClick={() => pickCustomer(row)} className="dawaa-button dawaa-button--ghost w-full justify-between text-right"><span>{row.name || row.customer_name}</span><span className="dawaa-caption">{row.customer_code || row.code || ''} · {row.phone || row.customer_phone || ''}</span></button>)}</div> : null}
        </div>
        <input className="dawaa-input" placeholder="اسم العميل" value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value, customer_id: '' }))} />
        <input className="dawaa-input" placeholder="كود العميل" value={form.customer_code} onChange={(e) => setForm((f) => ({ ...f, customer_code: e.target.value }))} />
        <input className="dawaa-input" placeholder="هاتف العميل" value={form.customer_phone} onChange={(e) => setForm((f) => ({ ...f, customer_phone: e.target.value }))} />
        <input className="dawaa-input" placeholder="رقم الفاتورة" value={form.invoice_no} onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))} />
        <select className="dawaa-select xl:col-span-2" value={form.assigned_to_name} onChange={(e) => setForm((f) => ({ ...f, assigned_to_name: e.target.value }))}><option value="">المسؤول</option>{staffChoices.map((s) => <option key={s.id} value={s.name}>{s.name} — {s.branch}</option>)}</select>
        <label className="dawaa-card dawaa-card--soft flex items-center gap-2 px-3 py-2"><input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} /> متكررة</label>
        <input type="number" min={1} className="dawaa-input" disabled={!form.is_recurring} value={form.repeat_days} onChange={(e) => setForm((f) => ({ ...f, repeat_days: Number(e.target.value) }))} placeholder="أيام التكرار" />
        {form.is_recurring ? <input className="dawaa-input xl:col-span-2" value={form.recurrence_times} onChange={(e) => setForm((f) => ({ ...f, recurrence_times: e.target.value }))} placeholder="09:00,21:00" /> : null}
        {form.note_type === 'collection' ? <><input className="dawaa-input" placeholder="المبلغ" value={form.amount_due} onChange={(e) => setForm((f) => ({ ...f, amount_due: e.target.value }))} /><input className="dawaa-input" placeholder="طريقة الدفع" value={form.expected_payment_method} onChange={(e) => setForm((f) => ({ ...f, expected_payment_method: e.target.value }))} /></> : null}
        {form.note_type === 'nursing' ? <input className="dawaa-input xl:col-span-2" placeholder="عنوان التمريض" value={form.patient_address} onChange={(e) => setForm((f) => ({ ...f, patient_address: e.target.value }))} /> : null}
        {form.note_type === 'delivery' ? <input className="dawaa-input xl:col-span-2" placeholder="عنوان الدليفري" value={form.delivery_address} onChange={(e) => setForm((f) => ({ ...f, delivery_address: e.target.value }))} /> : null}
        {form.note_type === 'customer_complaint' ? <><input className="dawaa-input" placeholder="مستوى الشكوى" value={form.complaint_level} onChange={(e) => setForm((f) => ({ ...f, complaint_level: e.target.value }))} /><input className="dawaa-input" placeholder="الإجراء المطلوب" value={form.resolution_required} onChange={(e) => setForm((f) => ({ ...f, resolution_required: e.target.value }))} /></> : null}
        <textarea className="dawaa-textarea md:col-span-2 xl:col-span-4" rows={3} placeholder="التفاصيل" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} />
      </div>
      <button onClick={() => void save()} disabled={saving} className="dawaa-button dawaa-button--primary">{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {editing ? 'حفظ التعديل' : 'إضافة الملحوظة'}</button>
    </section>

    <section className="dawaa-card grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="relative xl:col-span-2"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2" /><input className="dawaa-input w-full pr-9" placeholder="بحث في كل الملاحظات" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <select className="dawaa-select" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">الكل</option><option value="mine">ملاحظاتي</option><option value="today">اليوم</option><option value="tomorrow">بكرة</option><option value="overdue">المتأخرة</option><option value="urgent">العاجلة</option><option value="recurring">المتكررة</option><option value="assigned_pending">بانتظار الاستلام</option><option value="completed_today">تمت اليوم</option><option value="archive">الأرشيف</option><option value="postponed">المؤجلة</option><option value="new">جديدة</option><option value="in_progress">قيد التنفيذ</option><option value="completed">مكتملة</option><option value="cancelled">ملغية</option></select>
      <select className="dawaa-select" value={dimension} onChange={(e) => setDimension(e.target.value)}><option value="all">كل الفروع والأنواع</option><option>فرع شكري</option><option>فرع الشامي</option>{Object.entries(typeLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}{staffChoices.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
    </section>

    {loading ? <div className="dawaa-card py-12 text-center"><Loader2 className="mx-auto animate-spin" /></div> : !workspace.rows.length ? <div className="dawaa-empty-state py-12 text-center">لا توجد ملاحظات مطابقة.</div> : <div className="grid gap-4 xl:grid-cols-2">{workspace.rows.map((row) => {
      const phone = cleanEgyptianPhone(row.customer_phone || '');
      const canOperate = canOperateNote(row);
      const canEdit = canManage || isOwnNote(row);
      const canReceive = canManage || isAssignedNote(row);
      return <article key={row.id} className="dawaa-card">
        <div className="flex items-start justify-between gap-3"><div><h3 className="dawaa-title text-lg">{row.title}</h3><div className="mt-2 flex flex-wrap gap-1"><span className={`dawaa-badge ${noteBadge(row)}`}>{isOverdue(row) ? 'متأخرة' : statusLabels[row.status || 'new'] || row.status}</span><span className="dawaa-badge dawaa-badge--info">{typeLabels[row.note_type || 'general'] || row.note_type}</span><span className="dawaa-badge dawaa-badge--info">{row.branch || 'غير محدد'}</span>{row.handed_over ? <span className="dawaa-badge dawaa-badge--warning">تم التسليم</span> : null}</div></div><button onClick={() => void openDetails(row)} className="dawaa-button dawaa-button--ghost">التفاصيل</button></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><Mini label="العميل" value={row.customer_name || 'لا يوجد'} /><Mini label="وقت التنفيذ" value={dateLabel(row.due_at)} /><Mini label="المسؤول" value={row.assigned_to_name || 'غير محدد'} /><Mini label="الأولوية" value={priorityLabels[row.priority as NotePriority] || row.priority || 'عادي'} /></div>
        {row.details ? <p className="dawaa-body mt-3 line-clamp-2 text-sm">{row.details}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {row.status === 'assigned_pending' && canReceive ? <button onClick={() => void receive(row)} className="dawaa-button dawaa-button--primary"><CheckCircle2 size={14} /> استلام</button> : null}
          {row.status !== 'completed' && canOperate ? <button onClick={() => void updateStatus(row, 'completed')} className="dawaa-button dawaa-button--secondary">تم التنفيذ</button> : null}
          {!['completed','cancelled'].includes(String(row.status || '')) && canOperate ? <button onClick={() => void postpone(row)} className="dawaa-button dawaa-button--secondary"><Clock3 size={14} /> تأجيل</button> : null}
          {canEdit ? <button onClick={() => startEdit(row)} className="dawaa-button dawaa-button--secondary"><Edit3 size={14} /> تعديل</button> : null}
          {!['completed','cancelled'].includes(String(row.status || '')) && canOperate ? <button onClick={() => void updateStatus(row, 'cancelled')} className="dawaa-button dawaa-button--ghost">إلغاء</button> : null}
          {canEdit ? <button onClick={() => void softDelete(row)} className="dawaa-button dawaa-button--ghost"><Trash2 size={14} /> مسح</button> : null}
          {phone ? <a href={`tel:${phone}`} className="dawaa-button dawaa-button--ghost"><Phone size={14} /> اتصال</a> : null}
          {phone ? <a target="_blank" rel="noreferrer" href={generateWhatsAppLink(phone, 'حضرتك مع صيدليات دواء، بنتابع مع حضرتك بخصوص الملاحظة المسجلة لدينا.')} className="dawaa-button dawaa-button--ghost"><MessageSquare size={14} /> واتساب</a> : null}
        </div>
      </article>;
    })}</div>}

    <div className="flex items-center justify-between gap-3"><div className="dawaa-caption">صفحة {page + 1} من {pageCount} · {workspace.total.toLocaleString('ar-EG')} نتيجة</div><div className="flex gap-2"><button className="dawaa-button dawaa-button--secondary" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronRight size={15} /> السابق</button><button className="dawaa-button dawaa-button--secondary" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>التالي <ChevronLeft size={15} /></button></div></div>

    <section className="dawaa-card"><button onClick={() => setShowDeleted((v) => !v)} className="dawaa-button dawaa-button--secondary"><Trash2 size={15} /> {showDeleted ? 'إخفاء المحذوفات' : `المحذوفات (${workspace.deleted_rows.length})`}</button>{showDeleted ? <div className="mt-3 space-y-2">{workspace.deleted_rows.map((row) => <div key={row.id} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 p-3"><div><div className="dawaa-title text-sm">{row.title}</div><div className="dawaa-caption text-xs">حذفها {row.deleted_by_name || 'غير محدد'} · {dateLabel(row.deleted_at)}</div></div>{canManage || isOwnNote(row) ? <button onClick={() => void restore(row)} className="dawaa-button dawaa-button--ghost"><RotateCcw size={14} /> استرجاع</button> : null}</div>)}</div> : null}</section>

    {selected ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, var(--dawaa-theme-bg) 75%, transparent)' }} onMouseDown={(e) => { if (e.currentTarget === e.target) setSelected(null); }}><div className="dawaa-card max-h-[88vh] w-full max-w-4xl overflow-y-auto"><div className="flex items-start justify-between"><div><h2 className="dawaa-title text-xl">{selected.title}</h2><div className="dawaa-caption mt-1">{selected.author_name || 'النظام'} · {dateLabel(selected.created_at)}</div></div><button onClick={() => setSelected(null)} className="dawaa-button dawaa-button--ghost"><X size={16} /></button></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><Mini label="النوع" value={typeLabels[selected.note_type || 'general'] || selected.note_type} /><Mini label="الحالة" value={isOverdue(selected) ? 'متأخرة' : statusLabels[selected.status || 'new'] || selected.status} /><Mini label="الفرع" value={selected.branch || 'غير محدد'} /><Mini label="العميل" value={selected.customer_name || 'لا يوجد'} /><Mini label="الهاتف" value={selected.customer_phone || 'لا يوجد'} /><Mini label="الفاتورة" value={selected.invoice_no || 'لا يوجد'} /></div>{selected.details ? <div className="dawaa-card dawaa-card--soft mt-4 p-3">{selected.details}</div> : null}<div className="mt-5 grid gap-4 lg:grid-cols-2"><div><h3 className="dawaa-title mb-2">سجل الإجراءات</h3><div className="space-y-2">{logs.length ? logs.map((log) => <div key={log.id} className="dawaa-card dawaa-card--soft p-3 text-sm"><div className="font-bold">{log.action} — {log.actor_name || 'النظام'}</div><div className="dawaa-caption text-xs">{dateLabel(log.created_at)}</div>{log.details ? <div className="mt-1">{log.details}</div> : null}</div>) : <div className="dawaa-caption">لا يوجد سجل.</div>}</div></div><div><h3 className="dawaa-title mb-2">التكرارات</h3><div className="space-y-2">{occurrences.length ? occurrences.map((occ) => <div key={occ.id} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-2 p-3 text-sm"><div><div>{dateLabel(occ.scheduled_time || occ.occurrence_at)}</div>{occ.completion_note ? <div className="dawaa-caption text-xs">{occ.completion_note}</div> : null}</div>{occ.status !== 'completed' && canOperateNote(selected) ? <button onClick={() => void completeOccurrence(occ)} className="dawaa-button dawaa-button--ghost">تمت</button> : occ.status === 'completed' ? <span className="dawaa-badge dawaa-badge--success">مكتملة</span> : null}</div>) : <div className="dawaa-caption">لا توجد تكرارات.</div>}</div></div></div></div></div> : null}
  </div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="dawaa-card dawaa-card--soft p-3"><div className="dawaa-caption text-xs">{label}</div><div className="dawaa-title mt-1 text-sm">{value}</div></div>;
}
