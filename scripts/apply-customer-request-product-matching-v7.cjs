const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/CustomerRequests.tsx');
let src = fs.readFileSync(file, 'utf8');
const MARKER = 'CUSTOMER_REQUEST_PRODUCT_MATCHING_WAREHOUSE_V7';

if (!src.includes(MARKER)) {
  const importAnchor = `import CustomerRequestQualityCenter from '@/components/customer-requests/CustomerRequestQualityCenter'; // CUSTOMER_REQUEST_QUALITY_CENTER_V4\n`;
  if (!src.includes(importAnchor)) throw new Error('import anchor not found');
  src = src.replace(importAnchor, `${importAnchor}import CustomerRequestWarehousePanel from '@/components/customer-requests/CustomerRequestWarehousePanel';\nimport CustomerRequestCriticalToday from '@/components/customer-requests/CustomerRequestCriticalToday'; // ${MARKER}\n`);

  const overviewAnchor = `{workspaceTab === 'overview' && <CustomerRequestsOverview summary={summary} onOpenQueue={(filter) => { setWorkspaceTab('requests'); setQuickFilter(filter); setStatusFilter('all'); }} />}`;
  if (!src.includes(overviewAnchor)) throw new Error('overview anchor not found');
  src = src.replace(overviewAnchor, `{workspaceTab === 'overview' && <>\n        <CustomerRequestsOverview summary={summary} onOpenQueue={(filter) => { setWorkspaceTab('requests'); setQuickFilter(filter); setStatusFilter('all'); }} />\n        <CustomerRequestCriticalToday branch={branchFilter} onOpenRequest={(request) => openDetails(request)} />\n      </>}`);

  const followupAnchor = `          {workspaceTab === 'followup' && (\n            <CustomerRequestsStageTabs\n              value={statusFilter}\n              onChange={(status) => { setQuickFilter('all'); setStatusFilter(status); setPage(1); }}\n              items={[[\'searching_suppliers\', \'جاري البحث\'], [\'sourcing\', \'جاري التوفير\'], [\'available\', \'تم التوفير\'], [\'customer_contacted\', \'تم التواصل\']]}\n            />\n          )}`;
  if (!src.includes(followupAnchor)) throw new Error('followup anchor not found');
  src = src.replace(followupAnchor, `          {workspaceTab === 'followup' && <>\n            <CustomerRequestsStageTabs\n              value={statusFilter}\n              onChange={(status) => { setQuickFilter('all'); setStatusFilter(status); setPage(1); }}\n              items={[[\'searching_suppliers\', \'جاري البحث\'], [\'sourcing\', \'جاري التوفير\'], [\'available\', \'تم التوفير\'], [\'customer_contacted\', \'تم التواصل\']]}\n            />\n            <CustomerRequestWarehousePanel branch={branchFilter} />\n          </>}`);

  src = src.replace(`{ id: 'followup', label: 'المتابعة', hint: 'التوفير والتواصل', badge: summary.searching + summary.waiting_customer + summary.ready },`, `{ id: 'followup', label: 'المتابعة', hint: 'التوفير + ملف المخازن', badge: summary.searching + summary.waiting_customer + summary.ready },`);

  fs.writeFileSync(file, src);
  console.log('customer request product matching v7 UI applied');
} else {
  console.log('customer request product matching v7 already applied');
}
