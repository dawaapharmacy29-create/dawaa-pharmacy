import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Users, UserPlus, UserCheck, UserX, AlertTriangle, RefreshCw, FileUp, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import {
  fetchMonthlyCustomerPerformance,
  type MonthlyPerformanceSummary,
  type CustomerMonthlyRow,
} from '@/lib/customerMonthlyPerformanceService';
import { BRANCHES } from '@/lib/constants';
import { normalizeWatchlistRows, replaceCustomerWatchlist } from '@/lib/customerService/customerCohortIntelligenceService';
import CustomerQuickDetailsModal from '@/components/customers/CustomerQuickDetailsModal';
import { Panel, SectionTitle, KpiCard, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';

type PeriodMode = 'cycle' | 'calendar';

const ALL_BRANCHES_VALUE = 'كل الفروع';

function calendarMonthRange(date: Date): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function previousPeriod(mode: PeriodMode, start: string): { start: string; end: string } {
  const d = new Date(start);
  if (mode === 'cycle') {
    d.setDate(d.getDate() - 1); // يوم قبل بداية الدورة الحالية = آخر يوم في الدورة السابقة
    return getPharmacyCycleRange(d);
  }
  d.setDate(0); // آخر يوم في الشهر السابق
  return calendarMonthRange(d);
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString('ar-EG') + ' ج.م';
}

const STATE_TOKEN: Record<string, string> = {
  'جديد': 'var(--dawaa-status-success-text)',
  'مستعاد': 'var(--dawaa-theme-primary-strong)',
  'نمو قوي': 'var(--dawaa-status-success-text)',
  'نمو': 'var(--dawaa-status-success-text)',
  'مستقر': 'var(--dawaa-status-info-text)',
  'تراجع': 'var(--dawaa-status-warning-text)',
  'تراجع قوي': 'var(--dawaa-status-danger-text)',
  'مختفي هذا الشهر': 'var(--dawaa-status-danger-text)',
};

function followupUrl(c: CustomerMonthlyRow) {
  const params = new URLSearchParams({ quickFollowup: '1' });
  if (c.customer_code) params.set('code', c.customer_code);
  if (c.customer_name) params.set('name', c.customer_name);
  if (c.phone) params.set('phone', c.phone);
  // نخزّن نفس البيانات في sessionStorage كمان كطبقة أضمن — قراءة مباشرة ومتزامنة
  // في الصفحة الجاية، مستقلة تمامًا عن أي توقيت لقراءة رابط الصفحة أو الـ React Router.
  try {
    sessionStorage.setItem(
      'dawaa_pending_followup_customer',
      JSON.stringify({ code: c.customer_code || '', name: c.customer_name || '', phone: c.phone || '' })
    );
  } catch {
    // sessionStorage ممكن يكون مش متاح في بعض السياقات — الرابط نفسه يفضل يشتغل كـ fallback
  }
  return `/customer-service?${params.toString()}`;
}

const STATE_FILTER_OPTIONS = ['الكل', 'تراجع قوي', 'مختفي هذا الشهر', 'تراجع'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CustomerMonthlyPerformance() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canSeeAllBranches = canViewAllBranches(user);
  const [mode, setMode] = useState<PeriodMode>('cycle');
  const [refDate, setRefDate] = useState<string>(() => todayStr());
  const [stateFilter, setStateFilter] = useState<string>('الكل');
  const [listTab, setListTab] = useState<'declining' | 'improving'>('declining');
  const [branch, setBranch] = useState<string>(() =>
    canSeeAllBranches ? ALL_BRANCHES_VALUE : user?.branch || BRANCHES?.[0] || 'فرع شكري'
  );
  const [summary, setSummary] = useState<
    (MonthlyPerformanceSummary & { computedAt: string | null; fromCache: boolean }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [watchlistMessage, setWatchlistMessage] = useState('');
  const [uploadingWatchlist, setUploadingWatchlist] = useState(false);
  const [detailsCustomer, setDetailsCustomer] = useState<CustomerMonthlyRow | null>(null);

  const period = useMemo(
    () => (mode === 'cycle' ? getPharmacyCycleRange(new Date(refDate)) : calendarMonthRange(new Date(refDate))),
    [mode, refDate]
  );
  const prevPeriod = useMemo(() => previousPeriod(mode, period.start), [mode, period.start]);
  const isCurrentPeriod = refDate === todayStr();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchMonthlyCustomerPerformance(
        branch === ALL_BRANCHES_VALUE ? null : branch,
        period.start,
        period.end,
        prevPeriod.start,
        prevPeriod.end,
        mode
      );
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, mode, refDate]);

  const salesChangePct =
    summary && summary.previousTotalSales > 0
      ? Math.round(((summary.totalSales - summary.previousTotalSales) / summary.previousTotalSales) * 1000) / 10
      : null;

  const uploadWatchlist = async (file: File) => {
    if (branch === ALL_BRANCHES_VALUE) {
      setWatchlistMessage('اختاري فرعًا محددًا قبل رفع قائمة أهم 20 عميل.');
      return;
    }
    setUploadingWatchlist(true);
    setWatchlistMessage('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = normalizeWatchlistRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }));
      if (!rows.length) throw new Error('لم يتم العثور على عمود كود العميل. استخدمي: كود العميل، اسم العميل، الهاتف، ملاحظة.');
      const saved = await replaceCustomerWatchlist(branch, rows);
      setWatchlistMessage(`تم اعتماد قائمة مراقبة من ${saved} عميل لفرع ${branch}.`);
    } catch (uploadError) {
      setWatchlistMessage(uploadError instanceof Error ? uploadError.message : 'تعذر رفع قائمة المراقبة');
    } finally {
      setUploadingWatchlist(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-4 p-4 md:p-6">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="dawaa-icon-tile p-3"><Users style={{ color: 'var(--dawaa-theme-primary-strong)' }} /></div>
            <div>
              <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>أداء العملاء الشهري</h1>
              <p className="text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>كسبنا كام عميل، فقدنا كام، مين محتاج متابعة النهاردة — في أقل من دقيقة.</p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} className="btn-secondary flex items-center gap-2 text-xs" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <button
              type="button"
              onClick={() => setMode('cycle')}
              className="px-4 py-2 text-sm font-bold"
              style={mode === 'cycle' ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' } : { color: 'var(--dawaa-theme-muted)' }}
            >
              دورة دواء 26-25
            </button>
            <button
              type="button"
              onClick={() => setMode('calendar')}
              className="px-4 py-2 text-sm font-bold"
              style={mode === 'calendar' ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' } : { color: 'var(--dawaa-theme-muted)' }}
            >
              الشهر الميلادي
            </button>
          </div>
          {canSeeAllBranches ? (
            <select className="input-dark w-auto" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value={ALL_BRANCHES_VALUE}>{ALL_BRANCHES_VALUE}</option>
              {(BRANCHES || ['فرع شكري', 'فرع الشامي']).map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          ) : (
            <span className="rounded-xl border px-4 py-2 text-sm font-bold" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)', color: 'var(--dawaa-theme-heading)' }}>
              {branch}
            </span>
          )}
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="input-dark w-auto"
              value={refDate}
              max={todayStr()}
              onChange={(e) => setRefDate(e.target.value || todayStr())}
            />
            {!isCurrentPeriod && (
              <button type="button" onClick={() => setRefDate(todayStr())} className="btn-secondary text-xs">
                الفترة الحالية
              </button>
            )}
          </div>
          <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            {period.start} إلى {period.end} — مقارنة بـ {prevPeriod.start} إلى {prevPeriod.end}
          </span>
          {summary?.computedAt && (
            <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
              آخر تحديث: {new Date(summary.computedAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <label className={`btn-secondary flex cursor-pointer items-center gap-2 text-xs ${branch === ALL_BRANCHES_VALUE || uploadingWatchlist ? 'pointer-events-none opacity-50' : ''}`}>
            <FileUp size={14} /> {uploadingWatchlist ? 'جاري رفع القائمة...' : 'رفع أهم 20 عميل'}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.xls,.csv"
              disabled={branch === ALL_BRANCHES_VALUE || uploadingWatchlist}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadWatchlist(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        {watchlistMessage ? (
          <p
            className="mt-3 rounded-xl border p-3 text-xs font-bold"
            style={watchlistMessage.startsWith('تم اعتماد')
              ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }
              : { borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}
          >
            {watchlistMessage}
          </p>
        ) : null}
        {error && <p className="mt-3 text-sm font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>{error}</p>}
      </Panel>

      {loading ? (
        <Panel className="p-8 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          جارٍ التحميل...{!isCurrentPeriod && ' (فترة تاريخية مش مخزّنة، ممكن تاخد لحد 10-15 ثانية)'}
        </Panel>
      ) : null}

      {summary && !loading && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="عملاء جدد" value={String(summary.newCount)} subtitle="اشتروا لأول مرة في الفترة" icon={<UserPlus size={20} />} tone="green" />
            <KpiCard title="عملاء مستعادين" value={String(summary.reactivatedCount)} subtitle="رجعوا بعد توقف" icon={<UserCheck size={20} />} tone="cyan" />
            <KpiCard title="اختفوا تمامًا" value={String(summary.lostCount)} subtitle="مفيش شراء نهائي هذا الشهر" icon={<UserX size={20} />} tone="red" />
            <KpiCard title="تراجعوا بقوة" value={String(summary.strongDeclineCount)} subtitle="انخفاض واضح في مشترياتهم" icon={<TrendingDown size={20} />} tone="amber" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MiniBox
              label="صافي نمو العملاء (جدد + مستعادين - مختفين)"
              value={`${summary.netCustomerGrowth >= 0 ? '+' : ''}${summary.netCustomerGrowth}`}
              tone={summary.netCustomerGrowth >= 0 ? 'green' : 'red'}
            />
            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)' }}>
              <p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-text)' }}>إجمالي المبيعات (مقارنة بالفترة السابقة)</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{fmtMoney(summary.totalSales)}</span>
                {salesChangePct !== null && (
                  <span className="flex items-center gap-1 text-xs font-black" style={{ color: salesChangePct >= 0 ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-danger-text)' }}>
                    {salesChangePct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {salesChangePct}%
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)' }}>
              <p className="flex items-center gap-2 text-xs font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}><AlertTriangle size={14} /> إيراد معرّض للخطر</p>
              <p className="mt-2 text-2xl font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}>{fmtMoney(summary.revenueAtRisk)}</p>
              <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>من عملاء اختفوا أو تراجعوا بقوة</p>
            </div>
          </section>

          <div className="flex w-fit overflow-hidden rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <button
              type="button"
              onClick={() => setListTab('declining')}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
              style={listTab === 'declining' ? { background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' } : { color: 'var(--dawaa-theme-muted)' }}
            >
              <TrendingDown size={16} /> العملاء المتراجعين ({summary.needsAttention.length})
            </button>
            <button
              type="button"
              onClick={() => setListTab('improving')}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
              style={listTab === 'improving' ? { background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' } : { color: 'var(--dawaa-theme-muted)' }}
            >
              <TrendingUp size={16} /> العملاء المتحسنين ({summary.improving.length})
            </button>
          </div>

          {listTab === 'declining' && (
          <Panel className="space-y-3 p-4">
            <SectionTitle
              title={`عملاء يحتاجون متابعتك النهاردة (${summary.needsAttention.filter((c) => stateFilter === 'الكل' || c.customer_state === stateFilter).length})`}
              icon={<TrendingDown size={18} />}
            />
            <div className="-mt-2 mb-1 flex items-center gap-2">
              <select className="input-dark w-auto text-xs" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                {STATE_FILTER_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s === 'الكل' ? 'كل الحالات' : s}</option>
                ))}
              </select>
              <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>مرتبين حسب قيمة الخطر</span>
            </div>
            {(() => {
              const filtered = summary.needsAttention.filter((c) => stateFilter === 'الكل' || c.customer_state === stateFilter);
              return filtered.length === 0 ? (
                <EmptyState label="مفيش عملاء مطابقين للفلتر ده دلوقتي 🎉" />
              ) : (
                <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-right text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        <th className="p-2 font-bold">العميل</th>
                        <th className="p-2 font-bold">قبل 3 شهور</th>
                        <th className="p-2 font-bold">قبل شهرين</th>
                        <th className="p-2 font-bold">الشهر السابق</th>
                        <th className="p-2 font-bold">الشهر الحالي</th>
                        <th className="p-2 font-bold">الحالة</th>
                        <th className="p-2 font-bold">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 30).map((c, i) => (
                        <tr key={`${c.customer_code}-${i}`} className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                          <td className="p-2">
                            <div className="font-bold" style={{ color: 'var(--dawaa-theme-heading)' }}>{c.customer_name || 'غير معروف'}</div>
                            <div className="text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              ({c.previous_segment}) · آخر شراء: {c.last_purchase_date || '—'}
                              {branch === ALL_BRANCHES_VALUE && <span style={{ color: 'var(--dawaa-theme-primary-strong)' }}> · {c.branch}</span>}
                              {c.customer_code && <span> · كود {c.customer_code}</span>}
                            </div>
                          </td>
                          <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>{fmtMoney(c.month_3_ago_sales)}</td>
                          <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>{fmtMoney(c.month_2_ago_sales)}</td>
                          <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>{fmtMoney(c.previous_month_sales)}</td>
                          <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>{fmtMoney(c.sales_amount)}</td>
                          <td className="p-2"><span className="text-xs font-black" style={{ color: STATE_TOKEN[c.customer_state] || 'var(--dawaa-theme-text)' }}>{c.customer_state}</span></td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDetailsCustomer(c)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                                style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}
                                aria-label={`عرض تفاصيل العميل ${c.customer_name || ''}`}
                                title="عرض تفاصيل العميل"
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(followupUrl(c))}
                                className="rounded-lg px-3 py-1.5 text-xs font-black"
                                style={{ background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }}
                              >
                                متابعة الآن
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Panel>
          )}
          {listTab === 'improving' && (
          <Panel className="space-y-3 p-4">
            <SectionTitle
              title={`عملاء متحسنين محتاجين شكر واهتمام (${summary.improving.length})`}
              subtitle="مرتبين حسب أعلى زيادة في المبيعات"
              icon={<TrendingUp size={18} />}
            />
            {summary.improving.length === 0 ? (
              <EmptyState label="مفيش عملاء مهمين بيتحسنوا بشكل ملحوظ في الفترة دي دلوقتي." />
            ) : (
              <div className="space-y-2">
                {summary.improving.slice(0, 30).map((c, i) => (
                  <div key={`${c.customer_code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)' }}>
                    <div>
                      <div className="font-bold" style={{ color: 'var(--dawaa-theme-heading)' }}>{c.customer_name || 'غير معروف'} <span className="text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>({c.current_segment})</span></div>
                      <div className="text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        آخر شراء: {c.last_purchase_date || '—'} · دلوقتي بيصرف {fmtMoney(c.sales_amount)}
                        {c.sales_change_amount > 0 && <span style={{ color: 'var(--dawaa-status-success-text)' }}> (+{fmtMoney(c.sales_change_amount)})</span>}
                        {branch === ALL_BRANCHES_VALUE && <span style={{ color: 'var(--dawaa-theme-primary-strong)' }}> · {c.branch}</span>}
                        {c.customer_code && <span> · كود {c.customer_code}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-black" style={{ color: STATE_TOKEN[c.customer_state] || 'var(--dawaa-theme-text)' }}>{c.customer_state}</span>
                      <button
                        type="button"
                        onClick={() => setDetailsCustomer(c)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                        style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-status-success-text)' }}
                        aria-label={`عرض تفاصيل العميل ${c.customer_name || ''}`}
                        title="عرض تفاصيل العميل"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(followupUrl(c))}
                        className="rounded-lg px-3 py-1.5 text-xs font-black"
                        style={{ background: 'var(--dawaa-status-success-text)', color: 'var(--dawaa-theme-primary-text)' }}
                      >
                        اتصال شكر
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          )}
        </>
      )}

      {detailsCustomer && (
        <CustomerQuickDetailsModal
          customerCode={detailsCustomer.customer_code}
          customerPhone={detailsCustomer.phone}
          customerName={detailsCustomer.customer_name}
          branch={detailsCustomer.branch || (branch === ALL_BRANCHES_VALUE ? null : branch)}
          fallbackMetric={{
            invoices_count: detailsCustomer.invoice_count,
            total_spent: detailsCustomer.sales_amount,
            total_purchases: detailsCustomer.sales_amount,
            avg_invoice: detailsCustomer.avg_invoice,
            last_purchase: detailsCustomer.last_purchase_date,
            segment: detailsCustomer.current_segment || detailsCustomer.previous_segment,
            type: detailsCustomer.current_segment || detailsCustomer.previous_segment,
            customer_status: detailsCustomer.customer_state,
            status: detailsCustomer.customer_state,
          }}
          onClose={() => setDetailsCustomer(null)}
        />
      )}
    </div>
  );
}
