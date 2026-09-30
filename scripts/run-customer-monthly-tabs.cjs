const fs = require('fs');
const path = require('path');

const pagePath = path.join(process.cwd(), 'src/pages/CustomerMonthlyPerformance.tsx');
const page = fs.readFileSync(pagePath, 'utf8');
const tabStateMarker =
  "const [pageTab, setPageTab] = useState<'overview' | 'cohorts' | 'attention' | 'improving'>('overview');";

if (!page.includes(tabStateMarker)) {
  require('./patch-customer-monthly-tabs.cjs');
} else {
  console.log('[customer-monthly-tabs] existing tabs detected; patch skipped');
}

require('./check-customer-monthly-tabs.cjs');
