const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/SmartConversationReviewRebuild.tsx');
let src = fs.readFileSync(file, 'utf8');

const importAnchor = `import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';`;
const importLine = `import SmartConversationIntelligencePanel from '@/components/reviews/SmartConversationIntelligencePanel';`;
if (!src.includes(importLine)) {
  if (!src.includes(importAnchor)) throw new Error('[smart-intelligence-panel] import anchor not found');
  src = src.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const renderAnchor = `        {selectedStaff && pipeline && !pipeline.scope.valid ? <section className="rounded-2xl border border-rose-800/50 bg-rose-950/20 p-4 text-sm text-rose-100">{pipeline.scope.blockingReasons.map((reason) => <div key={reason}>• {reason}</div>)}</section> : null}`;
const renderLine = `        {selectedStaff && pipeline ? <SmartConversationIntelligencePanel conversation={pipeline.conversationIntelligence} staff={pipeline.intelligence} /> : null}`;
if (!src.includes(renderLine)) {
  if (!src.includes(renderAnchor)) throw new Error('[smart-intelligence-panel] render anchor not found');
  src = src.replace(renderAnchor, `${renderLine}\n\n${renderAnchor}`);
}

fs.writeFileSync(file, src);
console.log('[smart-intelligence-panel] deep conversation intelligence wired into smart review UI');
require('./patch-smart-review-actions-v1.cjs');
