const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/CustomerMonthlyPerformance.tsx');
let src = fs.readFileSync(file, 'utf8');

function replaceOnce(find, replace, label) {
  if (!src.includes(find)) {
    console.log(`[customer-monthly-tabs] ${label}: already applied or anchor changed`);
    return;
  }
  src = src.replace(find, replace);
  console.log(`[customer-monthly-tabs] ${label}: applied`);
}

replaceOnce(
  "  const [exporting, setExporting] = useState(false);",
  "  const [exporting, setExporting] = useState(false);\n  const [pageTab, setPageTab] = useState<'overview' | 'cohorts' | 'attention' | 'improving'>('overview');",
  'tab state'
);

replaceOnce(
  "  const openCohort = (cohort: CohortKey) => {\n    setActiveCohort(cohort);",
  "  const openCohort = (cohort: CohortKey) => {\n    setPageTab('cohorts');\n    setActiveCohort(cohort);",
  'cohort switches tab'
);

replaceOnce(
  "      {summary && !loading && (\n        <>",
  `      {summary && !loading && (\n        <>\n          <Panel className=\"p-2 md:p-3\">\n            <div className=\"grid grid-cols-2 gap-2 md:grid-cols-4\">\n              {[\n                ['overview', 'نظرة عامة'],\n                ['cohorts', 'فئات العملاء'],\n                ['attention', 'يحتاجون متابعة'],\n                ['improving', 'المتحسنون'],\n              ].map(([key, label]) => (\n                <button\n                  key={key}\n                  type=\"button\"\n                  onClick={() => setPageTab(key as 'overview' | 'cohorts' | 'attention' | 'improving')}\n                  className=\"rounded-xl border px-3 py-2.5 text-sm font-black transition\"\n                  style={\n                    pageTab === key\n                      ? {\n                          borderColor: 'var(--dawaa-theme-accent-border)',\n                          background: 'var(--dawaa-theme-primary)',\n                          color: 'var(--dawaa-theme-primary-text)',\n                        }\n                      : {\n                          borderColor: 'var(--dawaa-theme-border)',\n                          background: 'var(--dawaa-theme-surface)',\n                          color: 'var(--dawaa-theme-muted)',\n                        }\n                  }\n                >\n                  {label}\n                </button>\n              ))}\n            </div>\n          </Panel>`,
  'top tabs'
);

const overviewStart = `          <section className=\"grid gap-3 sm:grid-cols-2 lg:grid-cols-4\">`;
const overviewEnd = `          <div className=\"flex flex-wrap gap-2\">\n            <button type=\"button\" onClick={() => openCohort('decline')} className=\"btn-secondary text-xs\">\n              قللوا مشترياتهم ({cohortCounts?.decline || 0})\n            </button>\n            <button type=\"button\" onClick={() => openCohort('risk')} className=\"btn-secondary text-xs\">\n              كل العملاء المهددين ({cohortCounts?.risk || 0})\n            </button>\n          </div>`;
if (src.includes(overviewStart) && src.includes(overviewEnd)) {
  src = src.replace(overviewStart, `          {pageTab === 'overview' && (<>\n${overviewStart}`);
  src = src.replace(overviewEnd, `${overviewEnd}\n          </>)}`);
  console.log('[customer-monthly-tabs] overview wrapping: applied');
} else {
  console.log('[customer-monthly-tabs] overview wrapping: anchor changed');
}

replaceOnce(
  "          {activeCohort && (\n            <Panel id=\"customer-cohort-details\"",
  "          {pageTab === 'cohorts' && activeCohort && (\n            <Panel id=\"customer-cohort-details\"",
  'cohort tab visibility'
);

replaceOnce(
  "          {activeCohort && (",
  "          {pageTab === 'cohorts' && !activeCohort && (\n            <Panel className=\"p-5\">\n              <SectionTitle title=\"اختاري فئة العملاء\" subtitle=\"افتحي أي فئة لمراجعة العملاء ومبيعاتهم وخطة المتابعة بدون إطالة الصفحة.\" icon={<Users size={18} />} />\n              <div className=\"mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3\">\n                {[\n                  ['new', 'العملاء الجدد', cohortCounts?.new || 0],\n                  ['reactivated', 'العملاء المستعادين', cohortCounts?.reactivated || 0],\n                  ['lost', 'العملاء المختفين', cohortCounts?.lost || 0],\n                  ['strongDecline', 'تراجعوا بقوة', cohortCounts?.strongDecline || 0],\n                  ['decline', 'قللوا مشترياتهم', cohortCounts?.decline || 0],\n                  ['risk', 'العملاء المهددون', cohortCounts?.risk || 0],\n                ].map(([key, label, count]) => (\n                  <button\n                    key={String(key)}\n                    type=\"button\"\n                    onClick={() => openCohort(key as CohortKey)}\n                    className=\"rounded-2xl border p-4 text-right transition hover:-translate-y-0.5\"\n                    style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}\n                  >\n                    <div className=\"text-sm font-black\" style={{ color: 'var(--dawaa-theme-heading)' }}>{label}</div>\n                    <div className=\"mt-2 text-2xl font-black\" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{count}</div>\n                  </button>\n                ))}\n              </div>\n            </Panel>\n          )}\n\n          {pageTab === 'cohorts' && activeCohort && (",
  'cohort chooser'
);

const legacyTabBlockStart = `          <div\n            className=\"flex w-fit overflow-hidden rounded-xl border\"`;
const legacyTabBlockEnd = `          </div>\n\n          {listTab === 'declining' && (`;
if (src.includes(legacyTabBlockStart) && src.includes(legacyTabBlockEnd)) {
  const start = src.indexOf(legacyTabBlockStart);
  const end = src.indexOf(legacyTabBlockEnd, start);
  src = src.slice(0, start) + `          {pageTab === 'attention' && (\n` + src.slice(end + `          </div>\n\n`.length);
  console.log('[customer-monthly-tabs] removed old inner tabs and opened attention tab: applied');
} else {
  console.log('[customer-monthly-tabs] old inner tabs anchor changed');
}

replaceOnce(
  "          {listTab === 'declining' && (",
  "          {pageTab === 'attention' && (",
  'attention visibility'
);
replaceOnce(
  "          {listTab === 'improving' && (",
  "          {pageTab === 'improving' && (",
  'improving visibility'
);

// Remove now-unused local listTab state if present.
replaceOnce(
  "  const [listTab, setListTab] = useState<'declining' | 'improving'>('declining');\n",
  '',
  'remove legacy list state'
);

fs.writeFileSync(file, src);
console.log('[customer-monthly-tabs] patch complete');
