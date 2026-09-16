const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-case-decision-v26] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-case-decision-v26] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-case-decision-v26] ${label}: applied`);
}

patch(
  'import case decision panel',
  `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';`,
  `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';\nimport WhatsAppCaseDecisionPanelV26 from '@/components/reviews/WhatsAppCaseDecisionPanelV26';`
);

if (!src.includes('<WhatsAppCaseDecisionPanelV26 session={selected} />')) {
  const anchor = `          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">`;
  if (!src.includes(anchor)) throw new Error('[whatsapp-case-decision-v26] analyzer workspace anchor not found');
  src = src.replace(anchor, `          <WhatsAppCaseDecisionPanelV26 session={selected} />\n\n${anchor}`);
  console.log('[whatsapp-case-decision-v26] render case decision panel: applied');
} else console.log('[whatsapp-case-decision-v26] render case decision panel: already applied');

fs.writeFileSync(file, src);
console.log('[whatsapp-case-decision-v26] per-case response, journey, loss and medical gates wired into export analyzer');
