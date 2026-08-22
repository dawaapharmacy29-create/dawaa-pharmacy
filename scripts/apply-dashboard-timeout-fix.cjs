const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function replaceAllOrThrow(file, replacements, label) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const [from, to] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`Expected ${label} pattern not found: ${from.slice(0, 100)}...`);
    }
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, source);
  console.log(changed ? `Applied ${label}.` : `${label} already applied.`);
}

replaceAllOrThrow(
  path.join(root, 'src/lib/doctorCompetitionMetrics.ts'),
  [
    [
      "safeSelect('conversation_sales_reviews', (query) => query.select('*').gte('conversation_date', range.start).lte('conversation_date', `${range.end}T23:59:59`).limit(5000))",
      "safeSelect('conversation_sales_reviews', (query) => query.select('staff_id,doctor_id,staff_name,doctor_name,branch,final_score,conversation_date').gte('conversation_date', range.start).lte('conversation_date', `${range.end}T23:59:59`).limit(2000))",
    ],
    [
      "safeSelect('daily_followups', (query) => query.select('*').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(5000))",
      "safeSelect('daily_followups', (query) => query.select('staff_id,assigned_staff_id,responsible_name,assigned_doctor,assigned_to,created_by_name,branch,status,followup_status,followup_result,contact_result,completed_at,closed_at,cancelled_at,archived_at,hidden_at,is_hidden,purchase_after_followup,purchase_amount,customer_satisfaction,created_at').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(3000))",
    ],
    [
      "safeSelect('stagnant_medicine_dispenses', (query) => query.select('*').limit(5000))",
      "safeSelect('stagnant_medicine_dispenses', (query) => query.select('doctor_id,doctor_name,branch:branch_name,quantity,total_incentive,dispensed_at').gte('dispensed_at', range.start).lte('dispensed_at', `${range.end}T23:59:59`).limit(1000))",
    ],
    [
      "safeSelect('incentive_medicine_sales', (query) => query.select('*').limit(5000))",
      "safeSelect('incentive_medicine_sales', (query) => query.select('doctor_id,doctor_name,branch,quantity,total_incentive:incentive_total,sale_date').gte('sale_date', range.start).lte('sale_date', range.end).limit(1000))",
    ],
  ],
  'doctor competition payload optimization'
);

replaceAllOrThrow(
  path.join(root, 'src/lib/dashboard/dashboardTruthService.ts'),
  [[
    "  if (Number.isNaN(anchor.getTime())) return [];\n  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {",
    "  if (Number.isNaN(anchor.getTime())) return [];\n  // Fast path: one server request loops over indexed month ranges. It avoids five\n  // independent network calls while preserving the old implementation below as a fallback.\n  try {\n    const fastRows = await rpcRows<RpcRow>('get_dashboard_monthly_sales_v2', {\n      p_end: endDate,\n      p_branch: branch,\n      p_months: Math.max(1, months),\n    });\n    if (fastRows.length) return fastRows;\n  } catch {\n    // Backward-compatible fallback for deployments where the new RPC is not available yet.\n  }\n  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {"
  ]],
  'historical monthly sales fast path'
);
