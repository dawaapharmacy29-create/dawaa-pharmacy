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
import { canViewAllBranches, canViewBranchData } from '@/lib/security/userDataScope';
import { exportMedicineExpiryToExcel } from '@/lib/exportExcel';
import { Skeleton } from '@/components/ui/skeleton';
import { createNotification } from '@/lib/notificationService';

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
    color: 'dawaa-badge--danger',
    badge: 'dawaa-badge dawaa-badge--danger',
    icon: XCircle,
    iconColor: 'text-[var(--dawaa-status-danger-text)]',
  },
  urgent: {
    label: 'أقل من 30 يوم',
    color: 'dawaa-badge--warning',
    badge: 'dawaa-badge dawaa-badge--warning',
    icon: AlertTriangle,
    iconColor: 'text-[var(--dawaa-status-warning-text)]',
  },
  soon: {
    label: '30 - 60 يوم',
    color: 'dawaa-badge--warning',
    badge: 'dawaa-badge dawaa-badge--warning',
    icon: Clock,
    iconColor: 'text-[var(--dawaa-status-warning-text)]',
  },
  moderate: {
    label: '60 - 90 يوم',
    color: 'dawaa-badge--warning',
    badge: 'dawaa-badge dawaa-badge--warning',
    icon: Package,
    iconColor: 'text-[var(--dawaa-status-warning-text)]',
  },
  safe: {
    label: 'أكثر من 90 يوم',
    color: 'dawaa-badge--success',
    badge: 'dawaa-badge dawaa-badge--success',
    icon: CheckCircle2,
    iconColor: 'text-[var(--dawaa-status-success-text)]',
  },
};

function TableSkeleton() {
  return (
    <div className="rounded-2xl border dawaa-surface shadow-sm overflow-hidden">
      <div className="border-b border-[var(--dawaa-theme-divider)] px-5 py-3">
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
    await createNotification({
      title: `⚠️ ${urgentMedicines.length} دواء قرب انتهاء صلاحيته`,
      message: names + (urgentMedicines.length > 3 ? ` وآخرون...` : ''),
      type: 'expiry_alert',
      priority: 'high',
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
    medicines.filter((m) => canViewAllBranches(user) || canViewBranchData(user, m.branch_name || m.branch)).forEach((m) => {
      if (m.branch || m.branch_name) set.add(m.branch_name || m.branch || '');
    });
    return ['الكل', ...Array.from(set).filter(Boolean).sort()];
  }, [medicines, user]);

  const enriched = useMemo(() => {
    return medicines.filter((m) => canViewAllBranches(user) || canViewBranchData(user, m.branch_name || m.branch)).map((m) => ({
      ...m,
      days: daysUntilExpiry(m),
      bucket: getBucket(daysUntilExpiry(m)),
    }));
  }, [medicines, user]);

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
    <div className="dawaa-text space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 rounded-2xl border dawaa-surface p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">متابعة صلاحية الأدوية</h1>
          <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">
            عرض الأدوية مرتبة حسب تاريخ الانتهاء مع تنبيهات للفئات الحرجة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2 text-xs font-bold text-[var(--dawaa-theme-muted)] sm:inline">
            تحديث تلقائي: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
          </span>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="dawaa-focus-ring inline-flex items-center gap-2 rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-4 py-2 text-sm font-black text-[var(--dawaa-status-success-text)] hover:bg-[var(--dawaa-theme-surface-2)] disabled:opacity-40"
          >
            <Download size={16} /> تصدير Excel
          </button>
          <button
            onClick={handleRefresh}
            className="dawaa-focus-ring inline-flex items-center gap-2 rounded-xl bg-[var(--dawaa-theme-primary)] px-4 py-2 text-sm font-black text-[var(--dawaa-theme-primary-text)] hover:bg-[var(--dawaa-theme-primary-strong)]"
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
              aria-pressed={isActive}
              onClick={() => setActiveBucket(isActive ? 'all' : key)}
              className={cn(
                'dawaa-surface-interactive dawaa-focus-ring flex items-center gap-3 rounded-2xl border p-4 text-right transition',
                isActive && 'outline outline-2 outline-offset-2 outline-[var(--dawaa-theme-primary)]'
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

      <div className="flex flex-col gap-3 rounded-2xl border dawaa-surface p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2 flex-1 bg-[var(--dawaa-theme-input)] focus-within:ring-2 focus-within:ring-[var(--dawaa-theme-focus)]">
          <Filter size={16} className="text-[var(--dawaa-theme-muted)]" />
          <input
            type="text"
            placeholder="بحث باسم الدواء أو الدكتور..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--dawaa-theme-heading)] placeholder:text-[var(--dawaa-theme-muted)] outline-none"
            aria-label="بحث باسم الدواء أو الدكتور"
          />
        </div>
        <select
          aria-label="الفرع"
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="dawaa-focus-ring bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-heading)] rounded-xl px-3 py-2 text-sm font-bold"
        >
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select
          aria-label="فئة الصلاحية"
          value={activeBucket}
          onChange={(e) => setActiveBucket(e.target.value)}
          className="dawaa-focus-ring bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-heading)] rounded-xl px-3 py-2 text-sm font-bold"
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
        <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 text-sm font-bold text-[var(--dawaa-status-danger-text)]">
          ⚠️ {error}
        </div>
      )}

      {loading && <TableSkeleton />}

      {!loading && medicines.length === 0 && (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-8 text-center">
          <Package size={40} className="mx-auto mb-3 text-[var(--dawaa-theme-muted)]" />
          <div className="text-sm font-bold text-[var(--dawaa-theme-muted)]">
            لا توجد أدوية في جدول stagnant_medicines بعد. أضف بيانات الرواكد أولاً.
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-2xl border dawaa-surface shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--dawaa-theme-divider)] px-5 py-3">
            <h2 className="text-base font-black text-[var(--dawaa-theme-heading)]">
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
            <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
              {counts.expired + counts.urgent > 0 && (
                <span className="text-[var(--dawaa-status-danger-text)]">
                  ⚠️ {counts.expired + counts.urgent} يحتاج إجراء عاجل
                </span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="dawaa-table-semantic min-w-full text-sm">
              <thead>
                <tr className="bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-text)] text-right">
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
                    <tr key={m.id} className="border-t border-[var(--dawaa-theme-divider)] transition">
                      <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">
                        {m.medicine_name || m.product_name || '-'}
                      </td>
                      <td className="p-3 text-[var(--dawaa-theme-text)]">{formatDate(expiryD)}</td>
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
                      <td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">
                        {getQty(m).toLocaleString('ar-EG')}
                      </td>
                      <td className="p-3 text-[var(--dawaa-theme-text)]">{m.branch_name || m.branch || '-'}</td>
                      <td className="p-3 text-[var(--dawaa-theme-text)]">
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
