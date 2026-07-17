const fs = require('node:fs');

const filePath = 'src/pages/ExecutiveDashboard2027.tsx';
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) {
    console.warn(`Dashboard period patch skipped missing marker: ${label}`);
    return;
  }
  source = source.replace(search, replacement);
}

replaceOnce(
`function followupIsOverdue(row: FollowupDashboardRow) {
  if (followupIsDone(row)) return false;
  const raw = row.followup_date || row.date || row.created_at || '';
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && time < Date.now();
}`,
`function followupIsOverdue(row: FollowupDashboardRow) {
  if (followupIsDone(row)) return false;
  const raw = row.followup_date || row.date || '';
  const day = String(raw).slice(0, 10);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) return false;
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  return day < todayKey;
}`,
'followup overdue rule'
);

replaceOnce(
`        if (!customerServiceRows.length || !customerServiceOwners.length) {
          customerServiceFollowups = await fetchFollowupsForDashboard(startDate, endDate, scopedBranch || ALL_BRANCHES, errors);
        }`,
`        customerServiceFollowups = await fetchFollowupsForDashboard(
          startDate,
          endDate,
          scopedBranch || ALL_BRANCHES,
          errors
        );`,
'period followups fetch'
);

replaceOnce(
`      const effectiveCustomerServiceRows = customerServiceRows.length ? customerServiceRows : fallbackSummary ? [fallbackSummary] : [];
      const effectiveCustomerServiceOwners = customerServiceOwners.length ? customerServiceOwners : fallbackOwners;`,
`      const effectiveCustomerServiceRows = fallbackSummary ? [fallbackSummary] : customerServiceRows;
      const effectiveCustomerServiceOwners = fallbackOwners.length ? fallbackOwners : customerServiceOwners;`,
'period data precedence'
);

replaceOnce(
`              subtitle="المتابعات المفتوحة والنتائج اليومية حسب المسؤولة والفرع"`,
`              subtitle="المتابعات داخل الفترة المختارة حسب المسؤولة والفرع"`,
'customer service period subtitle'
);

replaceOnce(
`              <MiniBox label="المكتملة اليوم" value={count(service.completed_today)} tone="green" />`,
`              <MiniBox label="المكتملة خلال الفترة" value={count(service.completed_today)} tone="green" />`,
'completed period label'
);

replaceOnce(
`              <MiniBox label="متأخر" value={count(service.overdue_followups)} tone="red" />`,
`              <MiniBox label="متأخر قبل اليوم" value={count(service.overdue_followups)} tone="red" />`,
'overdue label'
);

fs.writeFileSync(filePath, source);
console.log('Dashboard customer service period fix applied.');
