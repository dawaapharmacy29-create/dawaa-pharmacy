const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/doctorCompetitionMetrics.ts');
let source = fs.readFileSync(file, 'utf8');

const replacements = [
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
];

let changed = false;
for (const [from, to] of replacements) {
  if (source.includes(to)) continue;
  if (!source.includes(from)) {
    throw new Error(`Expected doctor competition query not found: ${from.slice(0, 80)}...`);
  }
  source = source.replace(from, to);
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, source);
  console.log('Applied dashboard doctor competition payload optimization.');
} else {
  console.log('Dashboard doctor competition payload optimization already applied.');
}
