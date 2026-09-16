const fs = require('fs');
const path = require('path');

const analyzerFile = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let analyzer = fs.readFileSync(analyzerFile, 'utf8');

function patch(label, from, to) {
  if (analyzer.includes(to)) { console.log(`[whatsapp-participant-role-v15] ${label}: already applied`); return; }
  if (!analyzer.includes(from)) throw new Error(`[whatsapp-participant-role-v15] ${label}: anchor not found`);
  analyzer = analyzer.replace(from, to);
  console.log(`[whatsapp-participant-role-v15] ${label}: applied`);
}

patch(
  'participant resolver import',
  `import { syncWhatsAppCustomerJourneyV15, type JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';`,
  `import { syncWhatsAppCustomerJourneyV15, type JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';\nimport { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';`
);

patch(
  'resolve roles before persistence',
  `          const operationalProducts = await enrichWhatsAppOperationalProductsV6(buildWhatsAppOperationalIntelligenceV6(item.session, baseIntelligence));\n          const operational = enrichWhatsAppOperationalJourneysV7(item.session, operationalProducts);\n          const intelligence = { ...baseIntelligence, operational };`,
  `          const operationalProducts = await enrichWhatsAppOperationalProductsV6(buildWhatsAppOperationalIntelligenceV6(item.session, baseIntelligence));\n          const operational = enrichWhatsAppOperationalJourneysV7(item.session, operationalProducts);\n          const participantRoles = await resolveWhatsAppParticipantRolesV15(item.session);\n          const intelligence = { ...baseIntelligence, operational, participantRoles };`
);

fs.writeFileSync(analyzerFile, analyzer);
console.log('[whatsapp-participant-role-v15] participant roles wired into saved intelligence');
