const fs = require('node:fs');
const path = require('node:path');

const analyticsPath = path.join(process.cwd(), 'src/pages/Analytics.tsx');
const dashboardPath = path.join(process.cwd(), 'src/pages/ExecutiveDashboard2027.tsx');
let analytics = fs.readFileSync(analyticsPath, 'utf8');
let dashboard = fs.readFileSync(dashboardPath, 'utf8');

// 1) Analytics: tolerate real summary schemas by selecting all small summary rows
// and normalizing aliases in the browser.
analytics = analytics.replace(
  ".select('sale_date,branch,net_total,invoices_count,invoice_count,unique_customers,customers_count')",
  ".select('*')"
);
analytics = analytics.replace(
  ".select('sale_date,branch,seller_name,doctor_name,net_total,invoices_count,invoice_count,unique_customers,customers_count')",
  ".select('*')"
);
analytics = analytics.replace(
  "      if (doctor !== ALL) doctorsQuery = doctorsQuery.or(`seller_name.eq.${doctor},doctor_name.eq.${doctor}`);\n",
  ''
);
analytics = analytics.replace(
  "          date: String(read(row, ['sale_date']) || '').slice(0, 10),",
  "          date: String(read(row, ['sale_date', 'date', 'invoice_date']) || '').slice(0, 10),"
);
analytics = analytics.replace(
  "          netSales: number(read(row, ['net_total'])),",
  "          netSales: number(read(row, ['net_total', 'daily_sales', 'sales_total', 'total_sales'])),"
);
analytics = analytics.replaceAll(
  "number(read(row, ['invoices_count', 'invoice_count']))",
  "number(read(row, ['invoices_count', 'total_invoices']))"
);
analytics = analytics.replaceAll(
  "number(read(row, ['unique_customers', 'customers_count']))",
  "number(read(row, ['unique_customers', 'customers_count', 'linked_customers']))"
);
analytics = analytics.replace(
  "          const name = String(read(row, ['seller_name', 'doctor_name']) || '').trim();\n          if (!name) continue;",
  "          const name = String(read(row, ['seller_name', 'staff_name', 'doctor', 'name']) || '').trim();\n          if (!name || (doctor !== ALL && name !== doctor)) continue;"
);
analytics = analytics.replace(
  '<Panel title="تحديد تارجت الفروع يدويًا">',
  '<div id="branch-targets"><Panel title="تحديد تارجت الفروع يدويًا">'
);
analytics = analytics.replace(
  '      </Panel>\n    </section>\n  </div>;\n}',
  '      </Panel></div>\n    </section>\n  </div>;\n}'
);

// 2) Dashboard: use saved branch targets instead of hard-coded defaults.
if (!dashboard.includes('type SavedBranchTargetRow')) {
  dashboard = dashboard.replace(
    "type TargetRow = {",
    "type SavedBranchTargetRow = { branch_name?: string | null; branch?: string | null; target_amount?: number | string | null };\n\ntype TargetRow = {"
  );
}

dashboard = dashboard.replace(
  "function createTargets(\n  branches: BranchDistribution[],\n  daysCount: number,\n  startDate: string,\n  endDate: string\n): TargetRow[] {",
  "function createTargets(\n  branches: BranchDistribution[],\n  daysCount: number,\n  startDate: string,\n  endDate: string,\n  savedTargets: SavedBranchTargetRow[] = []\n): TargetRow[] {"
);

dashboard = dashboard.replace(
  "    const target = targetDefaults[branch] || Math.max(n(row.sales_total) * 1.25, 1);",
  "    const savedTarget = savedTargets.find((item) => branchName(item.branch_name || item.branch) === branch);\n    const target = n(savedTarget?.target_amount) || targetDefaults[branch] || Math.max(n(row.sales_total) * 1.25, 1);"
);

const oldTargetCall = "        const targets = createTargets(effectiveBranchDistribution, daysCount, startDate, endDate);";
if (dashboard.includes(oldTargetCall)) {
  dashboard = dashboard.replace(
    oldTargetCall,
    `        let savedTargetRows: SavedBranchTargetRow[] = [];
        try {
          const targetResult = await withTimeout<SupabaseQueryResult<SavedBranchTargetRow[]>>(
            supabase.from('branch_sales_targets').select('*').limit(100) as PromiseLike<SupabaseQueryResult<SavedBranchTargetRow[]>>,
            5000,
            'branch-sales-targets'
          );
          if (!targetResult.error) savedTargetRows = targetResult.data || [];
          else errors.push('branch_sales_targets: ' + (targetResult.error.message || 'تعذر تحميل التارجت'));
        } catch (targetError) {
          errors.push('branch_sales_targets: ' + (targetError instanceof Error ? targetError.message : String(targetError)));
        }
        const targets = createTargets(effectiveBranchDistribution, daysCount, startDate, endDate, savedTargetRows);`
  );
}

if (!dashboard.includes("navigate('/analytics#branch-targets')")) {
  const cycleButton = `              <button
                onClick={() => {
                  setStartDate(formatCycleDate(currentCycle.start));
                  setEndDate(formatCycleDate(currentCycle.end));
                }}`;
  const targetButton = `              <button
                type="button"
                onClick={() => navigate('/analytics#branch-targets')}
                className="rounded-2xl border border-emerald-300/30 bg-emerald-500/15 px-4 py-3 text-sm font-black text-emerald-100 hover:bg-emerald-500/25"
              >
                تعديل تارجت الفروع
              </button>
`;
  if (dashboard.includes(cycleButton)) dashboard = dashboard.replace(cycleButton, targetButton + cycleButton);
}

fs.writeFileSync(analyticsPath, analytics, 'utf8');
fs.writeFileSync(dashboardPath, dashboard, 'utf8');

analytics = fs.readFileSync(analyticsPath, 'utf8');
dashboard = fs.readFileSync(dashboardPath, 'utf8');
if (!analytics.includes(".from('sales_daily_summary')") || !analytics.includes(".select('*')")) throw new Error('[analytics-schema] summary select fix missing');
if (analytics.includes('sales_daily_summary.invoice_count') || analytics.includes("doctor_name.eq.")) throw new Error('[analytics-schema] stale column dependency remains');
if (!dashboard.includes("supabase.from('branch_sales_targets').select('*')")) throw new Error('[dashboard-targets] saved target fetch missing');
if (!dashboard.includes("navigate('/analytics#branch-targets')")) throw new Error('[dashboard-targets] edit target action missing');
console.log('Analytics schema compatibility and dashboard branch targets verified.');
