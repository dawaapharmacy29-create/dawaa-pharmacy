const fs = require('fs');
const path = require('path');
const p = path.join(process.cwd(), 'src/pages/CustomerRequests.tsx');
let src = fs.readFileSync(p, 'utf8');
const MARKER = 'CUSTOMER_REQUEST_QUALITY_CENTER_V4';
if (src.includes(MARKER)) process.exit(0);

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`anchor not found: ${label}`);
  src = src.replace(from, to);
}

replaceOnce(
  "import CustomerRequestInsightsPanel from '@/components/customer-requests/CustomerRequestInsightsPanel';",
  "import CustomerRequestInsightsPanel from '@/components/customer-requests/CustomerRequestInsightsPanel';\nimport CustomerRequestQualityCenter from '@/components/customer-requests/CustomerRequestQualityCenter'; // CUSTOMER_REQUEST_QUALITY_CENTER_V4",
  'quality import'
);

replaceOnce(
  "const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'requests' | 'followup' | 'analytics' | 'archive'>(() => {",
  "const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'requests' | 'followup' | 'analytics' | 'quality' | 'archive'>(() => {",
  'workspace state type'
);
replaceOnce(
  "return ['overview', 'requests', 'followup', 'analytics', 'archive'].includes(String(value)) ? value as 'overview' | 'requests' | 'followup' | 'analytics' | 'archive' : 'overview';",
  "return ['overview', 'requests', 'followup', 'analytics', 'quality', 'archive'].includes(String(value)) ? value as 'overview' | 'requests' | 'followup' | 'analytics' | 'quality' | 'archive' : 'overview';",
  'workspace allowed values'
);

replaceOnce(
  "{workspaceTab === 'analytics' && <CustomerRequestInsightsPanel branch={branchFilter} onAction={applyAnalyticsAction} />}",
  "{workspaceTab === 'analytics' && <CustomerRequestInsightsPanel branch={branchFilter} onAction={applyAnalyticsAction} />}\n      {workspaceTab === 'quality' && <CustomerRequestQualityCenter branch={branchFilter} onOpenRequest={(request) => openDetails(request)} />}",
  'quality render'
);

replaceOnce(
  "{workspaceTab !== 'overview' && workspaceTab !== 'analytics' && (",
  "{workspaceTab !== 'overview' && workspaceTab !== 'analytics' && workspaceTab !== 'quality' && (",
  'operational exclusion'
);

replaceOnce(
  "type CustomerRequestsWorkspaceTab = 'overview' | 'requests' | 'followup' | 'analytics' | 'archive';",
  "type CustomerRequestsWorkspaceTab = 'overview' | 'requests' | 'followup' | 'analytics' | 'quality' | 'archive';",
  'workspace component type'
);

replaceOnce(
  "{ id: 'analytics', label: 'التحليلات', hint: 'الأداء والفروع' },\n    { id: 'archive', label: 'الأرشيف', hint: 'المكتمل والملغي', badge: summary.delivered + summary.cancelled },",
  "{ id: 'analytics', label: 'التحليلات', hint: 'الأداء والفروع' },\n    { id: 'quality', label: 'مشاكل البيانات', hint: 'الأكواد والربط', badge: summary.unlinked_customer + summary.no_branch + summary.invalid_phone + summary.sync_conflicts },\n    { id: 'archive', label: 'الأرشيف', hint: 'المكتمل والملغي', badge: summary.delivered + summary.cancelled },",
  'quality tab entry'
);

replaceOnce(
  'className="grid min-w-[760px] grid-cols-5 gap-1.5"',
  'className="grid min-w-[900px] grid-cols-6 gap-1.5"',
  'six tab layout'
);

fs.writeFileSync(p, src);
console.log('customer request quality center v4 applied');
