const fs = require('fs');
const path = require('path');

const analyzerFile = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let analyzer = fs.readFileSync(analyzerFile, 'utf8');

function patch(label, from, to) {
  if (analyzer.includes(to)) { console.log(`[whatsapp-evidence-v17] ${label}: already applied`); return; }
  if (!analyzer.includes(from)) throw new Error(`[whatsapp-evidence-v17] ${label}: anchor not found`);
  analyzer = analyzer.replace(from, to);
  console.log(`[whatsapp-evidence-v17] ${label}: applied`);
}

patch(
  'evidence ledger imports',
  `import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';`,
  `import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';\nimport { syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';\nimport { syncWhatsAppResponseTurnsV18 } from '@/lib/whatsappResponseTurnsV18';`
);

patch(
  'sync evidence facts opportunities and response turns',
  `          persistedSessionSources.push({ sessionId: item.session.id, sourceId: persisted.id, contextOnly });`,
  `          persistedSessionSources.push({ sessionId: item.session.id, sourceId: persisted.id, contextOnly });\n          try {\n            await syncWhatsAppEvidenceLedgerV17(item.session, {\n              sourceId: persisted.id,\n              contextOnly,\n              operational,\n              analysisVersion: intelligence.version,\n              participantRoles,\n            });\n          } catch (evidenceError) {\n            console.warn('[whatsapp-evidence-v17] evidence sync failed; source remains preserved for review', persisted.id, evidenceError);\n          }\n          try {\n            await syncWhatsAppResponseTurnsV18(item.session, { sourceId: persisted.id, contextOnly, participantRoles });\n          } catch (turnError) {\n            console.warn('[whatsapp-turns-v18] response turn sync failed; source remains preserved for review', persisted.id, turnError);\n          }`
);

fs.writeFileSync(analyzerFile, analyzer);
console.log('[whatsapp-evidence-v17] evidence ledger, sales opportunities and response turns wired successfully');
