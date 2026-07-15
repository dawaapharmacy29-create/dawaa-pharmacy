const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorDashboard.tsx');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Doctor branch target patch failed: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`    branchAvg: number;
    salesRank: number | null;`,
`    branchAvg: number;
    branchTarget: number;
    branchAchievementPercent: number;
    branchRemaining: number;
    branchProjectedSales: number;
    branchProjectedAchievementPercent: number;
    elapsedCycleDays: number;
    totalCycleDays: number;
    salesRank: number | null;`,
'branch target state fields'
);

replaceOnce(
`        const branchSales = branchDoctors.reduce((sum, row) => sum + row.netSales, 0);
        const branchInvoices = branchDoctors.reduce((sum, row) => sum + row.invoicesCount, 0);
        const branchAvg = branchInvoices ? branchSales / branchInvoices : 0;
        setSalesSummary({`,
`        const branchSales = branchDoctors.reduce((sum, row) => sum + row.netSales, 0);
        const branchInvoices = branchDoctors.reduce((sum, row) => sum + row.invoicesCount, 0);
        const branchAvg = branchInvoices ? branchSales / branchInvoices : 0;
        const normalizedBranch = String(effectiveBranch || '').replace(/\s+/g, ' ').trim();
        const branchTarget = normalizedBranch.includes('شكري') ? 1500000 : normalizedBranch.includes('الشامي') ? 1000000 : Math.max(branchSales * 1.25, 1);
        const cycleStart = new Date(\`${formatCycleDate(cycle.start)}T12:00:00\`);
        const cycleEnd = new Date(\`${formatCycleDate(cycle.end)}T12:00:00\`);
        const lastDataDate = lastSalesDate ? new Date(\`${lastSalesDate}T12:00:00\`) : cycleStart;
        const dayMs = 24 * 60 * 60 * 1000;
        const totalCycleDays = Math.max(1, Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / dayMs) + 1);
        const elapsedCycleDays = Math.max(1, Math.min(totalCycleDays, Math.floor((lastDataDate.getTime() - cycleStart.getTime()) / dayMs) + 1));
        const branchProjectedSales = branchSales > 0 ? (branchSales / elapsedCycleDays) * totalCycleDays : 0;
        const branchAchievementPercent = branchTarget > 0 ? (branchSales / branchTarget) * 100 : 0;
        const branchProjectedAchievementPercent = branchTarget > 0 ? (branchProjectedSales / branchTarget) * 100 : 0;
        const branchRemaining = Math.max(0, branchTarget - branchSales);
        setSalesSummary({`,
'branch target calculations'
);

replaceOnce(
`          branchSales,
          branchInvoices,
          branchAvg,
          salesRank: rankOf(salesSorted),`,
`          branchSales,
          branchInvoices,
          branchAvg,
          branchTarget,
          branchAchievementPercent,
          branchRemaining,
          branchProjectedSales,
          branchProjectedAchievementPercent,
          elapsedCycleDays,
          totalCycleDays,
          salesRank: rankOf(salesSorted),`,
'branch target state assignment'
);

replaceOnce(
`      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">`,
`      <section className="rounded-3xl border border-sky-400/20 bg-gradient-to-l from-sky-500/10 via-slate-900/80 to-teal-500/10 p-5">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-black text-sky-200">لوحة تقدم الفرع</div>
            <h2 className="mt-1 text-xl font-black text-white">تارجت ومبيعات {effectiveBranch || 'الفرع'}</h2>
            <p className="mt-1 text-sm text-slate-300">الدورة الحالية {cycle.label} — الحساب حتى آخر يوم مبيعات مرفوع</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm font-bold text-slate-200">
            {salesSummary?.lastSalesDate ? \`آخر تحديث: \${new Date(\`${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG')}\` : 'لا توجد بيانات مبيعات مرفوعة'}
          </div>
        </div>
        <StateLine status={salesStatus} error={salesError} empty="لا توجد بيانات مبيعات للفرع في الدورة الحالية." />
        {salesSummary && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard icon={BarChart3} label="مبيعات الفرع" value={formatCurrency(salesSummary.branchSales)} status="success" sub={\`حتى اليوم \${salesSummary.elapsedCycleDays} من \${salesSummary.totalCycleDays}\`} />
              <MetricCard icon={Target} label="تارجت الفرع" value={formatCurrency(salesSummary.branchTarget)} status="success" sub="هدف الدورة الحالية" />
              <MetricCard icon={Award} label="نسبة تحقيق التارجت" value={\`\${salesSummary.branchAchievementPercent.toFixed(1)}%\`} status="success" sub={salesSummary.branchAchievementPercent >= 100 ? 'تم تحقيق التارجت' : 'نسبة الإنجاز الحالية'} />
              <MetricCard icon={TrendingUp} label="المتبقي لتحقيق التارجت" value={formatCurrency(salesSummary.branchRemaining)} status="success" sub={salesSummary.branchRemaining <= 0 ? 'تم تجاوز الهدف' : 'المبلغ المطلوب حتى نهاية الدورة'} />
              <MetricCard icon={DollarSign} label="التوقع بنهاية الدورة" value={formatCurrency(salesSummary.branchProjectedSales)} status="success" sub={\`تحقيق متوقع \${salesSummary.branchProjectedAchievementPercent.toFixed(1)}%\`} />
            </div>
            <div className="mt-4 overflow-hidden rounded-full bg-slate-800">
              <div className="h-3 rounded-full bg-gradient-to-l from-teal-400 to-sky-500 transition-all" style={{ width: \`${Math.min(100, Math.max(0, salesSummary.branchAchievementPercent))}%\` }} />
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm font-bold text-slate-200">
              {salesSummary.branchProjectedAchievementPercent >= 100
                ? \`لو استمر الفرع بنفس معدل البيع الحالي، فالتوقع الوصول إلى \${formatCurrency(salesSummary.branchProjectedSales)} بنهاية الدورة، أي نحو \${salesSummary.branchProjectedAchievementPercent.toFixed(1)}% من التارجت.\`
                : \`لو استمر الفرع بنفس المعدل الحالي، فالتوقع الوصول إلى \${formatCurrency(salesSummary.branchProjectedSales)}. نحتاج تحسين المعدل لتحقيق المتبقي \${formatCurrency(salesSummary.branchRemaining)}.\`}
            </div>
          </>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">`,
'branch target progress section'
);

fs.writeFileSync(filePath, source);
console.log('[doctor-branch-target-progress] applied');
