import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Filter,
  Download,
} from 'lucide-react';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { exportMedicineExpiryToExcel } from '@/lib/exportExcel';
import { Skeleton } from '@/components/ui/skeleton';

const AUTO_REFRESH_SEC = 300;

interface Medicine {
  id: string;
  medicine_name?: string | null;
  product_name?: string | null;
  expiry_date?: string | null;
  nearest_expiry_date?: string | null;
  quantity_available?: number | null;
  remaining_quantity?: number | null;
  total_quantity?: number | null;
  dispensed_quantity?: number | null;
  branch?: string | null;
  branch_name?: string | null;
  responsible_doctor?: string | null;
  responsible_doctor_name?: string | null;
  status?: string | null;
  priority?: string | null;
  upload_date?: string | null;
}

function getExpiryDate(m: Medicine): Date | null {
  const raw = m.nearest_expiry_date || m.expiry_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function daysUntilExpiry(m: Medicine): number | null {
  const d = getExpiryDate(m);
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getBucket(days: number | null): 'expired' | 'urgent' | 'soon' | 'moderate' | 'safe' {
  if (days === null) return 'safe';
  if (days <= 0) return 'expired';
  if (days <= 30) return 'urgent';
  if (days <= 60) return 'soon';
  if (days <= 90) return 'moderate';
  return 'safe';
}

const BUCKET_CONFIG = {
  expired: {
    label: 'منتهي الصلاحية',
    color: 'bg-red-100 border-red-300 text-red-800',
    badge: 'bg-red-600 text-white',
    icon: XCircle,
    iconColor: 'text-red-600',
  },
  urgent: {
    label: 'أقل من 30 يوم',
    color: 'bg-orange-100 border-orange-300 text-orange-800',
    badge: 'bg-orange-500 text-white',
    icon: AlertTriangle,
    iconColor: 'text-orange-500',
  },
  soon: {
    label: '30 - 60 يوم',
    color: 'bg-amber-100 border-amber-300 text-amber-800',
    badge: 'bg-amber-500 text-white',
    icon: Clock,
    iconColor: 'text-amber-500',
  },
  moderate: {
    label: '60 - 90 يوم',
    color: 'bg-yellow-100 border-yellow-300 text-yellow-800',
    badge: 'bg-yellow-500 text-white',
    icon: Package,
    iconColor: 'text-yellow-600',
  },
  safe: {
    label: 'أكثر من 90 يوم',
    color: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    badge: 'bg-emerald-600 text-white',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600',
  },
};

function TableSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-3">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/8" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function createUrgentNotification(urgentMedicines: (Medicine & { days: number | null })[]) {
  if (!isSupabaseConfigured || urgentMedicines.length === 0) return;
  try {
    const names = urgentMedicines
      .slice(0, 3)
      .map((m) => m.medicine_name || m.product_name || 'دواء')
      .join('، ');
    await supabase.from('notifications').insert({
      title: `⚠️ ${urgentMedicines.length} دواء قرب انتهاء صلاحيته`,
      message: names + (urgentMedicines.length > 3 ? ` وآخرون...` : ''),
      type: 'expiry_alert',
      priority: 'high',
      status: 'new',
      target_route: '/medicine-expiry',
    });
  } catch {
    // silent — notifications are non-critical
  }
}

export default function MedicineExpiryTracker() {
  const { user } = useAuth();
  const [activeBucket, setActiveBucket] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState('الكل');
  const [search, setSearch] = useState('');
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC);
  const notifiedRef = useRef(false);

  const {
    data: medicines,
    loading,
    error,
    refetch,
  } = useSupabaseQuery<Medicine>({
    table: 'stagnant_medicines',
    select:
      'id,medicine_name,product_name,expiry_date,nearest_expiry_date,quantity_available,remaining_quantity,total_quantity,dispensed_quantity,branch,branch_name,responsible_doctor,responsible_doctor_name,status,priority,upload_date',
    orderBy: { column: 'expiry_date', ascending: true },
    limit: 500,
    realtimeEnabled: true,
  });

  // Auto-refresh countdown
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          void refetch();
          return AUTO_REFRESH_SEC;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [refetch]);

  const handleRefresh = useCallback(() => {
    void refetch();
    setCountdown(AUTO_REFRESH_SEC);
  }, [refetch]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    medicines.forEach((m) => {
      if (m.branch || m.branch_name) set.add(m.branch_name || m.branch || '');
    });
    return ['الكل', ...Array.from(set).filter(Boolean).sort()];
  }, [medicines]);

  const enriched = useMemo(() => {
    return medicines.map((m) => ({
      ...m,
      days: daysUntilExpiry(m),
      bucket: getBucket(daysUntilExpiry(m)),
    }));
  }, [medicines]);

  // Auto-create notification for urgent medicines (once per session)
  useEffect(() => {
    if (!notifiedRef.current && enriched.length > 0 && user) {
      const urgent = enriched.filter((m) => m.bucket === 'urgent' || m.bucket === 'expired');
      if (urgent.length > 0) {
        notifiedRef.current = true;
        void createUrgentNotification(urgent);
      }
    }
  }, [enriched, user]);

  const filtered = useMemo(() => {
    return enriched.filter((m) => {
      if (activeBucket !== 'all' && m.bucket !== activeBucket) return false;
      if (branchFilter !== 'الكل' && (m.branch_name || m.branch) !== branchFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const name = (m.medicine_name || m.product_name || '').toLowerCase();
        const doctor = (m.responsible_doctor_name || m.responsible_doctor || '').toLowerCase();
        if (!name.includes(q) && !doctor.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, activeBucket, branchFilter, search]);

  const counts = useMemo(() => {
    const c = { expired: 0, urgent: 0, soon: 0, moderate: 0, safe: 0, total: enriched.length };
    enriched.forEach((m) => {
      c[m.bucket]++;
    });
    return c;
  }, [enriched]);

  const summaryCards = [
    { key: 'expired', count: counts.expired },
    { key: 'urgent', count: counts.urgent },
    { key: 'soon', count: counts.soon },
    { key: 'moderate', count: counts.moderate },
  ] as const;

  function formatDate(date: Date | null) {
    if (!date) return '-';
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function getQty(m: Medicine) {
    return m.remaining_quantity ?? m.quantity_available ?? m.total_quantity ?? 0;
  }

  function handleExport() {
    void exportMedicineExpiryToExcel(filtered);
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">متابعة صلاحية الأدوية</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            عرض الأدوية مرتبة حسب تاريخ الانتهاء مع تنبيهات للفئات الحرجة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 sm:inline">
            تحديث تلقائي: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
          </span>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
          >
            <Download size={16} /> تصدير Excel
          </button>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {summaryCards.map(({ key, count }) => {
          const cfg = BUCKET_CONFIG[key];
          const Icon = cfg.icon;
          const isActive = activeBucket === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveBucket(isActive ? 'all' : key)}
              className={cn(
                'flex items-center gap-3 rounded-2xl border p-4 shadow-sm text-right transition hover:shadow-md',
                cfg.color,
                isActive && 'ring-2 ring-offset-1 ring-teal-400'
              )}
            >
              <Icon size={28} className={cfg.iconColor} />
              <div>
                <div className="text-xs font-bold">{cfg.label}</div>
                <div className="text-3xl font-black">
                  {loading ? <Skeleton className="h-8 w-12 mt-1" /> : count}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 flex-1">
          <Filter size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم الدواء أو الدكتور..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
        >
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select
          value={activeBucket}
          onChange={(e) => setActiveBucket(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
        >
          <option value="all">كل الفئات</option>
          {Object.entries(BUCKET_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          ⚠️ {error}
        </div>
      )}

      {loading && <TableSkeleton />}

      {!loading && medicines.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
          <Package size={40} className="mx-auto mb-3 text-slate-300" />
          <div className="text-sm font-bold text-slate-500">
            لا توجد أدوية في جدول stagnant_medicines بعد. أضف بيانات الرواكد أولاً.
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-black text-slate-900">
              {filtered.length} دواء
              {activeBucket !== 'all' && (
                <span
                  className={cn(
                    'mr-2 rounded-full px-2 py-0.5 text-xs font-black',
                    BUCKET_CONFIG[activeBucket as keyof typeof BUCKET_CONFIG]?.badge
                  )}
                >
                  {BUCKET_CONFIG[activeBucket as keyof typeof BUCKET_CONFIG]?.label}
                </span>
              )}
            </h2>
            <span className="text-xs font-bold text-slate-400">
              {counts.expired + counts.urgent > 0 && (
                <span className="text-red-600">
                  ⚠️ {counts.expired + counts.urgent} يحتاج إجراء عاجل
                </span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-right">
                  <th className="p-3 font-bold">الدواء</th>
                  <th className="p-3 font-bold">تاريخ الانتهاء</th>
                  <th className="p-3 font-bold">الأيام المتبقية</th>
                  <th className="p-3 font-bold">الكمية</th>
                  <th className="p-3 font-bold">الفرع</th>
                  <th className="p-3 font-bold">الدكتور</th>
                  <th className="p-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const cfg = BUCKET_CONFIG[m.bucket];
                  const expiryD = getExpiryDate(m);
                  return (
                    <tr key={m.id} className="border-t hover:bg-slate-50 transition">
                      <td className="p-3 font-black text-slate-900">
                        {m.medicine_name || m.product_name || '-'}
                      </td>
                      <td className="p-3 text-slate-700">{formatDate(expiryD)}</td>
                      <td className="p-3">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-black border',
                            cfg.color
                          )}
                        >
                          {m.days === null ? '-' : m.days <= 0 ? 'منتهي' : `${m.days} يوم`}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-800">
                        {getQty(m).toLocaleString('ar-EG')}
                      </td>
                      <td className="p-3 text-slate-700">{m.branch_name || m.branch || '-'}</td>
                      <td className="p-3 text-slate-700">
                        {m.responsible_doctor_name || m.responsible_doctor || '-'}
                      </td>
                      <td className="p-3">
                        <span
                          className={cn('rounded-full px-2 py-0.5 text-xs font-black', cfg.badge)}
                        >
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
