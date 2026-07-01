import { useMemo, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Link } from 'react-router-dom';
import {
  Plus,
  TrendingUp,
  DollarSign,
  Trash2,
  Edit,
  ToggleLeft,
  ToggleRight,
  Package,
  UserRound,
  Award,
} from 'lucide-react';
import { useSupabaseQuery, logActivity } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { useAuth, getCurrentUserProfile } from '@/hooks/useAuth';
import { canViewAllBranches, canViewBranchData } from '@/lib/security/userDataScope';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { persistPointsTransaction } from '@/lib/pointsPersistence';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import {
  groupDoctorTotals,
  movementTotalForMedicine,
  requiredQuantity,
  targetAchieved,
} from '@/lib/medicinePerformance';
import { triggerCelebration } from '@/lib/celebration';
import { staffProfilePath } from '@/lib/staff/staffIdentityResolver';

interface IncentiveMedicine {
  id: string;
  product_name: string;
  incentive_value: number | null;
  incentive_type?: 'fixed' | 'percent' | string | null;
  incentive_percent?: number | null;
  product_price?: number | null;
  product_type?: string | null;
  current_quantity: number | null;
  sold_quantity?: number | null;
  target_min_percent?: number | null;
  target_min_quantity?: number | null;
  doctor_id?: string | null;
  responsible_doctor?: string | null;
  source_file_date?: string | null;
  branch: string | null;
  active: boolean | null;
  effective_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_by: string | null;
}

interface IncentiveSaleRecord {
  id: string;
  medicine_id: string | null;
  product_name: string;
  doctor_id?: string | null;
  doctor_name: string;
  branch: string | null;
  quantity: number | null;
  incentive_per_unit: number | null;
  incentive_total: number | null;
  sale_date: string | null;
  month_cycle?: string | null;
  notes?: string | null;
}

interface DoctorOption {
  id: string;
  name: string;
  role?: string | null;
  branch?: string | null;
  branch_name?: string | null;
  active?: boolean | null;
}

const blankForm = {
  product_name: '',
  product_type: '',
  product_price: 0,
  incentive_type: 'fixed',
  incentive_value: 0,
  incentive_percent: 0,
  current_quantity: 0,
  sold_quantity: 0,
  target_min_percent: 0,
  doctor_id: '',
  responsible_doctor: '',
  source_file_date: new Date().toISOString().split('T')[0],
  active: true,
  effective_date: new Date().toISOString().split('T')[0],
  expiry_date: '',
  notes: '',
};

function missingColumn(message: string) {
  return (
    message.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1] || null
  );
}

function isAllBranches(branch?: string | null) {
  return !branch || branch === 'الكل' || branch.includes('ÙƒÙ„');
}

function getIncentivePerUnit(
  medicine: Pick<
    IncentiveMedicine,
    'incentive_type' | 'incentive_value' | 'incentive_percent' | 'product_price'
  >
) {
  if (medicine.incentive_type === 'percent') {
    return (Number(medicine.product_price || 0) * Number(medicine.incentive_percent || 0)) / 100;
  }
  return Number(medicine.incentive_value || 0);
}

async function saveWithMissingColumnRetry(
  table: 'incentive_medicines',
  payload: Record<string, unknown>,
  id?: string
) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const query = id
      ? supabase.from(table).update(next).eq('id', id)
      : supabase.from(table).insert(next);
    const { error } = await query;
    if (!error) return;
    const column = missingColumn(error.message);
    if (!column || !(column in next)) throw error;
    delete next[column];
    toast.warning(
      `عمود ${column} غير موجود في Supabase، تم تخطيه مؤقتًا. شغل ملف التحديث عشان يتسجل دائمًا.`
    );
  }
}

