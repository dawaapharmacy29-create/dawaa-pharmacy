import { AlertTriangle, BarChart3, Loader2, TrendingUp, Users } from 'lucide-react';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import type { AccuracyReport } from '../types';
import { getStaffStatus } from '../ui';

type Props = {
  report: AccuracyReport;
  loading: boolean;
  error: boolean;
  reviewerFilterActive: boolean;
  onRetry: () => void;
};

export function ReportsPanel({ report, loading, error, reviewerFilterActive, onRetry }: Props) {
  if (loading) {
    return <Panel className="flex justify-center p-10"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-primary)' }} /></Panel>;
  }

  if (error) {
    return <Panel className="p-4"><EmptyState label="تعذّر تحميل التقارير الذكية" error onRetry={onRetry} /></Panel>;
  }

  const sufficientStaff = report.staff.filter((row) => row.reviewed_count >= 5);
  const topRiskStaff = [...sufficientStaff].sort(
    (a, b) => (b.negligence_count + b.customer_problem_count) - (a.negligence_count + a.customer_problem_count)
      || a.accuracy_rate - b.accuracy_rate,
  )[0] || null;
  const sufficientBranches = report.branches.filter((row) => row.reviewed_count >= 5);
  const worstBranch = [...sufficientBranches].sort(
    (a, b) => a.accuracy_rate - b.accuracy_rate || b.pending_count - a.pending_count,
  )[0] || null;
  const latestDaily = report.daily.length ? report.daily[report.daily.length - 1] : null;

  return (
    <div className="space-y-4">
      {reviewerFilterActive ? (
        <Panel className="p-3">
          <p className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            فلتر المراجع يؤثر على المراجعات المنجزة فقط؛ الفواتير المعلقة لم يتم تعيين مراجع لها بعد.
          </p>
        </Panel>
      ) : null}

      <Panel className="p-4">
        <SectionTitle title="ملخص الرقابة على دقة الإدخال" subtitle="الأرقام محسوبة من قاعدة البيانات على كل السجلات المطابقة للفلاتر" icon={<BarChart3 size={18} />} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ['تمت مراجعتها', report.summary.reviewed_count],
            ['معلقة للمراجعة', report.summary.pending_count],
            ['نسبة الدقة', `${report.summary.accuracy_rate}%`],
            ['إجمالي النقاط', report.summary.total_points],
            ['إدخال صحيح', report.summary.correct_count],
            ['لخبطة/عدم تسجيل', report.summary.mixup_count],
            ['إهمال', report.summary.negligence_count],
            ['مشكلة مع عميل', report.summary.customer_problem_count],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
              <p className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{label}</p>
              <p className="mt-1 text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{value}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionTitle title="تنبيهات الإدارة" subtitle="التنبيهات المقارنة لا تُصنف الموظف أو الفرع قبل 5 مراجعات" icon={<AlertTriangle size={18} />} />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)' }}>
            <p className="text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>فواتير بدون موظف مؤكد</p>
            <p className="mt-1 text-2xl font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>{report.summary.unknown_staff_count}</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>أعلى موظف يحتاج مراجعة</p>
            <p className="mt-1 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              {topRiskStaff ? `${topRiskStaff.staff_name} — ${topRiskStaff.accuracy_rate}% (${topRiskStaff.reviewed_count} مراجعة)` : 'لا توجد عينة كافية'}
            </p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>الفرع الأقل دقة</p>
            <p className="mt-1 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              {worstBranch ? `${worstBranch.branch} — ${worstBranch.accuracy_rate}% (${worstBranch.reviewed_count} مراجعة)` : 'لا توجد عينة كافية'}
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionTitle title={`أداء الموظفين (${report.staff.length})`} subtitle="ترتيب حسب الدقة وعدد المراجعات، مع حماية من الحكم على العينات الصغيرة" icon={<Users size={18} />} />
        {report.staff.length === 0 ? <EmptyState label="لا توجد مراجعات موظفين مطابقة للفلاتر" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-right text-xs">
              <thead>
                <tr style={{ color: 'var(--dawaa-theme-muted)' }}>
                  <th className="p-2">الموظف</th><th className="p-2">الفرع</th><th className="p-2">مراجعات</th><th className="p-2">صحيح</th><th className="p-2">لخبطة</th><th className="p-2">إهمال</th><th className="p-2">مشكلة عميل</th><th className="p-2">الدقة</th><th className="p-2">النقاط</th><th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {report.staff.map((row) => {
                  const status = getStaffStatus(row);
                  return (
                    <tr key={row.staff_id} className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                      <td className="p-2 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.staff_name}</td>
                      <td className="p-2">{row.branch || '—'}</td><td className="p-2">{row.reviewed_count}</td><td className="p-2">{row.correct_count}</td><td className="p-2">{row.mixup_count}</td><td className="p-2">{row.negligence_count}</td><td className="p-2">{row.customer_problem_count}</td><td className="p-2 font-black">{row.accuracy_rate}%</td><td className="p-2 font-black">{row.total_points}</td>
                      <td className="p-2"><span className="rounded-full px-2 py-1 font-black" style={{ color: status.color, background: status.bg }}>{status.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <SectionTitle title="مقارنة الفروع" subtitle="دقة الإدخال والمراجعات المعلقة لكل فرع" icon={<BarChart3 size={18} />} />
        {report.branches.length === 0 ? <EmptyState label="لا توجد بيانات فروع مطابقة للفلاتر" /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.branches.map((row) => (
              <div key={row.branch} className="rounded-xl border p-4" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex items-center justify-between"><h3 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.branch}</h3><span className="text-lg font-black" style={{ color: 'var(--dawaa-theme-primary)' }}>{row.accuracy_rate}%</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div><p style={{ color: 'var(--dawaa-theme-muted)' }}>مراجعات</p><p className="font-black">{row.reviewed_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>معلق</p><p className="font-black">{row.pending_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>النقاط</p><p className="font-black">{row.total_points}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>صحيح</p><p className="font-black">{row.correct_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>إهمال</p><p className="font-black">{row.negligence_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>مشاكل عملاء</p><p className="font-black">{row.customer_problem_count}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <SectionTitle title="الاتجاه اليومي" subtitle={latestDaily ? `آخر يوم مسجل: ${latestDaily.report_date} — الدقة ${latestDaily.accuracy_rate}%` : 'متابعة تحسن أو تراجع جودة الإدخال يومًا بيوم'} icon={<TrendingUp size={18} />} />
        {report.daily.length === 0 ? <EmptyState label="لا توجد بيانات يومية للفترة المختارة" /> : (
          <div className="space-y-2">
            {report.daily.slice(-14).map((row) => (
              <div key={row.report_date} className="grid grid-cols-4 gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <span className="font-black">{row.report_date}</span><span>مراجعات: <b>{row.reviewed_count}</b></span><span>صحيح: <b>{row.correct_count}</b></span><span>الدقة: <b>{row.accuracy_rate}%</b></span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
