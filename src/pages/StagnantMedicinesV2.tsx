import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Edit, Package, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, getCurrentUserProfile } from '@/hooks/useAuth';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { canViewAllBranches, canViewBranchData } from '@/lib/security/userDataScope';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { supabase } from '@/lib/supabase';
import { logActivity as writeActivityLog } from '@/lib/activityLog';
import { persistPointsTransaction } from '@/lib/pointsPersistence';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { useDebounce } from '@/hooks/useDebounce';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type ExpiryBatch = { expiry_date: string; quantity: number };

type StagnantMedicine = {
  id: string;
  medicine_name?: string | null;
  product_name?: string | null;
  product_code?: string | null;
  usage?: string | null;
  category?: string | null;
  product_type?: string | null;
  expiry_date?: string | null;
  nearest_expiry_date?: string | null;
  quantity_available?: number | null;
  total_quantity?: number | null;
  remaining_quantity?: number | null;
  dispensed_quantity?: number | null;
  branch?: string | null;
  branch_name?: string | null;
  branch_id?: string | null;
  priority?: string | null;
  notes?: string | null;
  batch_details?: ExpiryBatch[] | null;
  responsible_doctor?: string | null;
  responsible_doctor_id?: string | null;
  responsible_doctor_name?: string | null;
  target_min_percent?: number | null;
  target_min_quantity?: number | null;
  minimum_remaining_percent?: number | null;
  incentive_per_unit?: number | null;
  product_price?: number | null;
  unit_price?: number | null;
  status?: string | null;
  source_file_date?: string | null;
  stagnant_file_date?: string | null;
  last_dispense_date?: string | null;
  last_dispensed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StaffRow = {
  id: string;
  name: string;
  role?: string | null;
  branch?: string | null;
  branch_id?: string | null;
};

type CustomerHit = {
  customer_id?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
  last_invoice_date?: string | null;
};

type CycleMetric = {
  stagnant_medicine_id: string;
  dispensed_quantity: number;
  total_incentive: number;
  dispense_count: number;
  last_dispensed_at?: string | null;
};

type DispenseRow = {
  id: string;
  stagnant_medicine_id: string;
  product_name?: string | null;
  doctor_id?: string | null;
  doctor_name?: string | null;
  branch_name?: string | null;
  quantity?: number | null;
  incentive_per_unit?: number | null;
  total_incentive?: number | null;
  dispensed_at?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  invoice_no?: string | null;
  notes?: string | null;
};

const BLANK_MEDICINE = {
  medicine_name: '',
  product_code: '',
  usage: '',
  quantity: 0,
  expiry_date: '',
  responsible_doctor_id: '',
  target_min_percent: 0,
  incentive_per_unit: 0,
  product_price: 0,
  priority: 'medium',
  notes: '',
};

const BLANK_DISPENSE = {
  doctor_id: '',
  quantity: 1,
  customer_id: '',
  customer_name: '',
  customer_code: '',
  customer_phone: '',
  invoice_no: '',
  notes: '',
};

function medicineName(row: StagnantMedicine) {
  return String(row.product_name || row.medicine_name || '').trim();
}

function totalQuantity(row: StagnantMedicine) {
  return Number(row.total_quantity ?? row.quantity_available ?? 0);
}

function storedDispensed(row: StagnantMedicine) {
  return Number(row.dispensed_quantity || 0);
}

function remainingQuantity(row: StagnantMedicine) {
  return Math.max(0, Number(row.remaining_quantity ?? totalQuantity(row) - storedDispensed(row)));
}

function isDoctor(row: StaffRow) {
  const value = `${row.role || ''} ${row.name || ''}`;
  return /دكتور|صيدلي|صيدلاني|doctor|pharmacist|^د\//i.test(value);
}

function priorityLabel(value?: string | null) {
  if (value === 'high' || value === 'عالية') return 'عالية';
  if (value === 'low' || value === 'منخفضة') return 'منخفضة';
  return 'متوسطة';
}

export default function StagnantMedicinesV2() {
  const { user, canManage } = useAuth();
  const cycle = getCurrentCycle();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [medicineModal, setMedicineModal] = useState(false);
  const [dispenseModal, setDispenseModal] = useState(false);
  const [historyModal, setHistoryModal] = useState(false);
  const [editing, setEditing] = useState<StagnantMedicine | null>(null);
  const [selected, setSelected] = useState<StagnantMedicine | null>(null);
  const [medicineForm, setMedicineForm] = useState(BLANK_MEDICINE);
  const [dispenseForm, setDispenseForm] = useState(BLANK_DISPENSE);
  const [customerQuery, setCustomerQuery] = useState('');
  const debouncedCustomerQuery = useDebounce(customerQuery, 300);
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [metrics, setMetrics] = useState<CycleMetric[]>([]);
  const [history, setHistory] = useState<DispenseRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const metricsRequestRef = useRef(0);
  const customerRequestRef = useRef(0);

  useEscapeKey(() => setMedicineModal(false), medicineModal);
  useEscapeKey(() => setDispenseModal(false), dispenseModal);
  useEscapeKey(() => setHistoryModal(false), historyModal);

  const {
    data: medicines,
    loading,
    refetch,
  } = useSupabaseQuery<StagnantMedicine>({
    table: 'stagnant_medicines',
    orderBy: { column: 'updated_at', ascending: false },
    realtimeEnabled: true,
    freshness: 'live',
  });

  const { data: staffRows } = useSupabaseQuery<StaffRow>({
    table: 'staff',
    select: 'id,name,role,branch,branch_id,active,is_active,status,deleted_at,is_deleted',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: false,
    freshness: 'standard',
  });

  const doctors = useMemo(() => (staffRows || []).filter(isDoctor), [staffRows]);

  const loadMetrics = useCallback(async () => {
    if (!user) return;
    const requestId = ++metricsRequestRef.current;
    const { data, error } = await supabase.rpc('get_stagnant_cycle_metrics_v1', {
      p_start: cycle.start.toISOString().slice(0, 10),
      p_end: cycle.end.toISOString().slice(0, 10),
      p_branch: canViewAllBranches(user) ? null : user.branch || null,
    });
    if (requestId !== metricsRequestRef.current) return;
    if (error) {
      console.warn('[stagnant] cycle metrics unavailable', error);
      setMetrics([]);
      return;
    }
    setMetrics((data || []) as CycleMetric[]);
  }, [cycle.end, cycle.start, user]);

  useEffect(() => {
    void loadMetrics();
    return () => { metricsRequestRef.current += 1; };
  }, [loadMetrics]);

  useEffect(() => {
    const query = debouncedCustomerQuery.trim();
    if (!dispenseModal || query.length < 2) {
      setCustomerHits([]);
      return;
    }
    const requestId = ++customerRequestRef.current;
    setCustomerLoading(true);
    void supabase
      .rpc('search_stagnant_customers_v1', {
        p_search: query,
        p_branch: canViewAllBranches(user) ? null : user?.branch || null,
        p_limit: 50,
      })
      .then(({ data, error }) => {
        if (requestId !== customerRequestRef.current) return;
        if (error) {
          setCustomerHits([]);
          return;
        }
        setCustomerHits((data || []) as CustomerHit[]);
      })
      .finally(() => {
        if (requestId === customerRequestRef.current) setCustomerLoading(false);
      });
  }, [debouncedCustomerQuery, dispenseModal, user]);

  const metricByMedicine = useMemo(() => {
    const map = new Map<string, CycleMetric>();
    metrics.forEach((row) => map.set(String(row.stagnant_medicine_id), row));
    return map;
  }, [metrics]);

  const visibleMedicines = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return (medicines || [])
      .filter((row) => canViewAllBranches(user) || canViewBranchData(user, row.branch_name || row.branch))
      .filter((row) => !branchFilter || row.branch_name === branchFilter || row.branch === branchFilter)
      .filter((row) => !statusFilter || String(row.status || 'نشط') === statusFilter)
      .filter((row) => {
        if (!needle) return true;
        return `${medicineName(row)} ${row.product_code || ''} ${row.responsible_doctor_name || row.responsible_doctor || ''}`
          .toLowerCase()
          .includes(needle);
      });
  }, [branchFilter, debouncedSearch, medicines, statusFilter, user]);

  const stats = useMemo(() => {
    const total = visibleMedicines.length;
    const units = visibleMedicines.reduce((sum, row) => sum + totalQuantity(row), 0);
    const remaining = visibleMedicines.reduce((sum, row) => sum + remainingQuantity(row), 0);
    const movedThisCycle = visibleMedicines.reduce(
      (sum, row) => sum + Number(metricByMedicine.get(row.id)?.dispensed_quantity || 0),
      0
    );
    return { total, units, remaining, movedThisCycle };
  }, [metricByMedicine, visibleMedicines]);

  const openCreate = () => {
    setEditing(null);
    setMedicineForm(BLANK_MEDICINE);
    setMedicineModal(true);
  };

  const openEdit = (row: StagnantMedicine) => {
    setEditing(row);
    setMedicineForm({
      medicine_name: medicineName(row),
      product_code: row.product_code || '',
      usage: row.usage || row.category || row.product_type || '',
      quantity: totalQuantity(row),
      expiry_date: row.nearest_expiry_date || row.expiry_date || '',
      responsible_doctor_id: row.responsible_doctor_id || '',
      target_min_percent: Number(row.target_min_percent ?? row.minimum_remaining_percent ?? 0),
      incentive_per_unit: Number(row.incentive_per_unit || 0),
      product_price: Number(row.product_price ?? row.unit_price ?? 0),
      priority: row.priority || 'medium',
      notes: row.notes || '',
    });
    setMedicineModal(true);
  };

  const saveMedicine = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const name = medicineForm.medicine_name.trim();
    const doctor = doctors.find((row) => row.id === medicineForm.responsible_doctor_id);
    const quantity = Number(medicineForm.quantity || 0);
    if (!name) return toast.error('اسم الصنف مطلوب');
    if (!doctor) return toast.error('اختر الدكتور المسؤول');
    if (quantity < storedDispensed(editing || {})) return toast.error('الكمية الإجمالية أقل من المصروف الفعلي');

    const profile = getCurrentUserProfile();
    const branchName = doctor.branch || user.branch || 'الكل';
    const dispensed = editing ? storedDispensed(editing) : 0;
    const targetPercent = Number(medicineForm.target_min_percent || 0);
    const now = new Date().toISOString();
    const payload = {
      medicine_name: name,
      product_name: name,
      product_code: medicineForm.product_code.trim() || null,
      usage: medicineForm.usage.trim() || null,
      category: medicineForm.usage.trim() || null,
      product_type: medicineForm.usage.trim() || null,
      expiry_date: medicineForm.expiry_date || null,
      nearest_expiry_date: medicineForm.expiry_date || null,
      quantity_available: quantity,
      total_quantity: quantity,
      dispensed_quantity: dispensed,
      remaining_quantity: Math.max(0, quantity - dispensed),
      responsible_doctor: doctor.name,
      responsible_doctor_id: doctor.id,
      responsible_doctor_name: doctor.name,
      doctor_id: doctor.id,
      target_min_percent: targetPercent,
      minimum_remaining_percent: targetPercent,
      target_min_quantity: Math.ceil((quantity * targetPercent) / 100),
      incentive_per_unit: Number(medicineForm.incentive_per_unit || 0),
      product_price: Number(medicineForm.product_price || 0),
      unit_price: Number(medicineForm.product_price || 0),
      priority: medicineForm.priority || 'medium',
      notes: medicineForm.notes.trim() || null,
      branch: branchName,
      branch_name: branchName,
      branch_id: doctor.branch_id || null,
      source_file_date: editing?.source_file_date || new Date().toISOString().slice(0, 10),
      stagnant_file_date: editing?.stagnant_file_date || new Date().toISOString().slice(0, 10),
      status: quantity - dispensed <= 0 ? 'محقق' : editing?.status || 'نشط',
      updated_at: now,
      ...(!editing ? { created_by: profile.id } : {}),
    };

    setSaving(true);
    try {
      const query = editing
        ? supabase.from('stagnant_medicines').update(payload).eq('id', editing.id).select('id').single()
        : supabase.from('stagnant_medicines').insert(payload).select('id').single();
      const { data, error } = await query;
      if (error) throw error;
      const id = String(data?.id || editing?.id || '');
      await writeActivityLog({
        user_id: profile.id,
        user_name: profile.name,
        user_role: profile.role,
        action: editing ? 'تعديل صنف راكد' : 'إضافة صنف راكد',
        module: 'الأدوية الرواكد',
        target_type: 'stagnant_medicine',
        target_id: id,
        branch_name: branchName,
        old_value: editing || null,
        new_value: payload,
        details: { target_title: name, summary: editing ? 'تم تعديل الصنف' : 'تم إضافة الصنف' },
        route_path: `/stagnant-medicines?id=${id}`,
      });
      toast.success(editing ? 'تم تحديث الصنف' : 'تم إضافة الصنف');
      setMedicineModal(false);
      await refetch();
      await loadMetrics();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'تعذر حفظ الصنف');
    } finally {
      setSaving(false);
    }
  };

  const deleteMedicine = async (row: StagnantMedicine) => {
    if (!canManage || !confirm(`حذف ${medicineName(row)}؟`)) return;
    const profile = getCurrentUserProfile();
    const { error } = await supabase.from('stagnant_medicines').delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    await writeActivityLog({
      user_id: profile.id,
      user_name: profile.name,
      user_role: profile.role,
      action: 'حذف صنف راكد',
      module: 'الأدوية الرواكد',
      target_type: 'stagnant_medicine',
      target_id: row.id,
      branch_name: row.branch_name || row.branch || '',
      old_value: row,
      new_value: null,
      details: { target_title: medicineName(row), summary: 'تم حذف الصنف' },
      route_path: '/stagnant-medicines',
    });
    toast.success('تم حذف الصنف');
    await refetch();
  };

  const openDispense = (row: StagnantMedicine) => {
    setSelected(row);
    setDispenseForm({ ...BLANK_DISPENSE, doctor_id: row.responsible_doctor_id || '', quantity: 1 });
    setCustomerQuery('');
    setCustomerHits([]);
    setDispenseModal(true);
  };

  const chooseCustomer = (customer: CustomerHit) => {
    setDispenseForm((current) => ({
      ...current,
      customer_id: customer.customer_id || '',
      customer_name: customer.customer_name || '',
      customer_code: customer.customer_code || '',
      customer_phone: customer.customer_phone || '',
    }));
    setCustomerQuery(customer.customer_name || customer.customer_code || customer.customer_phone || '');
    setCustomerHits([]);
  };

  const saveDispense = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !user) return;
    const quantity = Number(dispenseForm.quantity || 0);
    const remaining = remainingQuantity(selected);
    const doctor = doctors.find((row) => row.id === dispenseForm.doctor_id);
    if (!doctor) return toast.error('اختر الدكتور الذي صرف الصنف');
    if (!Number.isFinite(quantity) || quantity <= 0) return toast.error('أدخل كمية صحيحة');
    if (quantity > remaining) return toast.error(`المتاح فقط ${remaining}`);
    if (!dispenseForm.customer_name && !dispenseForm.customer_code && !dispenseForm.customer_phone) {
      return toast.error('ابحث عن العميل واختره أولًا');
    }

    const profile = getCurrentUserProfile();
    const product = medicineName(selected);
    const incentivePerUnit = Number(selected.incentive_per_unit || 0);
    const totalIncentive = quantity * incentivePerUnit;
    const dispensedAt = new Date().toISOString();
    const branchName = doctor.branch || selected.branch_name || selected.branch || user.branch || '';
    const payload = {
      stagnant_medicine_id: selected.id,
      product_name: product,
      product_code: selected.product_code || null,
      doctor_id: doctor.id,
      doctor_name: doctor.name,
      branch_id: doctor.branch_id || selected.branch_id || null,
      branch_name: branchName,
      quantity,
      incentive_per_unit: incentivePerUnit,
      total_incentive: totalIncentive,
      product_expiry_date: selected.nearest_expiry_date || selected.expiry_date || null,
      dispensed_at: dispensedAt,
      customer_id: dispenseForm.customer_id || null,
      customer_name: dispenseForm.customer_name || null,
      customer_code: dispenseForm.customer_code || null,
      customer_phone: dispenseForm.customer_phone || null,
      invoice_no: dispenseForm.invoice_no.trim() || null,
      notes: dispenseForm.notes.trim() || null,
      created_by: profile.id,
    };

    setSaving(true);
    try {
      const { data, error } = await supabase.from('stagnant_medicine_dispenses').insert(payload).select('id').single();
      if (error) throw error;
      const nextDispensed = storedDispensed(selected) + quantity;
      const nextRemaining = Math.max(0, totalQuantity(selected) - nextDispensed);
      const { error: updateError } = await supabase
        .from('stagnant_medicines')
        .update({
          dispensed_quantity: nextDispensed,
          remaining_quantity: nextRemaining,
          last_dispensed_at: dispensedAt,
          last_dispense_date: dispensedAt.slice(0, 10),
          status: nextRemaining <= 0 ? 'محقق' : selected.status || 'نشط',
          updated_at: dispensedAt,
        })
        .eq('id', selected.id);
      if (updateError) throw updateError;

      await writeActivityLog({
        user_id: profile.id,
        user_name: profile.name,
        user_role: profile.role,
        action: 'تسجيل صرف صنف راكد',
        module: 'الأدوية الرواكد',
        target_type: 'stagnant_medicine_dispense',
        target_id: data?.id || selected.id,
        branch_name: branchName,
        old_value: { remaining_quantity: remaining, dispensed_quantity: storedDispensed(selected) },
        new_value: { ...payload, remaining_quantity: nextRemaining, dispensed_quantity: nextDispensed },
        details: { target_title: product, summary: `${quantity} × ${product} - ${doctor.name}` },
        route_path: `/stagnant-medicines?id=${selected.id}`,
      });

      void createStaffNotification({
        recipientStaffId: doctor.id,
        type: 'stagnant_sale',
        title: 'تم تسجيل بيع صنف راكد باسمك',
        message: totalIncentive ? `${quantity} × ${product} — حافز ${totalIncentive.toFixed(0)} جنيه.` : `${quantity} × ${product}.`,
        priority: 'normal',
        entityType: 'stagnant_medicine_dispense',
        entityId: data?.id || undefined,
        actionUrl: '/doctor-dashboard?tab=requirements',
      }).catch(() => null);

      if (totalIncentive > 0) {
        const pointsResult = await persistPointsTransaction({
          employeeId: doctor.id,
          employeeName: doctor.name,
          branch: branchName,
          branchId: doctor.branch_id || selected.branch_id,
          operation: 'bonus',
          rule: null,
          pointsToStore: totalIncentive,
          userNote: `حافز صرف صنف راكد: ${product}`,
          createdByName: profile.name,
          createdById: profile.id,
          createdByRole: profile.role,
          status: 'approved',
          cycle,
          sourceModule: 'stagnant_medicines',
          source: 'stagnant_medicine_dispense',
          sourceRecordId: data?.id || selected.id,
          reasonLabel: `حافز صرف صنف راكد: ${product}`,
          description: `صرف ${quantity} وحدة من ${product}`,
        });
        if (pointsResult.error) toast.warning(`تم الصرف لكن تعذر تسجيل الحافز: ${pointsResult.error}`);
      }

      toast.success('تم تسجيل الصرف بنجاح');
      setDispenseModal(false);
      await refetch();
      await loadMetrics();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'تعذر تسجيل الصرف');
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (row: StagnantMedicine) => {
    setSelected(row);
    setHistory([]);
    setHistoryModal(true);
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('stagnant_medicine_dispenses')
      .select('id,stagnant_medicine_id,product_name,doctor_id,doctor_name,branch_name,quantity,incentive_per_unit,total_incentive,dispensed_at,customer_name,customer_code,customer_phone,invoice_no,notes')
      .eq('stagnant_medicine_id', row.id)
      .order('dispensed_at', { ascending: false })
      .limit(100);
    setHistoryLoading(false);
    if (error) return toast.error(error.message);
    setHistory((data || []) as DispenseRow[]);
  };

  const canEdit = canManage || user?.permissions?.edit_stagnant_medicine === true;
  const canCreate = canManage || user?.permissions?.create_stagnant_medicine === true;
  const canDispense = canManage || user?.permissions?.dispense_stagnant_medicine === true || isDoctor({ id: '', name: user?.name || '', role: user?.role || '' });

  return (
    <div className="space-y-5" dir="rtl">
      <header className="dawaa-card dawaa-card--raised">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="dawaa-caption">Stagnant Workspace V2</div>
            <h1 className="dawaa-title mt-1 text-2xl">الأدوية الرواكد</h1>
            <p className="dawaa-body mt-2 max-w-3xl">مسار موحّد وخفيف: الرواكد فقط عند فتح الصفحة، العملاء عند البحث، وتاريخ الصرف عند طلبه.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => { void refetch(); void loadMetrics(); }}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canCreate ? <button type="button" className="dawaa-button dawaa-button--primary" onClick={openCreate}><Plus size={16} /> إضافة صنف</button> : null}
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="الأصناف" value={stats.total} />
        <Metric label="إجمالي الوحدات" value={stats.units} />
        <Metric label="المتبقي" value={stats.remaining} />
        <Metric label="تحريك الدورة" value={stats.movedThisCycle} />
      </section>

      <section className="dawaa-toolbar grid gap-3 md:grid-cols-4">
        <label className="relative md:col-span-2">
          <Search className="dawaa-muted absolute right-3 top-1/2 -translate-y-1/2" size={16} />
          <input className="dawaa-input w-full pr-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الصنف أو الكود أو الدكتور..." />
        </label>
        <select className="dawaa-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="">كل الفروع المتاحة</option>
          {[...new Set((medicines || []).map((row) => row.branch_name || row.branch).filter(Boolean))].map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
        </select>
        <select className="dawaa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="نشط">نشط</option>
          <option value="محقق">محقق</option>
          <option value="متوقف">متوقف</option>
        </select>
      </section>

      {loading ? <div className="dawaa-card dawaa-muted py-14 text-center">جاري تحميل الرواكد...</div> : null}
      {!loading && !visibleMedicines.length ? <div className="dawaa-empty-state py-14 text-center">لا توجد أصناف مطابقة.</div> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        {visibleMedicines.map((row) => {
          const cycleMetric = metricByMedicine.get(row.id);
          const remaining = remainingQuantity(row);
          return (
            <article key={row.id} className="dawaa-card dawaa-card--interactive">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="dawaa-heading text-lg font-black">{medicineName(row)}</h2>
                  <div className="dawaa-muted mt-1 text-xs">{row.product_code ? `كود ${row.product_code} · ` : ''}{row.branch_name || row.branch || 'بدون فرع'}</div>
                </div>
                <span className="dawaa-badge dawaa-badge--warning">{priorityLabel(row.priority)}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Small label="الإجمالي" value={totalQuantity(row)} />
                <Small label="المصروف" value={storedDispensed(row)} />
                <Small label="المتبقي" value={remaining} />
                <Small label="هذه الدورة" value={Number(cycleMetric?.dispensed_quantity || 0)} />
              </div>

              <div className="dawaa-surface-soft mt-4 grid gap-2 rounded-2xl p-3 text-sm sm:grid-cols-2">
                <div><span className="dawaa-muted">المسؤول: </span><strong className="dawaa-heading">{row.responsible_doctor_name || row.responsible_doctor || 'غير محدد'}</strong></div>
                <div><span className="dawaa-muted">أقرب انتهاء: </span><strong className="dawaa-heading">{row.nearest_expiry_date || row.expiry_date || '—'}</strong></div>
                <div><span className="dawaa-muted">حافز الوحدة: </span><strong className="dawaa-heading">{Number(row.incentive_per_unit || 0).toLocaleString('ar-EG')} ج</strong></div>
                <div><span className="dawaa-muted">حافز الدورة: </span><strong className="dawaa-heading">{Number(cycleMetric?.total_incentive || 0).toLocaleString('ar-EG')} ج</strong></div>
              </div>

              {row.notes ? <p className="dawaa-body mt-3 text-sm">{row.notes}</p> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {canDispense && remaining > 0 ? <button type="button" className="dawaa-button dawaa-button--primary" onClick={() => openDispense(row)}><Package size={15} /> تسجيل صرف</button> : null}
                <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => void openHistory(row)}><Calendar size={15} /> سجل الصرف</button>
                {canEdit ? <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => openEdit(row)}><Edit size={15} /> تعديل</button> : null}
                {canManage ? <button type="button" className="dawaa-button dawaa-button--ghost" onClick={() => void deleteMedicine(row)}><Trash2 size={15} /> حذف</button> : null}
              </div>
            </article>
          );
        })}
      </section>

      {medicineModal ? (
        <Modal title={editing ? 'تعديل صنف راكد' : 'إضافة صنف راكد'} onClose={() => setMedicineModal(false)}>
          <form onSubmit={saveMedicine} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="اسم الصنف *" value={medicineForm.medicine_name} onChange={(value) => setMedicineForm((f) => ({ ...f, medicine_name: value }))} />
              <Field label="كود الصنف" value={medicineForm.product_code} onChange={(value) => setMedicineForm((f) => ({ ...f, product_code: value }))} />
              <Field label="الاستخدام / الفئة" value={medicineForm.usage} onChange={(value) => setMedicineForm((f) => ({ ...f, usage: value }))} />
              <label className="space-y-1"><span className="dawaa-caption">الدكتور المسؤول *</span><select className="dawaa-select w-full" value={medicineForm.responsible_doctor_id} onChange={(e) => setMedicineForm((f) => ({ ...f, responsible_doctor_id: e.target.value }))}><option value="">اختر الدكتور</option>{doctors.map((row) => <option key={row.id} value={row.id}>{row.name}{row.branch ? ` - ${row.branch}` : ''}</option>)}</select></label>
              <Field type="number" label="الكمية الإجمالية" value={medicineForm.quantity} onChange={(value) => setMedicineForm((f) => ({ ...f, quantity: Number(value) }))} />
              <Field type="date" label="أقرب انتهاء" value={medicineForm.expiry_date} onChange={(value) => setMedicineForm((f) => ({ ...f, expiry_date: value }))} />
              <Field type="number" label="نسبة الهدف %" value={medicineForm.target_min_percent} onChange={(value) => setMedicineForm((f) => ({ ...f, target_min_percent: Number(value) }))} />
              <Field type="number" label="حافز الوحدة" value={medicineForm.incentive_per_unit} onChange={(value) => setMedicineForm((f) => ({ ...f, incentive_per_unit: Number(value) }))} />
              <Field type="number" label="سعر الوحدة" value={medicineForm.product_price} onChange={(value) => setMedicineForm((f) => ({ ...f, product_price: Number(value) }))} />
              <label className="space-y-1"><span className="dawaa-caption">الأولوية</span><select className="dawaa-select w-full" value={medicineForm.priority} onChange={(e) => setMedicineForm((f) => ({ ...f, priority: e.target.value }))}><option value="high">عالية</option><option value="medium">متوسطة</option><option value="low">منخفضة</option></select></label>
            </div>
            <label className="block space-y-1"><span className="dawaa-caption">ملاحظات</span><textarea className="dawaa-textarea w-full" value={medicineForm.notes} onChange={(e) => setMedicineForm((f) => ({ ...f, notes: e.target.value }))} /></label>
            <button className="dawaa-button dawaa-button--primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
          </form>
        </Modal>
      ) : null}

      {dispenseModal && selected ? (
        <Modal title={`تسجيل صرف — ${medicineName(selected)}`} onClose={() => setDispenseModal(false)}>
          <form onSubmit={saveDispense} className="space-y-4">
            <div className="dawaa-alert dawaa-alert--info text-sm">المتبقي حاليًا: <strong>{remainingQuantity(selected)}</strong></div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1"><span className="dawaa-caption">الدكتور الذي صرف *</span><select className="dawaa-select w-full" value={dispenseForm.doctor_id} onChange={(e) => setDispenseForm((f) => ({ ...f, doctor_id: e.target.value }))}><option value="">اختر الدكتور</option>{doctors.map((row) => <option key={row.id} value={row.id}>{row.name}{row.branch ? ` - ${row.branch}` : ''}</option>)}</select></label>
              <Field type="number" label="الكمية *" value={dispenseForm.quantity} onChange={(value) => setDispenseForm((f) => ({ ...f, quantity: Number(value) }))} />
            </div>

            <div className="dawaa-card dawaa-card--soft space-y-3">
              <label className="relative block"><Search className="dawaa-muted absolute right-3 top-1/2 -translate-y-1/2" size={15} /><input className="dawaa-input w-full pr-9" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="ابحث بالاسم أو الكود أو الهاتف..." /></label>
              {customerLoading ? <div className="dawaa-muted text-sm">جاري البحث...</div> : null}
              {customerHits.length ? <div className="max-h-56 space-y-2 overflow-y-auto">{customerHits.map((row, index) => <button key={`${row.customer_id || row.customer_code}-${index}`} type="button" className="dawaa-card dawaa-card--interactive w-full p-3 text-right" onClick={() => chooseCustomer(row)}><div className="dawaa-heading font-bold">{row.customer_name || 'بدون اسم'}</div><div className="dawaa-muted mt-1 text-xs">{row.customer_code || 'بدون كود'} · {row.customer_phone || 'بدون هاتف'}{row.branch ? ` · ${row.branch}` : ''}</div></button>)}</div> : null}
              {dispenseForm.customer_name || dispenseForm.customer_code ? <div className="dawaa-alert dawaa-alert--success text-sm">العميل المختار: <strong>{dispenseForm.customer_name || dispenseForm.customer_code}</strong></div> : null}
            </div>

            <Field label="رقم الفاتورة (اختياري)" value={dispenseForm.invoice_no} onChange={(value) => setDispenseForm((f) => ({ ...f, invoice_no: value }))} />
            <label className="block space-y-1"><span className="dawaa-caption">ملاحظات</span><textarea className="dawaa-textarea w-full" value={dispenseForm.notes} onChange={(e) => setDispenseForm((f) => ({ ...f, notes: e.target.value }))} /></label>
            <button className="dawaa-button dawaa-button--primary" disabled={saving}>{saving ? 'جاري التسجيل...' : 'تسجيل الصرف'}</button>
          </form>
        </Modal>
      ) : null}

      {historyModal && selected ? (
        <Modal title={`سجل صرف — ${medicineName(selected)}`} onClose={() => setHistoryModal(false)}>
          {historyLoading ? <div className="dawaa-muted py-10 text-center">جاري تحميل السجل...</div> : !history.length ? <div className="dawaa-empty-state py-10 text-center">لا توجد حركات صرف.</div> : <div className="space-y-2">{history.map((row) => <div key={row.id} className="dawaa-card dawaa-card--soft p-3"><div className="flex items-center justify-between gap-3"><div className="dawaa-heading font-bold">{row.quantity || 0} × {row.customer_name || row.customer_code || 'عميل'}</div><div className="dawaa-muted text-xs">{row.dispensed_at ? new Date(row.dispensed_at).toLocaleString('ar-EG') : ''}</div></div><div className="dawaa-muted mt-1 text-xs">{row.doctor_name || 'دكتور غير محدد'}{row.invoice_no ? ` · فاتورة ${row.invoice_no}` : ''}{row.total_incentive ? ` · حافز ${row.total_incentive} ج` : ''}</div></div>)}</div>}
        </Modal>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="dawaa-card dawaa-card--soft"><div className="dawaa-caption">{label}</div><div className="dawaa-heading num mt-2 text-2xl font-black">{Number(value || 0).toLocaleString('ar-EG')}</div></div>;
}

function Small({ label, value }: { label: string; value: number }) {
  return <div className="dawaa-surface-soft rounded-xl p-3"><div className="dawaa-caption">{label}</div><div className="dawaa-heading num mt-1 font-black">{Number(value || 0).toLocaleString('ar-EG')}</div></div>;
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label className="space-y-1"><span className="dawaa-caption">{label}</span><input className="dawaa-input w-full" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--dawaa-theme-overlay)] p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><div className="dawaa-card max-h-[90vh] w-full max-w-3xl overflow-y-auto"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="dawaa-title text-xl">{title}</h2><button type="button" onClick={onClose} className="dawaa-button dawaa-button--ghost"><X size={17} /></button></div>{children}</div></div>;
}
