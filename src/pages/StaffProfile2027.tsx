import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight, Loader2, AlertTriangle, TrendingUp, Users, Package, DollarSign, Calendar, Award, AlertCircle, BarChart3 } from "lucide-react";
import { loadStaffPerformanceProfile, type StaffPerformanceProfile } from "@/lib/staff/staffPerformanceProfileService";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { formatMoney } from "@/lib/dawaa2027";
import StaffPerformanceCharts from "@/components/staff/StaffPerformanceCharts";

type TabKey = "overview" | "sales" | "customers" | "stagnant" | "incentives" | "quarterly" | "attendance" | "service" | "recommendations" | "charts";

const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: "overview", label: "ملخص تنفيذي", icon: TrendingUp },
  { key: "sales", label: "المبيعات", icon: DollarSign },
  { key: "customers", label: "العملاء", icon: Users },
  { key: "stagnant", label: "الرواكد واللستة", icon: Package },
  { key: "incentives", label: "الحوافز الشهرية", icon: Award },
  { key: "quarterly", label: "الأداء الربع سنوي", icon: Calendar },
  { key: "attendance", label: "الحضور", icon: Calendar },
  { key: "service", label: "خدمة العملاء", icon: Users },
  { key: "recommendations", label: "التوصيات", icon: AlertCircle },
  { key: "charts", label: "الرسوم البيانية", icon: BarChart3 },
];

