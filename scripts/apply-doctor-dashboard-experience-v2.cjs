const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorDashboard.tsx');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Doctor dashboard experience patch failed: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`  const [salesSummary, setSalesSummary] = useState<{
    cycleSales: number;
    invoices: number;
    avgInvoice: number;
    branchAvg: number;
    lastSalesDate: string | null;
  } | null>(null);`,
`  const [salesSummary, setSalesSummary] = useState<{
    cycleSales: number;
    invoices: number;
    avgInvoice: number;
    branchSales: number;
    branchInvoices: number;
    branchAvg: number;
    salesRank: number | null;
    invoiceRank: number | null;
    avgRank: number | null;
    doctorsCount: number;
    lastSalesDate: string | null;
    leaderboard: Array<{
      staffId: string | null;
      doctor: string;
      netSales: number;
      invoicesCount: number;
      avgInvoice: number;
    }>;
  } | null>(null);`,
'sales summary state'
);

replaceOnce(
`        const branchAvg = summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
        setSalesSummary({
          cycleSales: doctorRow.netSales,
          invoices: doctorRow.invoicesCount,
          avgInvoice: doctorRow.avgInvoice,
          branchAvg,
          lastSalesDate,
        });`,
`        const branchDoctors = summary.doctorRows
          .filter((row) => !effectiveBranch || row.branch === effectiveBranch)
          .sort((a, b) => b.netSales - a.netSales);
        const salesSorted = [...branchDoctors].sort((a, b) => b.netSales - a.netSales);
        const invoicesSorted = [...branchDoctors].sort((a, b) => b.invoicesCount - a.invoicesCount);
        const avgSorted = [...branchDoctors].sort((a, b) => b.avgInvoice - a.avgInvoice);
        const isCurrent = (row: (typeof branchDoctors)[number]) =>
          (row.staffId && row.staffId === effectiveId) ||
          normalizeDoctorSalesName(row.doctor) === effectiveNameKey;
        const rankOf = (rows: typeof branchDoctors) => {
          const index = rows.findIndex(isCurrent);
          return index >= 0 ? index + 1 : null;
        };
        const branchSales = branchDoctors.reduce((sum, row) => sum + row.netSales, 0);
        const branchInvoices = branchDoctors.reduce((sum, row) => sum + row.invoicesCount, 0);
        const branchAvg = branchInvoices ? branchSales / branchInvoices : 0;
        setSalesSummary({
          cycleSales: doctorRow.netSales,
          invoices: doctorRow.invoicesCount,
          avgInvoice: doctorRow.avgInvoice,
          branchSales,
          branchInvoices,
          branchAvg,
          salesRank: rankOf(salesSorted),
          invoiceRank: rankOf(invoicesSorted),
          avgRank: rankOf(avgSorted),
          doctorsCount: branchDoctors.length,
          lastSalesDate,
          leaderboard: salesSorted.slice(0, 10),
        });`,
'branch sales and rankings'
);

replaceOnce(
`        <MetricCard icon={DollarSign} label="مبيعاتي في الدورة الحالية" value={salesSummary ? formatCurrency(salesSummary.cycleSales) : '—'} status={salesStatus} sub={salesSummary?.lastSalesDate ? \`حتى آخر رفع: \${new Date(\`\${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG')}\` : 'لا توجد مبيعات مرفوعة للدكتور'} />
        <MetricCard icon={FileText} label="عدد فواتيري" value={salesSummary ? salesSummary.invoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub="من بداية الدورة حتى آخر رفع" />
        <MetricCard icon={TrendingUp} label="متوسط فاتورتي" value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'} status={salesStatus} sub={salesSummary?.branchAvg ? \`متوسط الفرع \${formatCurrency(salesSummary.branchAvg)}\` : 'مقارنة الفرع عند توفرها'} />
        <MetricCard icon={Calendar} label="آخر يوم مبيعات مرفوع" value={salesSummary?.lastSalesDate ? new Date(\`\${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG') : '—'} status={salesStatus} sub="لا يعتمد على رفع يومي" />`,
`        <MetricCard icon={DollarSign} label="مبيعاتي في الدورة الحالية" value={salesSummary ? formatCurrency(salesSummary.cycleSales) : '—'} status={salesStatus} sub={salesSummary?.lastSalesDate ? \`حتى آخر رفع: \${new Date(\`\${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG')}\` : 'لا توجد مبيعات مرفوعة للدكتور'} />
        <MetricCard icon={BarChart3} label="مبيعات الفرع" value={salesSummary ? formatCurrency(salesSummary.branchSales) : '—'} status={salesStatus} sub={effectiveBranch || 'الفرع الحالي'} />
        <MetricCard icon={FileText} label="عدد فواتيري" value={salesSummary ? salesSummary.invoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub={salesSummary ? \`ترتيبي \${salesSummary.invoiceRank || '—'} من \${salesSummary.doctorsCount}\` : 'من بداية الدورة'} />
        <MetricCard icon={TrendingUp} label="متوسط فاتورتي" value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'} status={salesStatus} sub={salesSummary?.branchAvg ? \`متوسط الفرع \${formatCurrency(salesSummary.branchAvg)} · ترتيبي \${salesSummary.avgRank || '—'}\` : 'مقارنة الفرع عند توفرها'} />
        <MetricCard icon={Award} label="ترتيبي في مبيعات الفرع" value={salesSummary?.salesRank ? \`رقم \${salesSummary.salesRank}\` : '—'} status={salesStatus} sub={salesSummary ? \`من \${salesSummary.doctorsCount} دكتور\` : 'حسب مبيعات الدورة'} />
        <MetricCard icon={FileText} label="فواتير الفرع" value={salesSummary ? salesSummary.branchInvoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub="إجمالي الدورة حتى آخر رفع" />
        <MetricCard icon={Calendar} label="آخر يوم مبيعات مرفوع" value={salesSummary?.lastSalesDate ? new Date(\`\${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG') : '—'} status={salesStatus} sub="لا يعتمد على رفع يومي" />
        <MetricCard icon={Target} label="الفرق عن متوسط الفرع" value={salesSummary ? formatCurrency(salesSummary.avgInvoice - salesSummary.branchAvg) : '—'} status={salesStatus} sub={salesSummary && salesSummary.avgInvoice >= salesSummary.branchAvg ? 'أعلى من متوسط الفرع' : 'فرصة لتحسين الترشيح المناسب'} />`,
'expanded sales cards'
);

