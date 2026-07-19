const fs = require('node:fs');

const filePath = 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx';
let source = fs.readFileSync(filePath, 'utf8');

if (source.includes("CustomerServiceExecutionDashboard from '@/components/customerService/CustomerServiceExecutionDashboard'") && source.includes('<CustomerServiceExecutionDashboard branch={branch} />')) {
  console.log('Customer service analytics UI v3 already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) throw new Error(`customer service analytics ui patch missing: ${label}`);
  source = source.replace(search, replacement);
}

replaceOnce(
  `import FollowupResultModal, { type FollowupResultData } from '@/components/customerService/FollowupResultModal';`,
  `import FollowupResultModal, { type FollowupResultData } from '@/components/customerService/FollowupResultModal';\nimport CustomerServiceExecutionDashboard from '@/components/customerService/CustomerServiceExecutionDashboard';`,
  'dashboard import'
);

const performanceStart = `      {tab === 'performance' && <section className="grid gap-4 lg:grid-cols-2">`;
const performanceEnd = `</section>}`;
const startIndex = source.indexOf(performanceStart);
if (startIndex === -1) {
  if (!source.includes(`<CustomerServiceExecutionDashboard branch={branch} />`)) {
    throw new Error('customer service analytics ui patch missing: performance block');
  }
} else {
  const endIndex = source.indexOf(performanceEnd, startIndex);
  if (endIndex === -1) throw new Error('customer service analytics ui patch missing: performance block end');
  const existing = source.slice(startIndex, endIndex + performanceEnd.length);
  source = source.replace(existing, `      {tab === 'performance' && <CustomerServiceExecutionDashboard branch={branch} />}`);
}

fs.writeFileSync(filePath, source);
console.log('Customer service analytics UI v3 applied.');
