const fs = require('fs');
const path = require('path');
const page = fs.readFileSync(path.join(process.cwd(), 'src/pages/CustomerMonthlyPerformance.tsx'), 'utf8');
if (!page.includes("const [pageTab, setPageTab] = useState<'overview' | 'cohorts' | 'attention' | 'improving'>('overview');")) {
  require('./patch-customer-monthly-tabs.cjs');
} else {
  console.log('[customer-monthly-tabs] existing tabs detected; patch skipped');
}
require('./check-customer-monthly-tabs.cjs');