export default function IncentiveMedicines() {
  const { user, canManage } = useAuth();
  const canCreateIncentive = canManage || user?.permissions?.create_incentive_medicine === true;
  const canEditIncentive = canManage || user?.permissions?.edit_incentive_medicine === true;
  const canDeleteIncentive = canManage || user?.permissions?.delete_incentive_medicine === true;
  const [showModal, setShowModal] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<IncentiveMedicine | null>(null);

  useEscapeKey(() => setShowModal(false), showModal);
  const [form, setForm] = useState(blankForm);

  const {
    data: medicines,
    loading,
    refetch,
  } = useSupabaseQuery<IncentiveMedicine>({
    table: 'incentive_medicines',
    orderBy: { column: 'incentive_value', ascending: false },
    realtimeEnabled: true,
  });
  const { data: saleRecords, refetch: refetchSales } = useSupabaseQuery<IncentiveSaleRecord>({
    table: 'incentive_medicine_sales',
    orderBy: { column: 'sale_date', ascending: false },
    realtimeEnabled: true,
  });
  const { data: staffOptions } = useSupabaseQuery<DoctorOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: false,
  });
  const cycle = getCurrentCycle();

  const doctorOptions = useMemo(() => {
    const byId = new Map<string, DoctorOption>();
    for (const item of staffOptions || []) {
      const role = item.role || '';
      const isDoctorRole = /doctor|pharmacist|دكتور|صيدلي|صيدلاني/i.test(role);
      if (!item.id || !item.name || item.active === false || !isDoctorRole) continue;
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [staffOptions]);

  const selectedDoctor = useMemo(
    () => doctorOptions.find((doctor) => doctor.id === form.doctor_id) || null,
    [doctorOptions, form.doctor_id]
  );

  const filteredMedicines = useMemo(
    () =>
      (medicines || []).filter((medicine) =>
        canViewAllBranches(user) || canViewBranchData(user, medicine.branch)
      ),
    [medicines, user]
  );
  const scopedSaleRecords = useMemo(
    () =>
      (saleRecords || []).filter((row) =>
        canViewAllBranches(user) || canViewBranchData(user, row.branch)
      ),
    [saleRecords, user]
  );

  const stats = useMemo(() => {
    return filteredMedicines.reduce(
      (acc, medicine) => {
        const perUnit = getIncentivePerUnit(medicine);
        const available = Number(medicine.current_quantity || 0);
        const sold = movementTotalForMedicine(scopedSaleRecords, medicine.id, cycle);
        if (medicine.active) acc.potential += perUnit * available;
        acc.earned += perUnit * sold;
        acc.available += available;
        acc.active += medicine.active ? 1 : 0;
        return acc;
      },
      { potential: 0, earned: 0, available: 0, active: 0 }
    );
  }, [cycle, filteredMedicines, scopedSaleRecords]);

  const doctorTotals = useMemo(() => {
    return groupDoctorTotals(scopedSaleRecords, cycle).map((item) => {
      const money = scopedSaleRecords
        .filter((row) => row.doctor_name === item.doctor)
        .reduce((sum, row) => sum + Number(row.incentive_total || 0), 0);
      return { ...item, money };
    });
  }, [cycle, scopedSaleRecords]);

  const resetModal = () => {
    setShowModal(false);
    setEditingMedicine(null);
    setForm(blankForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!user) {
        toast.error('يجب تسجيل الدخول أولًا لتنفيذ العملية');
        return;
      }

      if (!form.doctor_id || !selectedDoctor) {
        toast.error('يجب اختيار الدكتور المسؤول عن صرف الصنف');
        return;
      }

      const currentUserProfile = getCurrentUserProfile();
      const payload = {
        product_name: form.product_name,
        product_type: form.product_type || null,
        product_price: Number(form.product_price || 0),
        incentive_type: form.incentive_type,
        incentive_value: Number(form.incentive_value || 0),
        incentive_percent: Number(form.incentive_percent || 0),
        current_quantity: Number(form.current_quantity || 0),
        sold_quantity: Number(form.sold_quantity || 0),
        target_min_percent: Number(form.target_min_percent || 0),
        target_min_quantity: Math.ceil(
          (Number(form.current_quantity || 0) * Number(form.target_min_percent || 0)) / 100
        ),
        doctor_id: selectedDoctor.id,
        responsible_doctor: selectedDoctor.name,
        source_file_date: form.source_file_date || new Date().toISOString().split('T')[0],
        active: form.active,
        effective_date: form.effective_date,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
        branch: user?.branch || 'الكل',
        created_by: currentUserProfile.id,
      };

      await saveWithMissingColumnRetry('incentive_medicines', payload, editingMedicine?.id);

      toast.success(editingMedicine ? 'تم تحديث صنف الحوافز بنجاح' : 'تم إضافة صنف الحوافز بنجاح');
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        editingMedicine ? 'تحديث صنف حوافز' : 'إضافة صنف حوافز',
        'أدوية الحوافز',
        form.product_name,
        user?.branch || ''
      );

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
        toast.error('يجب تسجيل الدخول أولًا لتنفيذ العملية');
        return;
      }

      const currentUserProfile = getCurrentUserProfile();
      const { error } = await supabase.from('incentive_medicines').delete().eq('id', id);
      if (error) throw error;

      toast.success('تم حذف الصنف بنجاح');
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        'حذف صنف حوافز',
        'أدوية الحوافز',
        name,
        user?.branch || ''
      );
      refetch();
    } catch (error) {
      toast.error(`حدث خطأ: ${(error as Error).message}`);
    }
  };

  const handleEdit = (medicine: IncentiveMedicine) => {
    setEditingMedicine(medicine);
    setForm({
      product_name: medicine.product_name,
      product_type: medicine.product_type || '',
      product_price: Number(medicine.product_price || 0),
      incentive_type: medicine.incentive_type || 'fixed',
      incentive_value: Number(medicine.incentive_value || 0),
      incentive_percent: Number(medicine.incentive_percent || 0),
      current_quantity: Number(medicine.current_quantity || 0),
      sold_quantity: Number(medicine.sold_quantity || 0),
      target_min_percent: Number(medicine.target_min_percent || 0),
      doctor_id: medicine.doctor_id || '',
      responsible_doctor: medicine.responsible_doctor || '',
      source_file_date: medicine.source_file_date || new Date().toISOString().split('T')[0],
      active: Boolean(medicine.active),
      effective_date: medicine.effective_date || new Date().toISOString().split('T')[0],
      expiry_date: medicine.expiry_date || '',
      notes: medicine.notes || '',
    });
    setShowModal(true);
  };

  const handleToggleActive = async (medicine: IncentiveMedicine) => {
    try {
      if (!user) {
        toast.error('يجب تسجيل الدخول أولًا لتنفيذ العملية');
        return;
      }

      const currentUserProfile = getCurrentUserProfile();
      const { error } = await supabase
        .from('incentive_medicines')
        .update({ active: !medicine.active })
        .eq('id', medicine.id);

      if (error) throw error;

      toast.success(medicine.active ? 'تم إيقاف الصنف' : 'تم تفعيل الصنف');
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        medicine.active ? 'إيقاف صنف حوافز' : 'تفعيل صنف حوافز',
        'أدوية الحوافز',
        medicine.product_name,
        user?.branch || ''
      );
      refetch();
    } catch (error) {
      toast.error(`حدث خطأ: ${(error as Error).message}`);
    }
  };

  const handleRecordSale = async (medicine: IncentiveMedicine) => {
    if (!user || (!medicine.doctor_id && !medicine.responsible_doctor)) {
      toast.error('يجب تحديد الدكتور المسؤول عن الصنف أولًا');
      return;
    }

    const quantityToAdd = prompt('أدخل الكمية المباعة:', '1');
    if (!quantityToAdd) return;

    const quantity = Number(quantityToAdd);
    if (isNaN(quantity) || quantity <= 0) {
      toast.error('الكمية يجب أن تكون رقمًا موجبًا');
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      const perUnit = getIncentivePerUnit(medicine);
      const totalIncentive = perUnit * quantity;
      const doctorName = medicine.responsible_doctor || 'غير محدد';

      const cycleLabel = `${getCurrentCycle().end.getFullYear()}-${String(getCurrentCycle().end.getMonth() + 1).padStart(2, '0')}`;
      const { error: saleError } = await supabase.from('incentive_medicine_sales').insert({
        medicine_id: medicine.id,
        product_name: medicine.product_name,
        doctor_id: medicine.doctor_id || null,
        doctor_name: doctorName,
        branch: medicine.branch || user?.branch || '',
        quantity,
        incentive_per_unit: perUnit,
        incentive_total: totalIncentive,
        sale_date: new Date().toISOString().slice(0, 10),
        month_cycle: cycleLabel,
        notes: `بيع صنف حوافز: ${medicine.product_name}`,
        created_by: currentUserProfile.id,
        created_by_name: currentUserProfile.name,
      });
      if (saleError) throw saleError;

      const { error: updateError } = await supabase
        .from('incentive_medicines')
        .update({
          sold_quantity: Number(medicine.sold_quantity || 0) + quantity,
        })
        .eq('id', medicine.id);

      if (updateError) throw updateError;

      // Find staff member by name to get employeeId
      const { data: staffData } = await supabase
        .from('staff')
        .select('id')
        .ilike('name', doctorName)
        .eq('branch', user?.branch || '')
        .maybeSingle();

      const employeeId = medicine.doctor_id || staffData?.id;
      if (!employeeId) {
        toast.warning(`تم تحديث الكمية المباعة، لكن لم يتم العثور على الدكتور في جدول الموظفين`);
        refetch();
        return;
      }

      // Record points for the doctor
      const pointsEarned = Math.round(totalIncentive * 10); // Convert EGP to points (1 EGP = 10 points)
      const result = await persistPointsTransaction({
        employeeId,
        employeeName: doctorName,
        branch: user?.branch || '',
        operation: 'bonus',
        rule: null,
        pointsToStore: pointsEarned,
        basePoints: pointsEarned,
        finalPoints: pointsEarned,
        userNote: `بيع ${quantity} علبة من ${medicine.product_name} (حوافز: ${formatCurrency(totalIncentive)})`,
        createdByName: currentUserProfile.name,
        createdById: currentUserProfile.id,
        createdByRole: currentUserProfile.role,
        status: 'approved',
        cycle: getCurrentCycle(),
        sourceModule: 'incentive_medicines',
        reasonLabel: `بيع صنف حوافز: ${medicine.product_name}`,
      });

      if (result.error) {
        toast.warning(`تم تحديث الكمية المباعة، لكن لم يتم تسجيل النقاط: ${result.error}`);
      } else {
        triggerCelebration(
          `تهانينا! تم تسجيل ${quantity} علبة من ${medicine.product_name} وإضافة ${pointsEarned} نقطة`
        );
      }

      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        'تسجيل بيع صنف حوافز',
        'أدوية الحوافز',
        `${quantity} × ${medicine.product_name}`,
        user?.branch || ''
      );

      const afterSold = movementTotalForMedicine(saleRecords, medicine.id, cycle) + quantity;
      const target = {
        id: medicine.id,
        name: medicine.product_name,
        totalQuantity: Number(medicine.current_quantity || 0),
        targetMinPercent: medicine.target_min_percent,
      };
      if (targetAchieved(target, afterSold)) {
        triggerCelebration(`ممتاز! ${medicine.product_name} حقق التارجت المطلوب`);
      }
      refetch();
      refetchSales();
    } catch (error) {
      toast.error(`حدث خطأ: ${(error as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-green-500/15 flex items-center justify-center text-green-400">
            <TrendingUp size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">أدوية اللستة</h2>
            <p className="text-slate-400 text-sm mt-1">
              أصناف اللستة مع متابعة الكمية المباعة والحافز المحقق لكل دكتور
            </p>
          </div>
        </div>
        {canCreateIncentive && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> إضافة صنف
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-green-400">
              <DollarSign size={20} />
            </div>
            <div>
              <div className="text-slate-400 text-xs">حوافز محتملة</div>
              <div className="text-white font-bold text-lg num">
                {formatCurrency(stats.potential)}
              </div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center text-teal-400">
              <TrendingUp size={20} />
            </div>
            <div>
              <div className="text-slate-400 text-xs">حوافز محققة</div>
              <div className="text-white font-bold text-lg num">{formatCurrency(stats.earned)}</div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-400">
              <Package size={20} />
            </div>
            <div>
              <div className="text-slate-400 text-xs">إجمالي الكمية</div>
              <div className="text-white font-bold text-lg num">{stats.available}</div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400">
              <Package size={20} />
            </div>
            <div>
              <div className="text-slate-400 text-xs">أصناف نشطة</div>
              <div className="text-white font-bold text-lg num">{stats.active}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-4 text-sm text-slate-300">
        <div className="flex items-start gap-3">
          <TrendingUp className="text-green-400 flex-shrink-0 mt-0.5" size={18} />
          <div>
            <div className="font-semibold text-green-200 mb-1">معلومات الحوافز</div>
            <p>
              يمكن تسجيل الحافز كقيمة ثابتة بالجنيه لكل علبة أو كنسبة من سعر الصنف. سجل الدكتور
              والكمية المباعة عشان يظهر الحافز المحقق بوضوح.
            </p>
          </div>
        </div>
      </div>

      <div className="stat-card">
        <div className="section-title text-sm mb-3">تقرير حوافز الدكاترة - {cycle.shortLabel}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {doctorTotals.length ? (
            doctorTotals.map((item) => (
              <div key={item.doctor} className="bg-white/5 rounded-xl p-3">
                <div className="text-white font-bold text-sm">{item.doctor}</div>
                <div className="text-slate-400 text-xs mt-1">{item.count} سجل بيع</div>
                <div className="text-teal-300 font-bold num mt-2">{item.quantity} علبة</div>
                <div className="text-green-300 font-bold num mt-1">
                  {formatCurrency(item.money)}
                </div>
              </div>
            ))
          ) : (
            <div className="text-slate-400 text-sm">لا توجد مبيعات حوافز في الدورة الحالية.</div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="stat-card text-center py-10 text-slate-400">جاري التحميل...</div>
      ) : filteredMedicines.length === 0 ? (
        <div className="stat-card text-center py-10 text-slate-400">لا توجد أدوية حوافز حاليًا</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredMedicines.map((medicine, index) => {
            const perUnit = getIncentivePerUnit(medicine);
            const soldInCycle = movementTotalForMedicine(scopedSaleRecords, medicine.id, cycle);
            const earned = perUnit * soldInCycle;
            const target = {
              id: medicine.id,
              name: medicine.product_name,
              totalQuantity: Number(medicine.current_quantity || 0),
              targetMinPercent: medicine.target_min_percent,
            };
            const required = medicine.target_min_quantity || requiredQuantity(target);
            const achieved = targetAchieved(target, soldInCycle);
            const progress = required
              ? Math.min(100, Math.round((soldInCycle / required) * 100))
              : 0;
            const accents = [
              'from-teal-500/18 to-cyan-500/8 border-teal-400/25',
              'from-purple-500/18 to-indigo-500/8 border-purple-400/25',
              'from-amber-500/16 to-orange-500/8 border-amber-400/25',
              'from-emerald-500/16 to-green-500/8 border-emerald-400/25',
              'from-blue-500/16 to-sky-500/8 border-blue-400/25',
            ];
            return (
              <div
                key={medicine.id}
                className={`rounded-3xl border bg-gradient-to-br ${accents[index % accents.length]} p-5 card-glow ${!medicine.active ? 'opacity-55' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-teal-300 shrink-0">
                      <Package size={23} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-white font-black text-lg truncate">
                        {medicine.product_name}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="badge-info">{medicine.product_type || 'بدون تصنيف'}</span>
                        <span className={achieved ? 'badge-success' : 'badge-warning'}>
                          {achieved ? 'حقق التارجت' : 'جاري التنفيذ'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleActive(medicine)}
                    className={`flex items-center gap-1 text-xs ${medicine.active ? 'text-green-300' : 'text-slate-400'}`}
                  >
                    {medicine.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}{' '}
                    {medicine.active ? 'نشط' : 'موقوف'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <Mini label="السعر" value={formatCurrency(Number(medicine.product_price || 0))} />
                  <Mini
                    label="حافز العلبة"
                    value={
                      medicine.incentive_type === 'percent'
                        ? `${medicine.incentive_percent || 0}%`
                        : formatCurrency(Number(medicine.incentive_value || 0))
                    }
                  />
                  <Mini
                    label="المباع / الهدف"
                    value={required ? `${soldInCycle}/${required}` : `${soldInCycle}`}
                  />
                  <Mini label="الحافز المحقق" value={formatCurrency(earned)} tone="text-teal-300" />
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-400">نسبة الإنجاز</span>
                    <span
                      className={achieved ? 'text-teal-300 font-bold' : 'text-amber-300 font-bold'}
                    >
                      {progress}%
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-400">الدكتور المسؤول</div>
                    {medicine.doctor_id ? (
                      <Link
                        to={staffProfilePath({
                          staff_id: medicine.doctor_id,
                          name: medicine.responsible_doctor,
                        })}
                        className="text-teal-300 hover:text-teal-200 font-bold inline-flex items-center gap-1 mt-1"
                      >
                        <UserRound size={14} /> {medicine.responsible_doctor || 'غير محدد'}
                      </Link>
                    ) : (
                      <div className="text-white font-bold mt-1">
                        {medicine.responsible_doctor || 'غير محدد'}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {canEditIncentive && (
                      <button
                        onClick={() => handleRecordSale(medicine)}
                        className="btn-primary px-3 py-2"
                        title="تسجيل بيع"
                      >
                        <Award size={16} />
                      </button>
                    )}
                    {canEditIncentive && (
                      <button
                        onClick={() => handleEdit(medicine)}
                        className="btn-secondary px-3 py-2"
                        title="تعديل"
                      >
                        <Edit size={16} />
                      </button>
                    )}
                    {canDeleteIncentive && (
                      <button
                        onClick={() => handleDelete(medicine.id, medicine.product_name)}
                        className="btn-danger px-3 py-2"
                        title="حذف"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  تاريخ الانتهاء: {medicine.expiry_date || 'غير محدد'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4">
              {editingMedicine ? 'تعديل صنف حوافز' : 'إضافة صنف حوافز'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-300 text-sm block mb-1">اسم الصنف *</label>
                  <input
                    className="input-dark"
                    value={form.product_name}
                    onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">نوع الصنف</label>
                  <input
                    className="input-dark"
                    placeholder="تخسيس، معدة، مضاد حيوي..."
                    value={form.product_type}
                    onChange={(e) => setForm({ ...form, product_type: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">سعر الصنف</label>
                  <input
                    className="input-dark"
                    type="number"
                    step="0.01"
                    min={0}
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
                  <label className="text-slate-300 text-sm block mb-1">نوع الحافز</label>
                  <select
                    className="input-dark"
                    value={form.incentive_type}
                    onChange={(e) => setForm({ ...form, incentive_type: e.target.value })}
                  >
                    <option value="fixed">قيمة ثابتة بالجنيه</option>
                    <option value="percent">نسبة من سعر الصنف</option>
                  </select>
                </div>
                {form.incentive_type === 'fixed' ? (
                  <div>
                    <label className="text-slate-300 text-sm block mb-1">قيمة الحافز للعلبة</label>
                    <input
                      className="input-dark"
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.incentive_value}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          incentive_value: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-slate-300 text-sm block mb-1">نسبة الحافز %</label>
                    <input
                      className="input-dark"
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.incentive_percent}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          incentive_percent: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                )}
                <div>
                  <label className="text-slate-300 text-sm block mb-1">الكمية المتاحة *</label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    value={form.current_quantity}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        current_quantity: Number(e.target.value),
                      })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">الكمية المباعة</label>
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    value={form.sold_quantity}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sold_quantity: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">
                    نسبة الحد الأدنى لكل صنف %
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
                    الدكتور الذي صرف الصنف
                  </label>
                  <select
                    className="input-dark"
                    value={form.doctor_id}
                    onChange={(e) => {
                      const doctor = doctorOptions.find((item) => item.id === e.target.value);
                      setForm({
                        ...form,
                        doctor_id: e.target.value,
                        responsible_doctor: doctor?.name || '',
                      });
                    }}
                    required
                  >
                    <option value="">اختر الدكتور أو الصيدلي</option>
                    {doctorOptions.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name} - {doctor.branch_name || doctor.branch || 'كل الفروع'} -{' '}
                        {doctor.role || 'دكتور'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">تاريخ ملف الحوافز</label>
                  <input
                    className="input-dark"
                    type="date"
                    value={form.source_file_date}
                    onChange={(e) => setForm({ ...form, source_file_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">تاريخ الفعالية</label>
                  <input
                    className="input-dark"
                    type="date"
                    value={form.effective_date}
                    onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-slate-300 text-sm block mb-1">تاريخ انتهاء الصنف</label>
                  <input
                    className="input-dark"
                    type="date"
                    value={form.expiry_date}
                    onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-3 text-sm text-slate-300">
                الحافز للعلبة:{' '}
                <span className="text-teal-300 font-bold num">
                  {formatCurrency(getIncentivePerUnit(form))}
                </span>
                <span className="mx-2 text-slate-500">|</span>
                الحافز المحقق:{' '}
                <span className="text-green-300 font-bold num">
                  {formatCurrency(getIncentivePerUnit(form) * Number(form.sold_quantity || 0))}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="active" className="text-slate-300 text-sm">
                  نشط
                </label>
              </div>

              <div>
                <label className="text-slate-300 text-sm block mb-1">ملاحظات</label>
                <textarea
                  className="input-dark resize-none"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={resetModal} className="flex-1 btn-secondary">
                  إلغاء
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  {editingMedicine ? 'تحديث' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  tone = 'text-white',
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-1 font-extrabold num ${tone}`}>{value}</div>
    </div>
  );
}
