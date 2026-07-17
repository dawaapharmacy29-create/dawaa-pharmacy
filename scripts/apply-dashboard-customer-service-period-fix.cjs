const fs = require('node:fs');

const filePath = 'src/pages/ExecutiveDashboard2027.tsx';
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) throw new Error(`Could not find ${label}`);
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
`              subtitle={\`نطاق التقرير: ${safeDate(startDate)} إلى ${safeDate(endDate)} — نفس الفترة مطبقة على الإجمالي والفروع والمسؤولات\`}`,
'customer service period subtitle'
);

replaceOnce(
`            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <MiniBox
                label="مفتوح الآن"
                value={count(service.open_followups)}
                tone="cyan"
              />
              <MiniBox label="متأخر" value={count(service.overdue_followups)} tone="red" />
              <MiniBox label="المكتملة اليوم" value={count(service.completed_today)} tone="green" />`,
`            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniBox
                label="إجمالي المتابعات خلال الفترة"
                value={count(n(service.open_followups) + n(service.completed_today))}
                tone="blue"
              />
              <MiniBox
                label="مفتوح حتى الآن"
                value={count(service.open_followups)}
                tone="cyan"
              />
              <MiniBox label="متأخر فعليًا قبل اليوم" value={count(service.overdue_followups)} tone="red" />
              <MiniBox label="مكتمل خلال الفترة" value={count(service.completed_today)} tone="green" />`,
'customer service headline metrics'
);

replaceOnce(
`                        <MiniBox label="مفتوح" value={count(Math.max(0, assigned - completed))} tone="cyan" />
                        <MiniBox label="متأخر" value={count(overdue)} tone="red" />
                        <MiniBox label="مكتمل" value={count(completed)} tone="green" />`,
`                        <MiniBox label="مفتوح" value={count(Math.max(0, assigned - completed))} tone="cyan" />
                        <MiniBox label="متأخر قبل اليوم" value={count(overdue)} tone="red" />
                        <MiniBox label="مكتمل في الفترة" value={count(completed)} tone="green" />`,
'branch metric labels'
);

replaceOnce(
`                              {count(owner.completed_today)} مكتمل`,
`                              {count(owner.completed_today)} مكتمل بالفترة`,
'owner completed label'
);

replaceOnce(
`      name: 'مكتملة اليوم', value: Math.max(n(service.completed_today), 1), fill: '#22c55e'`,
`      name: 'مكتملة خلال الفترة', value: Math.max(n(service.completed_today), 1), fill: '#22c55e'`,
'funnel completed label'
);

fs.writeFileSync(filePath, source);
console.log('Dashboard customer service period fix applied.');
