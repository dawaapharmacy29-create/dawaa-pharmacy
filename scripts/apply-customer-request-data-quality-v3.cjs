const fs = require('fs');
const path = require('path');
const p = path.join(process.cwd(), 'src/pages/CustomerRequests.tsx');
let src = fs.readFileSync(p, 'utf8');
const marker = 'CUSTOMER_REQUEST_DATA_QUALITY_V3';
if (!src.includes(marker)) {
  const importAnchor = "import CustomerRequestInsightsPanel from '@/components/customer-requests/CustomerRequestInsightsPanel';";
  if (!src.includes(importAnchor)) throw new Error('insights import anchor not found');
  src = src.replace(importAnchor, `${importAnchor}\nimport CustomerRequestDataQualityPanel from '@/components/customer-requests/CustomerRequestDataQualityPanel'; // ${marker}`);

  const detailAnchor = `<RequestDetail request={selected as RequestWithProduct} events={events} newStatus={newStatus} setNewStatus={setNewStatus} note={statusNote} setNote={setStatusNote} saving={saving} onStatus={() => void saveStatus(newStatus)} onQuickStatus={(status, note) => void saveStatus(status, note ?? '')} onWhatsApp={openWhatsApp} onShortage={moveToShortage} user={user} />`;
  if (!src.includes(detailAnchor)) throw new Error('request detail anchor not found');
  src = src.replace(detailAnchor, `<CustomerRequestDataQualityPanel\n              request={selected as RequestWithProduct}\n              onUpdated={(updated) => {\n                setSelected(updated);\n                setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));\n                void load();\n              }}\n            />\n            ${detailAnchor}`);
  fs.writeFileSync(p, src);
}