replaceOnce(
`      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">`,
`      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <SectionCard icon={Award} title="ترتيب دكاترة الفرع" subtitle="مبيعات وعدد فواتير ومتوسط فاتورة — بيانات الفرع فقط">
          <StateLine status={salesStatus} error={salesError} empty="لا توجد بيانات مبيعات مرتبطة بالدكاترة في الدورة الحالية." />
          {!!salesSummary?.leaderboard.length && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="p-2 text-right">#</th><th className="p-2 text-right">الدكتور</th><th className="p-2 text-right">المبيعات</th><th className="p-2 text-right">الفواتير</th><th className="p-2 text-right">المتوسط</th>
                  </tr>
                </thead>
                <tbody>
                  {salesSummary.leaderboard.map((row, index) => {
                    const mine = (row.staffId && row.staffId === effectiveId) || normalizeDoctorSalesName(row.doctor) === normalizeDoctorSalesName(effectiveName);
                    return (
                      <tr key={row.staffId || row.doctor} className={mine ? 'border-b border-teal-400/30 bg-teal-500/10 font-black text-teal-100' : 'border-b border-white/5 text-slate-200'}>
                        <td className="p-2">{index + 1}</td><td className="p-2">{row.doctor}{mine ? ' — أنت' : ''}</td><td className="p-2">{formatCurrency(row.netSales)}</td><td className="p-2">{row.invoicesCount.toLocaleString('ar-EG')}</td><td className="p-2">{formatCurrency(row.avgInvoice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard icon={GraduationCap} title="خطة تطويري الشخصية" subtitle="الخدمة والبيع المهني بدون ضغط على العميل">
          <div className="space-y-2 text-sm font-bold text-slate-200">
            <InfoRow label="داخل الصيدلية" value="ترحيب، فهم الاحتياج، شرح واضح، بديل مناسب، تأكيد الرضا" />
            <InfoRow label="واتساب" value="رد سريع، استخدام اسم العميل، تأكيد الطلب، شرح الاستخدام، إغلاق ودود" />
            <InfoRow label="المكالمة" value="استماع دون مقاطعة، تلخيص الطلب، معلومات مؤكدة، تأكيد العنوان والطلب" />
            <InfoRow label="Cross-sell" value="منتج مكمل مناسب طبيًا بعد سؤال العميل — بدون ضغط" />
            <InfoRow label="Up-sell" value="عرض الأفضل مع توضيح فرق الفائدة والسعر وترك القرار للعميل" />
          </div>
          <a className="btn-secondary mt-3 block text-center" href="/training">فتح التدريب والسياسات</a>
        </SectionCard>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <a href="/customer-service?myFollowups=1" className="rounded-2xl border border-teal-400/20 bg-teal-500/10 p-4 transition hover:-translate-y-0.5"><HeartHandshake className="mb-3 text-teal-300" /><div className="font-black text-white">متابعاتي الاستثنائية</div><div className="mt-1 text-xs text-slate-300">العملاء الذين طلبت متابعتهم والنتائج والملاحظات</div></a>
        <a href="/customer-requests?createdByMe=1" className="rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4 transition hover:-translate-y-0.5"><ClipboardList className="mb-3 text-sky-300" /><div className="font-black text-white">طلبات العملاء التي سجلتها</div><div className="mt-1 text-xs text-slate-300">المفتوح والمنفذ والمتأخر وسبب الإلغاء</div></a>
        <a href="/reviews?staffId=${'${effectiveId}'}" className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 transition hover:-translate-y-0.5"><Star className="mb-3 text-violet-300" /><div className="font-black text-white">تقييمات محادثاتي</div><div className="mt-1 text-xs text-slate-300">الترحيب والسرعة والفهم والترشيح والملاحظات</div></a>
        <a href="/stagnant-medicines" className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 transition hover:-translate-y-0.5"><Package className="mb-3 text-amber-300" /><div className="font-black text-white">الرواكد واللستة</div><div className="mt-1 text-xs text-slate-300">أصناف الفرع والترشيحات المناسبة والحوافز</div></a>
        <a href="/incentives" className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 transition hover:-translate-y-0.5"><Wallet className="mb-3 text-emerald-300" /><div className="font-black text-white">سجل نقاطي وحوافزي</div><div className="mt-1 text-xs text-slate-300">الإضافات والخصومات والمعلق وسبب كل حركة</div></a>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">`,
'personal modules and leaderboard'
);

fs.writeFileSync(filePath, source);
console.log('[doctor-dashboard-experience-v2] applied');
