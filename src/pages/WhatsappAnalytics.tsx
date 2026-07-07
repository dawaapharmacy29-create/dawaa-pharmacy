import { useEffect, useMemo, useState } from 'react';
import { BarChart3, MessageCircle, Star, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { normalizeBranchName } from '@/lib/branch';
import { formatCycleDate, getCurrentCycle } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { getInvoiceKey } from '@/lib/dawaa2027';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import {
  buildStaffIdentityMap,
  resolvePrimaryStaffForDoctor,
  type StaffDirectoryRow,
} from '@/lib/staff/staffIdentityResolver';
import {
  canViewAllBranchesForServiceAnalytics,
  canViewBranchData,
  getReviewAllowedBranches,
  isDoctorRole,
  rowMatchesCurrentDoctor,
} from '@/lib/security/userDataScope';

type Row = Record<string, unknown>;

const WAREHOUSE_BRANCH = 'المخزن';
const ALL_BRANCHES = 'كل الفروع';

function text(row: Row, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function num(row: Row, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function day(row: Row) {
  return text(row, ['review_date', 'conversation_date', 'created_at', 'date']).slice(0, 10);
}

function rowBranch(row: Row) {
  return normalizeBranchName(text(row, ['branch', 'branch_name']));
}

type DoctorAggregate = {
  staffId: string;
  name: string;
  branch: string;
  count: number;
  score: number;
  weak: number;
  excellent: number;
  sales: number;
  points: number;
};

export default function WhatsappAnalytics() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const [startDate, setStartDate] = useState(formatCycleDate(cycle.start));
  const [endDate, setEndDate] = useState(formatCycleDate(cycle.end));
  const canAllBranches = canViewAllBranchesForServiceAnalytics(user);
  const allowedBranches = useMemo(() => getReviewAllowedBranches(user), [user]);
  const defaultBranch = canAllBranches
    ? ALL_BRANCHES
    : allowedBranches[0] || normalizeBranchName(user?.branch || '') || ALL_BRANCHES;
  const [branch, setBranch] = useState(defaultBranch);
  const [doctor, setDoctor] = useState('الكل');

  useEffect(() => {
    if (!canAllBranches) {
      setBranch(defaultBranch);
    }
  }, [canAllBranches, defaultBranch]);

  const {
    data: reviews,
    loading,
    error,
  } = useSupabaseQuery<Row>({
    table: 'conversation_sales_reviews',
    limit: 3000,
    realtimeEnabled: true,
  });
  const { data: invoices, loading: invoicesLoading, error: invoicesError } = useSupabaseQuery<Row>({
    table: 'sales_invoices',
    limit: 5000,
    realtimeEnabled: false,
  });
  const { data: transactions, loading: txLoading, error: txError } = useSupabaseQuery<Row>({
    table: 'employee_transactions',
    limit: 2000,
    realtimeEnabled: true,
  });
  const { data: staffRows } = useSupabaseQuery<StaffDirectoryRow>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    limit: 800,
    realtimeEnabled: false,
  });

  const identityMap = useMemo(() => buildStaffIdentityMap(staffRows || []), [staffRows]);

  const scopeFilteredReviews = useMemo(() => {
    return (reviews || []).filter((row) => {
      const rowBr = rowBranch(row);
      if (!rowBr || rowBr === WAREHOUSE_BRANCH) return false;
      if (canAllBranches) return true;
      if (allowedBranches.length > 1) {
        return allowedBranches.some((item) => normalizeBranchName(item) === rowBr);
      }
      if (!canViewBranchData(user, rowBr)) return false;
      if (isDoctorRole(user)) {
        const resolved = resolvePrimaryStaffForDoctor(row, staffRows || [], identityMap);
        if (resolved?.staffId && user?.staffId && resolved.staffId === user.staffId) return true;
        return rowMatchesCurrentDoctor(user, row);
      }
      return true;
    });
  }, [allowedBranches, canAllBranches, identityMap, reviews, staffRows, user]);

  const branches = useMemo(() => {
    const values = new Set<string>();
    for (const row of scopeFilteredReviews) {
      const rowBr = rowBranch(row);
      if (rowBr && rowBr !== WAREHOUSE_BRANCH) values.add(rowBr);
    }
    if (!canAllBranches) {
      return allowedBranches
        .map((item) => normalizeBranchName(item))
        .filter((item) => item && item !== WAREHOUSE_BRANCH && values.has(item));
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [allowedBranches, canAllBranches, scopeFilteredReviews]);

  const filtered = useMemo(() => {
    return scopeFilteredReviews.filter((row) => {
      const date = day(row);
      if (date && (date < startDate || date > endDate)) return false;
      if (branch !== ALL_BRANCHES && rowBranch(row) !== normalizeBranchName(branch)) return false;
      if (doctor !== 'الكل') {
        const resolved = resolvePrimaryStaffForDoctor(row, staffRows || [], identityMap);
        if (resolved?.staffId !== doctor) return false;
      }
      return true;
    });
  }, [branch, doctor, endDate, identityMap, scopeFilteredReviews, staffRows, startDate]);

  const perDoctor = useMemo(() => {
    const map = new Map<string, DoctorAggregate>();
    for (const row of filtered) {
      const resolved = resolvePrimaryStaffForDoctor(row, staffRows || [], identityMap);
      const staffId = resolved?.staffId || `unresolved:${text(row, ['doctor_name', 'staff_name', 'employee_name'])}`;
      const name = resolved?.displayName || text(row, ['doctor_name', 'staff_name', 'employee_name'], 'غير محدد');
      const branchName = resolved?.branch || rowBranch(row) || 'غير محدد';
      const score = num(row, ['score', 'total_score', 'final_score', 'rating'], 0);
      const current = map.get(staffId) || {
        staffId,
        name,
        branch: branchName,
        count: 0,
        score: 0,
        weak: 0,
        excellent: 0,
        sales: 0,
        points: 0,
      };
      current.count += 1;
      current.score += score;
      if (score >= 85) current.excellent += 1;
      if (score > 0 && score < 60) current.weak += 1;
      current.sales += num(row, ['generated_sales', 'sales_value', 'invoice_amount'], 0);
      current.points += num(row, ['points_delta', 'points'], 0);
      map.set(staffId, current);
    }
    return Array.from(map.values())
      .map((item) => ({ ...item, avg: item.count ? Math.round(item.score / item.count) : 0 }))
      .sort((a, b) => b.avg - a.avg);
  }, [filtered, identityMap, staffRows]);

  const doctorOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of perDoctor) {
      if (row.staffId.startsWith('unresolved:')) continue;
      options.set(row.staffId, row.name);
    }
    return [...options.entries()].map(([id, name]) => ({ id, name }));
  }, [perDoctor]);

  const linkedInvoiceSales = useMemo(() => {
    if (invoicesError || invoicesLoading) return null;
    const invoiceNumbers = new Set(
      filtered.map((row) => text(row, ['invoice_number', 'linked_invoice_number'])).filter(Boolean)
    );
    return (invoices || [])
      .filter((invoice) => invoiceNumbers.has(getInvoiceKey(invoice)))
      .reduce((sum, invoice) => sum + num(invoice, ['net_amount', 'amount', 'total'], 0), 0);
  }, [filtered, invoices, invoicesError, invoicesLoading]);

  const relatedPoints = useMemo(() => {
    if (txError || txLoading) return null;
    return (transactions || [])
      .filter((row) =>
        String(text(row, ['source', 'source_module', 'reason', 'description'])).includes('conversation')
      )
      .reduce((sum, row) => sum + num(row, ['points_delta', 'points'], 0), 0);
  }, [transactions, txError, txLoading]);

  const loadFailed = Boolean(error || invoicesError || txError);
  const stillLoading = loading || invoicesLoading || txLoading;
  const hasData = filtered.length > 0;

  const avgScore = hasData
    ? Math.round(
        filtered.reduce(
          (sum, row) => sum + num(row, ['score', 'total_score', 'final_score', 'rating'], 0),
          0
        ) / filtered.length
      )
    : null;
  const topDoctor = perDoctor[0]?.name || null;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <h1 className="text-2xl font-black text-white">تحليل أداء الواتساب</h1>
        <p className="mt-1 text-sm text-slate-400">
          تقرير دوري لجودة المحادثات، الترشيحات، الإغلاق، وربط النتائج بالمبيعات والنقاط.
        </p>
      </div>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-300 space-y-1">
            <span>من</span>
            <input
              className="input-dark"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>إلى</span>
            <input
              className="input-dark"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>الفرع</span>
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              {canAllBranches && <option value={ALL_BRANCHES}>{ALL_BRANCHES}</option>}
              {branches.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>الدكتور/الموظف</span>
            <select className="input-dark" value={doctor} onChange={(event) => setDoctor(event.target.value)}>
              <option value="الكل">الكل</option>
              {doctorOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loadFailed && (
        <div className="stat-card text-red-200">تعذر تحميل البيانات</div>
      )}

      {!loadFailed && !stillLoading && !hasData && (
        <div className="stat-card text-slate-300">لا توجد بيانات للفترة</div>
      )}

      {!loadFailed && hasData && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric icon={MessageCircle} label="محادثات مراجعة" value={filtered.length} />
            <Metric icon={Star} label="متوسط الجودة" value={avgScore != null ? `${avgScore}%` : '—'} />
            <Metric icon={Users} label="أفضل أداء" value={topDoctor || '—'} />
            <Metric
              icon={TrendingUp}
              label="مبيعات مرتبطة"
              value={linkedInvoiceSales != null ? formatCurrency(linkedInvoiceSales) : '—'}
            />
            <Metric
              icon={BarChart3}
              label="أثر النقاط"
              value={relatedPoints != null ? relatedPoints.toLocaleString('ar-EG') : '—'}
            />
          </div>

          <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] overflow-hidden">
            {stillLoading ? (
              <div className="p-10 text-center text-slate-300">جاري تحميل تحليل الواتساب...</div>
            ) : perDoctor.length === 0 ? (
              <div className="p-10 text-center text-slate-400">لا توجد بيانات للفترة</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الدكتور/الموظف</th>
                      <th>الفرع</th>
                      <th>عدد المراجعات</th>
                      <th>متوسط الدرجة</th>
                      <th>ممتازة</th>
                      <th>ضعيفة</th>
                      <th>مبيعات مولدة</th>
                      <th>نقاط</th>
                      <th>توصية تدريب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perDoctor.map((row) => (
                      <tr key={row.staffId}>
                        <td className="font-bold text-white">{row.name}</td>
                        <td>{row.branch}</td>
                        <td>{row.count}</td>
                        <td className="text-teal-300 font-bold">{row.avg}%</td>
                        <td>{row.excellent}</td>
                        <td className={row.weak ? 'text-red-300 font-bold' : ''}>{row.weak}</td>
                        <td>{formatCurrency(row.sales)}</td>
                        <td>{row.points}</td>
                        <td>
                          {row.weak > 0 || row.avg < 70
                            ? 'تدريب على جودة الرد والإغلاق'
                            : 'لا توجد توصية عاجلة'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="stat-card">
      <Icon size={18} className="text-teal-300" />
      <div className="mt-3 text-xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}
