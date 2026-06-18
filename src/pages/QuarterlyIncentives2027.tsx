import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import {
  Award,
  Crown,
  FileText,
  TrendingUp,
  Users,
  AlertTriangle,
  CheckCircle,
  Filter,
  Database,
} from 'lucide-react';
import { formatMoney, formatNumber } from '@/lib/dawaa2027';
import {
  loadQuarterlyIncentiveSummary,
  type QuarterlyIncentiveSummary,
} from '@/lib/performance/quarterlyIncentiveService';
import { QUARTERLY_RULES } from '@/lib/performance/ruleDefinitions';
import { formatRuleImpact } from '@/lib/ruleDisplay';
import {
  checkDataHealth,
  getHealthSeverityColor,
  type DataHealthIssue,
} from '@/lib/dataIntegrityService';

export default function QuarterlyIncentives2027() {
  const [summary, setSummary] = useState<QuarterlyIncentiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataHealth, setDataHealth] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadQuarterlyIncentiveSummary(), checkDataHealth()])
      .then(([incentiveResult, healthResult]) => {
        if (!cancelled) {
          setSummary(incentiveResult);
          setDataHealth(healthResult);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'تعذر تحميل الحافز الربع سنوي');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = summary?.rows || [];

  const exportQuarterlyReport = () => {
    const totalIncentive = rows.reduce((sum, r) => sum + r.quarterlyFinalValue, 0);
    const totalRewards = rows.reduce((sum, r) => sum + r.quarterlyMoneyRewards, 0);
    const totalDeductions = rows.reduce((sum, r) => sum + r.quarterlyMoneyDeductions, 0);
    const reportRows = rows
      .map(
        (row) => `<tr>
        <td>${row.name}</td>
        <td>${row.branch || '-'}</td>
        <td>${formatMoney(row.sales)}</td>
        <td>${row.invoices}</td>
        <td>${formatMoney(row.avgInvoice)}</td>
        <td>${row.score}/100</td>
        <td>${formatMoney(row.quarterlyMoneyRewards)}</td>
        <td>${formatMoney(row.quarterlyMoneyDeductions)}</td>
        <td>${formatMoney(row.quarterlyFinalValue)}</td>
      </tr>`
      )
      .join('');
    const win = window.open('', '_blank', 'width=1100,height=780');
    if (!win) {
      alert('المتصفح منع فتح نافذة التقرير. اسمح بالنوافذ المنبثقة للتصدير.');
      return;
    }
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
      <title>تقرير الحافز الربع سنوي</title>
      <style>
        body{font-family:Arial,Tahoma,sans-serif;margin:28px;color:#102033;direction:rtl}
        h1{margin:0 0 8px;font-size:25px}.muted{color:#667085}.box{border:1px solid #d8dee8;border-radius:12px;padding:16px;margin:12px 0}
        table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #d8dee8;padding:9px;text-align:right;font-size:13px}th{background:#eef5f8}.num{font-weight:700;font-size:20px}
        .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.summary div{background:#f6fafb;border:1px solid #d8dee8;border-radius:10px;padding:12px}
        button{padding:10px 18px;border:0;border-radius:8px;background:#00a98f;color:white;font-weight:700;cursor:pointer}@media print{button{display:none}.box{break-inside:avoid}}
      </style></head><body>
      <button onclick="window.print()">تصدير PDF</button>
      <h1>صيدليات دواء - تقرير الحافز الربع سنوي</h1>
      <div class="muted">الربع: ${summary?.quarter.label || 'الربع الحالي'} - تاريخ الإصدار: ${new Date().toLocaleString('ar-EG')}</div>
      <div class="summary">
        <div><span class="muted">عدد الدكاترة</span><br><span class="num">${rows.length}</span></div>
        <div><span class="muted">إجمالي الحافز الربع سنوي</span><br><span class="num">${formatMoney(totalIncentive)}</span></div>
        <div><span class="muted">مكافآت الرواكد واللستة</span><br><span class="num">${formatMoney(totalRewards)}</span></div>
        <div><span class="muted">خصومات ربع سنوية</span><br><span class="num">${formatMoney(totalDeductions)}</span></div>
      </div>
      <div class="box"><h2>تفاصيل الدكاترة</h2><table>
        <thead><tr><th>الدكتور</th><th>الفرع</th><th>المبيعات</th><th>الفواتير</th><th>متوسط الفاتورة</th><th>الدرجة</th><th>مكافآت مالية</th><th>خصومات مالية</th><th>الحافز النهائي</th></tr></thead>
        <tbody>${reportRows || `<tr><td colspan="9">لا توجد بيانات ربع سنوية</td></tr>`}</tbody>
      </table></div>
      <div class="box"><h2>طريقة الحساب</h2><table>
        <tr><th>القاعدة الأساسية</th><td>2000 جنيه كل 3 أشهر</td></tr>
        <tr><th>مكافآت الرواكد واللستة</th><td>تضاف للحافز الربع سنوي</td></tr>
        <tr><th>الخصومات الربع سنوية</th><td>تُخصم من الحافز الربع سنوي</td></tr>
        <tr><th>الدرجة</th><td>للترتيب فقط، لا تؤثر على الحافز المالي</td></tr>
      </table></div>
      <script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>
      </body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="page-title">الحافز الربع سنوي 2027</h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            حافز منفصل بقيمة 2000 جنيه كل 3 أشهر. لا يختلط مع حافز الشهر: 500 نقطة = 1500 جنيه.
          </p>
        </div>
        <div className="rounded-2xl border border-teal-500/20 bg-teal-500/10 px-4 py-3 text-teal-200">
          {summary?.quarter.label || 'الربع الحالي'}
        </div>
      </div>

      {loading && <div className="stat-card text-center">جاري تحميل الحافز الربع سنوي...</div>}
      {error && <div className="stat-card text-red-200">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Crown}
          label="قيمة الحافز الكامل"
          value="2000 جنيه"
          hint="منفصل عن الحافز الشهري"
        />
        <Kpi
          icon={TrendingUp}
          label="دكاترة لهم نشاط"
          value={formatNumber(rows.length)}
          hint="حسب مصادر الربع"
        />
        <Kpi
          icon={Award}
          label="أعلى حافز متوقع"
          value={formatMoney(Math.max(0, ...rows.map((r) => r.quarterlyFinalValue)))}
          hint="قبل اعتماد المدير"
        />
        <Kpi
          icon={Users}
          label="أعلى عميل بالقيمة"
          value={rows[0]?.topCustomer?.[0] || '-'}
          hint={rows[0] ? formatMoney(rows[0].topCustomer?.[1] || 0) : ''}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={CheckCircle}
          label="إجمالي الحافز المتوقع"
          value={formatMoney(rows.reduce((sum, r) => sum + r.quarterlyFinalValue, 0))}
          hint="مجموع الحوافز للدكاترة"
        />
        <Kpi
          icon={Award}
          label="مكافآت الرواكد واللستة"
          value={formatMoney(rows.reduce((sum, r) => sum + r.quarterlyMoneyRewards, 0))}
          hint="مكافآت مالية للربع"
        />
        <Kpi
          icon={AlertTriangle}
          label="خصومات ربع سنوية"
          value={formatMoney(rows.reduce((sum, r) => sum + r.quarterlyMoneyDeductions, 0))}
          hint="خصومات معتمدة"
        />
        <Kpi
          icon={TrendingUp}
          label="متوسط الدرجة"
          value={
            rows.length
              ? `${Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length)}/100`
              : '-'
          }
          hint="متوسط درجة الفريق"
        />
      </div>

      {/* Data Health Section */}
      {dataHealth?.issues && dataHealth.issues.length > 0 && (
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-4">
            <Database className="text-amber-400" size={20} />
            <h2 className="section-title">مشاكل بيانات تؤثر على التقييم</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {dataHealth.issues.map((issue: DataHealthIssue) => (
              <div
                key={issue.type}
                className={`rounded-xl border p-4 ${getHealthSeverityColor(issue.severity)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm">{issue.description}</div>
                  <span className="badge-info">{issue.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stat-card">
        <h2 className="section-title mb-4">محاور التقييم الربع سنوي</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(summary?.pillars || []).map((pillar) => (
            <div key={pillar.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-white">{pillar.label}</div>
                <span className="badge-purple">{pillar.points}</span>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-400">{pillar.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-card overflow-x-auto">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title">ترتيب الدكاترة في الربع الحالي</h2>
          <button
            onClick={exportQuarterlyReport}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <FileText className="h-4 w-4" /> تصدير PDF
          </button>
        </div>
        <table className="data-table min-w-[1400px]">
          <thead>
            <tr>
              <th>الدكتور</th>
              <th>الفرع</th>
              <th>صافي مبيعات الربع</th>
              <th>عدد الفواتير</th>
              <th>متوسط الفاتورة</th>
              <th>أفضل عميل</th>
              <th>العملاء المتكررون</th>
              <th>نقاط المبيعات</th>
              <th>نقاط المتوسط</th>
              <th>نقاط العملاء</th>
              <th>نقاط اللستة</th>
              <th>نقاط الرواكد</th>
              <th>نقاط الجودة</th>
              <th>الدرجة /100</th>
              <th>مكافآت مالية</th>
              <th>خصومات مالية</th>
              <th>الحافز النهائي</th>
              <th>حالة البيانات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="font-bold text-white">{row.name}</td>
                <td>{row.branch || '-'}</td>
                <td>{formatMoney(row.sales)}</td>
                <td>{row.invoices}</td>
                <td>{formatMoney(row.avgInvoice)}</td>
                <td>{row.topCustomer?.[0] || '-'}</td>
                <td>{row.customersCount}</td>
                <td>{row.scoreSales}/25</td>
                <td>{row.scoreAvg}/20</td>
                <td>{row.scoreCustomers}/20</td>
                <td>{row.scoreList}/15</td>
                <td>{row.scoreStock}/10</td>
                <td>{row.scoreQuality}/10</td>
                <td className="font-black text-teal-300">{row.score}/100</td>
                <td className="text-green-300">{formatMoney(row.quarterlyMoneyRewards)}</td>
                <td className="text-red-300">{formatMoney(row.quarterlyMoneyDeductions)}</td>
                <td className="font-black text-white">{formatMoney(row.quarterlyFinalValue)}</td>
                <td className="text-xs text-slate-400">
                  {row.dataQuality > 0.8 ? 'جيد' : row.dataQuality > 0.5 ? 'متوسط' : 'ضعيف'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !loading && (
          <div className="p-8 text-center text-slate-400">
            لا توجد بيانات ربع سنوية كافية في الفترة الحالية.
          </div>
        )}
      </div>

      <div className="stat-card space-y-4">
        <h2 className="section-title">شرح الحافز الربع سنوي</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-teal-500/20 bg-teal-500/10 p-4">
            <div className="font-bold text-teal-200 text-sm mb-2">الحافز الشهري</div>
            <p className="text-xs leading-6 text-teal-100/90">
              كل دكتور يبدأ الدورة بـ 500 نقطة = 1500 جنيه. الخصومات تقلل النقاط. المكافآت
              الاستثنائية الشهرية تعوض النقاط فقط. الحافز الشهري لا يتجاوز 1500 جنيه.
            </p>
          </div>
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4">
            <div className="font-bold text-purple-200 text-sm mb-2">الحافز الربع سنوي</div>
            <p className="text-xs leading-6 text-purple-100/90">
              حافز مستقل بقيمة أساس 2000 جنيه كل 3 شهور. مكافآت الرواكد واللستة المالية تضاف هنا ولا
              تضاف لنقاط الشهر. الخصومات الربع سنوية تُخصم من هذا الحافز.
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <div className="font-bold text-amber-200 text-sm mb-2">
            الصيغة النهائية للحافز الربع سنوي
          </div>
          <p className="text-xs leading-6 text-amber-100/90">
            الحافز الربع سنوي = 2000 جنيه (أساس) + مكافآت مالية للرواكد واللستة - خصومات ربع سنوية
            معتمدة
          </p>
        </div>
      </div>

      <div className="stat-card space-y-4">
        <h2 className="section-title">قواعد الحافز الربع سنوي (2000 جنيه أساس)</h2>
        <p className="text-sm leading-7 text-slate-400">
          المكافآت المالية للرواكد واللستة تُجمع هنا ولا تُضاف لنقاط الشهر (500 = 1500 ج).
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {QUARTERLY_RULES.map((rule) => (
            <div key={rule.rule_code} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-white text-sm">{rule.title_ar}</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">{rule.rule_code}</div>
                </div>
                <span className="badge-purple text-xs whitespace-nowrap">
                  {formatRuleImpact({
                    impact_type: rule.impact_type,
                    points_delta: rule.points_delta,
                    money_delta: rule.money_delta,
                  })}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-6">{rule.description_ar}</p>
            </div>
          ))}
        </div>
      </div>

      <details className="stat-card">
        <summary className="cursor-pointer text-sm font-black">مصادر الحافز الربع سنوي</summary>
        <div className="mt-3 grid gap-2 text-sm text-slate-400">
          {(summary?.sourceBreakdown || []).map((source) => (
            <div key={source}>{source}</div>
          ))}
          {(summary?.warnings || []).map((warning) => (
            <div key={warning} className="text-amber-300">
              {warning}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ElementType;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{hint}</div>
        </div>
        <div className="rounded-2xl bg-purple-500/15 p-3 text-purple-300">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