export default function StaffProfile2027() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<StaffPerformanceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  useEffect(() => {
    if (!id) return;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const data = await loadStaffPerformanceProfile({ staffId: id, forceRefresh: true });
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 className="animate-spin text-teal-400" />
        جاري تحميل ملف الموظف...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="stat-card text-center py-16 space-y-4">
        <div className="text-red-400">{error || "لم يتم العثور على الموظف"}</div>
        <Link to="/team" className="btn-secondary inline-flex items-center gap-2">
          <ArrowRight size={14} /> العودة للفريق
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/team" className="text-slate-400 hover:text-teal-400 text-sm">الفريق</Link>
        <span className="text-slate-600">/</span>
        <span className="text-white font-bold">{profile.staff.name}</span>
      </div>

      {/* Staff Info Card */}
      <div className="stat-card border border-teal-500/20">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-teal-500/15 flex items-center justify-center text-teal-400 text-2xl font-bold">
            {profile.staff.name[0]}
          </div>
          <div className="flex-1">
            <div className="text-white font-bold text-xl">{profile.staff.name}</div>
            <div className="text-slate-400 text-sm mt-1">{profile.staff.role} - {profile.staff.branch}</div>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-slate-500">ID: {profile.staff.id}</span>
              {!profile.staff.is_active && (
                <span className="text-amber-400 font-bold">غير نشط</span>
              )}
            </div>
          </div>
          <div className="text-left">
            {profile.monthlyIncentive && (
              <>
                <div className="text-3xl font-bold num text-teal-400">
                  {profile.monthlyIncentive.finalPoints}
                </div>
                <div className="text-slate-500 text-xs">نقطة شهرية</div>
                <div className="text-teal-400 text-xs mt-2 num">
                  حافز شهري {formatCurrency(profile.monthlyIncentive.incentiveValue)} ج
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Data Health Warnings */}
      {profile.dataHealth.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="text-amber-200 font-bold text-sm mb-2">تنبيهات جودة البيانات</div>
              <ul className="space-y-1 text-xs leading-6 text-amber-100/90">
                {profile.dataHealth.warnings.slice(0, 5).map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Identity Warnings */}
      {profile.identity.warnings.length > 0 && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-blue-400 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="text-blue-200 font-bold text-sm mb-2">تنبيهات الهوية</div>
              <ul className="space-y-1 text-xs leading-6 text-blue-100/90">
                {profile.identity.warnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
              {profile.identity.rawSellerNames.length > 0 && (
                <div className="mt-2 text-xs text-blue-200">
                  الأسماء في الفواتير: {profile.identity.rawSellerNames.slice(0, 3).join(", ")}
                  {profile.identity.rawSellerNames.length > 3 && "..."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[#2d4063]">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-teal-400 text-teal-400 bg-teal-500/10"
                    : "border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/5"
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "overview" && <OverviewTab profile={profile} />}
        {activeTab === "sales" && <SalesTab profile={profile} />}
        {activeTab === "customers" && <CustomersTab profile={profile} />}
        {activeTab === "stagnant" && <StagnantTab profile={profile} />}
        {activeTab === "incentives" && <IncentivesTab profile={profile} />}
        {activeTab === "quarterly" && <QuarterlyTab profile={profile} />}
        {activeTab === "attendance" && <AttendanceTab profile={profile} />}
        {activeTab === "service" && <ServiceTab profile={profile} />}
        {activeTab === "recommendations" && <RecommendationsTab profile={profile} />}
        {activeTab === "charts" && <ChartsTab profile={profile} />}
      </div>
    </div>
  );
}

function OverviewTab({ profile }: { profile: StaffPerformanceProfile }) {
  return (
    <div className="space-y-6">
      {/* Key KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="مبيعات الدورة"
          value={profile.sales ? formatMoney(profile.sales.cycleNetSales) : "-"}
          icon={DollarSign}
          color="teal"
        />
        <KPICard
          label="عدد الفواتير"
          value={profile.sales ? formatNumber(profile.sales.cycleInvoicesCount) : "-"}
          icon={Package}
          color="blue"
        />
        <KPICard
          label="عملاء مختلفون"
          value={profile.sales ? formatNumber(profile.sales.uniqueCustomers) : "-"}
          icon={Users}
          color="purple"
        />
        <KPICard
          label="متوسط الفاتورة"
          value={profile.sales ? formatCurrency(profile.sales.avgInvoice) : "-"}
          icon={TrendingUp}
          color="amber"
        />
      </div>

      {/* Incentive Summary */}
      {profile.monthlyIncentive && (
        <section className="stat-card space-y-4 border border-teal-500/20">
          <h3 className="section-title text-sm">ملخص الحوافز الشهرية</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniStat label="النقاط النهائية" value={String(profile.monthlyIncentive.finalPoints)} />
            <MiniStat label="المكافآت" value={`+${profile.monthlyIncentive.approvedRewardPoints}`} />
            <MiniStat label="الخصومات" value={`-${profile.monthlyIncentive.approvedDeductionPoints}`} />
            <MiniStat label="الحافز النهائي" value={formatCurrency(profile.monthlyIncentive.incentiveValue)} />
          </div>
          {profile.monthlyIncentive.pendingDeductionPoints > 0 && (
            <div className="text-amber-300 text-xs">
              يوجد خصومات معلقة: {profile.monthlyIncentive.pendingDeductionPoints} نقطة
            </div>
          )}
        </section>
      )}

      {/* Stagnant/List Summary */}
      {(profile.stagnantMedicines || profile.listItems) && (
        <section className="stat-card space-y-4 border border-amber-500/20">
          <h3 className="section-title text-sm">ملخص الرواكد واللستة</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {profile.stagnantMedicines && (
              <>
                <MiniStat label="أصناف راكدة" value={String(profile.stagnantMedicines.assignedStagnantItems)} />
                <MiniStat label="مكتمل" value={`${profile.stagnantMedicines.stagnantCompletionPercent.toFixed(0)}%`} />
              </>
            )}
            {profile.listItems && (
              <>
                <MiniStat label="أصناف لستة" value={String(profile.listItems.assignedListItems)} />
                <MiniStat label="مكتمل" value={`${profile.listItems.listCompletionPercent.toFixed(0)}%`} />
              </>
            )}
          </div>
        </section>
      )}

      {/* Customer Summary */}
      {profile.customers && (
        <section className="stat-card space-y-4 border border-purple-500/20">
          <h3 className="section-title text-sm">ملخص العملاء</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniStat label="عملاء جدد" value={String(profile.customers.newCustomers)} />
            <MiniStat label="عملاء متكررين" value={String(profile.customers.repeatCustomers.length)} />
            <MiniStat label="يحتاجون متابعة" value={String(profile.customers.customersNeedingFollowupCount)} />
            <MiniStat label="بدون هاتف" value={String(profile.customers.customersWithMissingPhone)} />
          </div>
        </section>
      )}
    </div>
  );
}

function SalesTab({ profile }: { profile: StaffPerformanceProfile }) {
  if (!profile.sales) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات مبيعات</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="مبيعات الدورة" value={formatMoney(profile.sales.cycleNetSales)} icon={DollarSign} color="teal" />
        <KPICard label="عدد الفواتير" value={formatNumber(profile.sales.cycleInvoicesCount)} icon={Package} color="blue" />
        <KPICard label="متوسط الفاتورة" value={formatCurrency(profile.sales.avgInvoice)} icon={TrendingUp} color="amber" />
        <KPICard label="عملاء مختلفون" value={formatNumber(profile.sales.uniqueCustomers)} icon={Users} color="purple" />
      </div>

      <section className="stat-card space-y-4">
        <h3 className="section-title text-sm">تفاصيل المبيعات</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard label="أفضل يوم" value={profile.sales.bestDay || "-"} />
          <InfoCard label="أضعف يوم" value={profile.sales.weakestDay || "-"} />
          <InfoCard label="أفضل شيفت" value={profile.sales.topShift || "-"} />
          <InfoCard label="فواتير توصيل" value={String(profile.sales.deliveryInvoices)} />
        </div>
      </section>

      {profile.sales.latestInvoices.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">أحدث الفواتير</h3>
          <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-[#16253f] text-slate-300">
                <tr>
                  <th className="p-3 text-right">رقم الفاتورة</th>
                  <th className="p-3 text-right">التاريخ</th>
                  <th className="p-3 text-right">العميل</th>
                  <th className="p-3 text-right">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {profile.sales.latestInvoices.slice(0, 20).map((invoice) => (
                  <tr key={invoice.invoiceNumber} className="border-t border-[#2d4063]/70">
                    <td className="p-3 text-white">{invoice.invoiceNumber}</td>
                    <td className="p-3 text-slate-300">{invoice.date}</td>
                    <td className="p-3 text-slate-300">{invoice.customer}</td>
                    <td className="p-3 text-teal-300 num">{formatCurrency(invoice.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function CustomersTab({ profile }: { profile: StaffPerformanceProfile }) {
  if (!profile.customers) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات عملاء</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="عملاء جدد" value={String(profile.customers.newCustomers)} icon={Users} color="teal" />
        <KPICard label="عملاء متكررين" value={String(profile.customers.repeatCustomers.length)} icon={Users} color="blue" />
        <KPICard label="يحتاجون متابعة" value={String(profile.customers.customersNeedingFollowupCount)} icon={AlertCircle} color="amber" />
        <KPICard label="بدون هاتف" value={String(profile.customers.customersWithMissingPhone)} icon={AlertTriangle} color="red" />
      </div>

      {profile.customers.topCustomers.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">أهم العملاء</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {profile.customers.topCustomers.slice(0, 20).map((customer, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-xl bg-white/5 p-3">
                <div>
                  <div className="font-bold text-white">{customer.name}</div>
                  <div className="text-xs text-slate-500">{customer.segment} · {customer.invoicesCount} فاتورة</div>
                </div>
                <div className="text-left">
                  <div className="font-bold text-teal-300">{formatMoney(customer.totalSpent)}</div>
                  <div className="text-xs text-slate-500">آخر شراء: {customer.lastPurchase}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {profile.customers.customersNeedingFollowup.length > 0 && (
        <section className="stat-card space-y-4 border border-amber-500/20">
          <h3 className="section-title text-sm">عملاء يحتاجون متابعة</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {profile.customers.customersNeedingFollowup.slice(0, 20).map((customer, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-xl bg-amber-500/10 p-3">
                <div>
                  <div className="font-bold text-amber-200">{customer.name}</div>
                  <div className="text-xs text-amber-100/70">{customer.reason}</div>
                </div>
                <div className="text-xs text-amber-200">{customer.expectedAction}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StagnantTab({ profile }: { profile: StaffPerformanceProfile }) {
  const stagnant = profile.stagnantMedicines;
  const list = profile.listItems;

  if (!stagnant && !list) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات رواكد أو لستة</div>;
  }

  return (
    <div className="space-y-6">
      {stagnant && (
        <section className="stat-card space-y-4 border border-amber-500/20">
          <h3 className="section-title text-sm">الأدوية الراكدة</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniStat label="أصناف مسندة" value={String(stagnant.assignedStagnantItems)} />
            <MiniStat label="الهدف" value={String(stagnant.stagnantTargetQuantity)} />
            <MiniStat label="تم بيع" value={String(stagnant.stagnantSoldQuantity)} />
            <MiniStat label="المتبقي" value={String(stagnant.stagnantRemainingQuantity)} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <InfoCard label="نسبة الإنجاز" value={`${stagnant.stagnantCompletionPercent.toFixed(1)}%`} />
            <InfoCard label="مكافآت محققة" value={formatCurrency(stagnant.stagnantCashRewards)} />
          </div>
          {stagnant.stagnantWarnings.length > 0 && (
            <div className="rounded-xl bg-amber-500/10 p-3">
              <div className="text-amber-200 text-sm font-bold mb-2">تنبيهات</div>
              <ul className="space-y-1 text-xs text-amber-100/90">
                {stagnant.stagnantWarnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
          {stagnant.itemsNearExpiry.length > 0 && (
            <div className="rounded-xl bg-red-500/10 p-3">
              <div className="text-red-200 text-sm font-bold mb-2">أصناف قاربت على الانتهاء</div>
              <div className="space-y-2">
                {stagnant.itemsNearExpiry.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="text-red-200">{item.name}</span>
                    <span className="text-red-300">{item.daysUntilExpiry} يوم</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {list && (
        <section className="stat-card space-y-4 border border-blue-500/20">
          <h3 className="section-title text-sm">أصناف اللستة</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniStat label="أصناف مسندة" value={String(list.assignedListItems)} />
            <MiniStat label="الهدف" value={String(list.listTargetQuantity)} />
            <MiniStat label="تم بيع" value={String(list.listSoldQuantity)} />
            <MiniStat label="المتبقي" value={String(list.listRemainingQuantity)} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <InfoCard label="نسبة الإنجاز" value={`${list.listCompletionPercent.toFixed(1)}%`} />
            <InfoCard label="مكافآت محققة" value={formatCurrency(list.listCashRewards)} />
          </div>
          {list.listWarnings.length > 0 && (
            <div className="rounded-xl bg-blue-500/10 p-3">
              <div className="text-blue-200 text-sm font-bold mb-2">تنبيهات</div>
              <ul className="space-y-1 text-xs text-blue-100/90">
                {list.listWarnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function IncentivesTab({ profile }: { profile: StaffPerformanceProfile }) {
  if (!profile.monthlyIncentive) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات حوافز</div>;
  }

  const incentive = profile.monthlyIncentive;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="النقاط النهائية" value={String(incentive.finalPoints)} icon={Award} color="teal" />
        <KPICard label="نقاط البداية" value={String(incentive.startingPoints)} icon={TrendingUp} color="blue" />
        <KPICard label="المكافآت" value={`+${incentive.approvedRewardPoints}`} icon={Award} color="green" />
        <KPICard label="الخصومات" value={`-${incentive.approvedDeductionPoints}`} icon={AlertTriangle} color="red" />
      </div>

      <section className="stat-card space-y-4">
        <h3 className="section-title text-sm">تفاصيل الحوافز</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard label="نقاط التميز فوق 500" value={String(incentive.distinctionPointsAbove500)} />
          <InfoCard label="قيمة الحافز النهائي" value={formatCurrency(incentive.incentiveValue)} />
        </div>
      </section>

      {incentive.pendingRewardPoints > 0 || incentive.pendingDeductionPoints > 0 ? (
        <section className="stat-card space-y-4 border border-amber-500/20">
          <h3 className="section-title text-sm">معاملات معلقة</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <InfoCard label="مكافآت معلقة" value={`+${incentive.pendingRewardPoints}`} />
            <InfoCard label="خصومات معلقة" value={`-${incentive.pendingDeductionPoints}`} />
          </div>
        </section>
      ) : null}

      {incentive.warnings.length > 0 && (
        <section className="stat-card space-y-4 border border-amber-500/20">
          <h3 className="section-title text-sm">تنبيهات الحوافز</h3>
          <ul className="space-y-1 text-xs leading-6 text-amber-100/90">
            {incentive.warnings.map((warning, idx) => (
              <li key={idx}>• {warning}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuarterlyTab({ profile }: { profile: StaffPerformanceProfile }) {
  if (!profile.quarterlyIncentive) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات ربع سنوية</div>;
  }

  const quarterly = profile.quarterlyIncentive;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="النتيجة الربع سنوية" value={`${quarterly.quarterlyScore}/100`} icon={Award} color="teal" />
        <KPICard label="القاعدة" value={formatCurrency(quarterly.baseQuarterlyIncentive)} icon={DollarSign} color="blue" />
        <KPICard label="مكافآت نقدية" value={formatCurrency(quarterly.quarterlyCashRewards)} icon={Award} color="green" />
        <KPICard label="خصومات نقدية" value={formatCurrency(quarterly.quarterlyCashDeductions)} icon={AlertTriangle} color="red" />
      </div>

      <section className="stat-card space-y-4">
        <h3 className="section-title text-sm">القيمة النهائية</h3>
        <div className="text-4xl font-bold text-teal-400 num">{formatCurrency(quarterly.quarterlyFinalValue)}</div>
      </section>

      <section className="stat-card space-y-4">
        <h3 className="section-title text-sm">تفصيل النتيجة</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard label="نمو المبيعات" value={`${quarterly.scoreBreakdown.salesGrowth}/25`} />
          <InfoCard label="متوسط الفاتورة" value={`${quarterly.scoreBreakdown.avgInvoice}/20`} />
          <InfoCard label="العملاء" value={`${quarterly.scoreBreakdown.customers}/20`} />
          <InfoCard label="أصناف اللستة" value={`${quarterly.scoreBreakdown.listItems}/15`} />
          <InfoCard label="الرواكد" value={`${quarterly.scoreBreakdown.stagnantInventory}/10`} />
          <InfoCard label="جودة التسجيل" value={`${quarterly.scoreBreakdown.registrationQuality}/10`} />
        </div>
      </section>

      {quarterly.weeklySalesTrend.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">تطور المبيعات الأسبوعي</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {quarterly.weeklySalesTrend.map((week, idx) => (
              <div key={idx} className="flex justify-between rounded-xl bg-white/5 p-3">
                <span className="text-slate-300">{week.week}</span>
                <span className="text-teal-300 num">{formatMoney(week.sales)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AttendanceTab({ profile }: { profile: StaffPerformanceProfile }) {
  if (!profile.attendance) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات حضور</div>;
  }

  const attendance = profile.attendance;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="أيام الحضور" value={String(attendance.attendedDays)} icon={Calendar} color="teal" />
        <KPICard label="الغياب" value={String(attendance.absences)} icon={AlertTriangle} color="red" />
        <KPICard label="التأخير" value={String(attendance.delays)} icon={AlertCircle} color="amber" />
        <KPICard label="الإذنات المستخدمة" value={String(attendance.permissionsUsed)} icon={Calendar} color="blue" />
      </div>

      <section className="stat-card space-y-4">
        <h3 className="section-title text-sm">تفاصيل الحضور</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard label="أيام مجدولة" value={String(attendance.scheduledDays)} />
          <InfoCard label="نسبة الالتزام" value={`${attendance.attendanceCompliance.toFixed(1)}%`} />
          <InfoCard label="تأخير > 20 دقيقة" value={String(attendance.delaysOver20Minutes)} />
          <InfoCard label="إذنات مجانية متبقية" value={String(attendance.freePermissionsRemaining)} />
        </div>
      </section>

      {attendance.permissionsUsage.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">سجل الإذنات</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {attendance.permissionsUsage.map((perm, idx) => (
              <div key={idx} className="flex justify-between rounded-xl bg-white/5 p-3">
                <span className="text-slate-300">{perm.date}</span>
                <span className="text-slate-400">{perm.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ServiceTab({ profile }: { profile: StaffPerformanceProfile }) {
  if (!profile.customerService) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد بيانات خدمة عملاء</div>;
  }

  const service = profile.customerService;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="متابعات مخصصة" value={String(service.followupsAssigned)} icon={Users} color="teal" />
        <KPICard label="متابعات مكتملة" value={String(service.followupsCompleted)} icon={Award} color="green" />
        <KPICard label="متابعات مفقودة" value={String(service.followupsMissed)} icon={AlertTriangle} color="red" />
        <KPICard label="شكاوى" value={String(service.complaintCount)} icon={AlertCircle} color="amber" />
      </div>

      <section className="stat-card space-y-4">
        <h3 className="section-title text-sm">جودة التصنيف</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard label="تصنيف عميل مفقود" value={String(service.missingCustomerClassification)} />
          <InfoCard label="تصنيف فاتورة مفقود" value={String(service.missingInvoiceClassification)} />
          <InfoCard label="كلاهما مفقود" value={String(service.bothClassificationsMissing)} />
          <InfoCard label="متوسط التقييم" value={`${service.conversationEvaluationAverage}/100`} />
        </div>
      </section>

      {service.followupsAssigned > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">معدل المتابعات</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <InfoCard label="مخصصة" value={String(service.followupsAssigned)} />
            <InfoCard label="مكتملة" value={String(service.followupsCompleted)} />
            <InfoCard label="مفقودة" value={String(service.followupsMissed)} />
          </div>
        </section>
      )}
    </div>
  );
}

function RecommendationsTab({ profile }: { profile: StaffPerformanceProfile }) {
  const recommendations = profile.recommendations;

  if (!recommendations || recommendations.length === 0) {
    return <div className="stat-card text-center py-8 text-slate-400">لا توجد توصيات</div>;
  }

  const highPriority = recommendations.filter((r) => r.priority === "high");
  const mediumPriority = recommendations.filter((r) => r.priority === "medium");
  const lowPriority = recommendations.filter((r) => r.priority === "low");

  return (
    <div className="space-y-6">
      {highPriority.length > 0 && (
        <section className="stat-card space-y-4 border border-red-500/20">
          <h3 className="section-title text-sm text-red-400">توصيات عالية الأولوية</h3>
          <div className="space-y-3">
            {highPriority.map((rec, idx) => (
              <RecommendationCard key={idx} recommendation={rec} />
            ))}
          </div>
        </section>
      )}

      {mediumPriority.length > 0 && (
        <section className="stat-card space-y-4 border border-amber-500/20">
          <h3 className="section-title text-sm text-amber-400">توصيات متوسطة الأولوية</h3>
          <div className="space-y-3">
            {mediumPriority.map((rec, idx) => (
              <RecommendationCard key={idx} recommendation={rec} />
            ))}
          </div>
        </section>
      )}

      {lowPriority.length > 0 && (
        <section className="stat-card space-y-4 border border-blue-500/20">
          <h3 className="section-title text-sm text-blue-400">توصيات منخفضة الأولوية</h3>
          <div className="space-y-3">
            {lowPriority.map((rec, idx) => (
              <RecommendationCard key={idx} recommendation={rec} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChartsTab({ profile }: { profile: StaffPerformanceProfile }) {
  return (
    <div className="space-y-6">
      <StaffPerformanceCharts profile={profile} />
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: any }) {
  const priorityColors = {
    high: "border-red-500/30 bg-red-500/10",
    medium: "border-amber-500/30 bg-amber-500/10",
    low: "border-blue-500/30 bg-blue-500/10",
  };

  return (
    <div className={`rounded-xl border p-4 ${priorityColors[recommendation.priority]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-bold text-white text-sm mb-1">{recommendation.category}</div>
          <div className="text-slate-300 text-xs mb-2">{recommendation.reason}</div>
          <div className="text-slate-200 text-xs">{recommendation.suggestedAction}</div>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${
          recommendation.priority === "high" ? "bg-red-500/20 text-red-300" :
          recommendation.priority === "medium" ? "bg-amber-500/20 text-amber-300" :
          "bg-blue-500/20 text-blue-300"
        }`}>
          {recommendation.priority}
        </span>
      </div>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: "teal" | "blue" | "amber" | "red" | "green" | "purple" }) {
  const colorClasses = {
    teal: "bg-teal-500/15 text-teal-400",
    blue: "bg-blue-500/15 text-blue-400",
    amber: "bg-amber-500/15 text-amber-400",
    red: "bg-red-500/15 text-red-400",
    green: "bg-green-500/15 text-green-400",
    purple: "bg-purple-500/15 text-purple-400",
  };

  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${colorClasses[color]} flex items-center justify-center`}>
          <Icon size={20} />
        </div>
        <div className="flex-1">
          <div className="text-slate-400 text-xs">{label}</div>
          <div className="text-white font-bold text-lg num">{value}</div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card py-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1 num">{value}</div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1 leading-relaxed num">{value}</div>
    </div>
  );
}
