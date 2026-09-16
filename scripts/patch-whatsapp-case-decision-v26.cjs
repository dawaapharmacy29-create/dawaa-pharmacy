const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

const importLine = `import WhatsAppCaseDecisionPanelV26 from '@/components/reviews/WhatsAppCaseDecisionPanelV26';`;
if (!src.includes(importLine)) {
  src = `${importLine}\n${src}`;
  console.log('[whatsapp-case-decision-v26] import case decision panel: applied');
} else {
  console.log('[whatsapp-case-decision-v26] import case decision panel: already applied');
}

if (!src.includes('<WhatsAppCaseDecisionPanelV26 session={selected} />')) {
  const anchors = [
    `          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">`,
    `          <div className="grid gap-5`,
    `          <div className="grid gap-4`,
  ];
  const anchor = anchors.find((value) => src.includes(value));
  if (!anchor) throw new Error('[whatsapp-case-decision-v26] analyzer workspace anchor not found');
  src = src.replace(anchor, `          <WhatsAppCaseDecisionPanelV26 session={selected} />\n\n${anchor}`);
  console.log('[whatsapp-case-decision-v26] render case decision panel: applied');
} else {
  console.log('[whatsapp-case-decision-v26] render case decision panel: already applied');
}

fs.writeFileSync(file, src);
console.log('[whatsapp-case-decision-v26] per-case response, journey, loss and medical gates wired into export analyzer');
require('./patch-whatsapp-analysis-scope.cjs');
