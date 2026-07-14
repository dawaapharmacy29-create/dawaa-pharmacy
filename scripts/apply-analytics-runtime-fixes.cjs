const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Analytics.tsx');
let text = fs.readFileSync(file, 'utf8');

function replaceOnce(oldText, newText, label) {
  if (text.includes(newText)) {
    console.log(`[analytics-runtime] ${label}: already applied`);
    return;
  }
  if (!text.includes(oldText)) {
    console.log(`[analytics-runtime] ${label}: source changed, skipped`);
    return;
  }
  text = text.replace(oldText, newText);
  console.log(`[analytics-runtime] ${label}: applied`);
}

replaceOnce(
`    const normalizedRequestedBranch = normalizeBranchName(requestedBranch || '') || ALL_FILTER;
`,
`    const requestedBranchValue = normalizeBranchName(requestedBranch || '');
    const normalizedRequestedBranch =
      !requestedBranchValue || /غير\\s*محدد|unknown|undefined|null/i.test(requestedBranchValue)
        ? ALL_FILTER
        : requestedBranchValue;
`,
  'invalid branch URL fallback'
);

replaceOnce(
`  useEffect(() => {
    void loadV13();
  }, [loadV13]);
`,
`  // V13 views are optional diagnostics and can be expensive on large datasets.
  // Do not block or slow the main analytics page by loading them automatically.
`,
  'disable automatic V13 queries'
);

replaceOnce(
`      if (errors.length) setError(errors.join(' · '));
`,
`      if (errors.length) {
        const friendly = errors.map((message) =>
          /statement timeout|cancelling statement/i.test(message)
            ? message.replace(/cancelling statement due to statement timeout/gi, 'انتهت مهلة المصدر')
            : message
        );
        setError(friendly.join(' · '));
      }
`,
  'friendly V13 timeout errors'
);

replaceOnce(
`          <p className="text-sm font-bold text-emerald-700">
            الداشبورد، العملاء المهمين، متوسط الفرع اليومي، والتارجت من الـ Views الجديدة.
          </p>
`,
`          <p className="text-sm font-bold text-emerald-700">
            مؤشرات إضافية اختيارية. اضغط تحديث V13 لتحميلها دون التأثير على التحليلات الأساسية.
          </p>
`,
  'V13 optional description'
);

replaceOnce(
`        <MiniV13Card title="عملاء مشترين" value={cards?.total_customers_with_purchase} />
`,
`        <MiniV13Card title="عملاء مشترين" value={cards?.total_customers_with_purchase} loading={loading} />
`,
  'V13 loading state first card'
);

fs.writeFileSync(file, text, 'utf8');
console.log('[analytics-runtime] completed');
