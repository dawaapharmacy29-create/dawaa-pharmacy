const fs = require('fs');
const path = require('path');

const analyzerFile = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let analyzer = fs.readFileSync(analyzerFile, 'utf8');
const evidenceFile = path.join(process.cwd(), 'src/lib/whatsappEvidenceLedgerV17.ts');
let evidenceSrc = fs.readFileSync(evidenceFile, 'utf8');

function patch(label, from, to) {
  if (analyzer.includes(to)) { console.log(`[whatsapp-evidence-v17] ${label}: already applied`); return; }
  if (!analyzer.includes(from)) throw new Error(`[whatsapp-evidence-v17] ${label}: anchor not found`);
  analyzer = analyzer.replace(from, to);
  console.log(`[whatsapp-evidence-v17] ${label}: applied`);
}

const oldRoleResolver = `function roleForStaff(participantRoles: any, staffName: string | null) {\n  const rows = Array.isArray(participantRoles?.participants) ? participantRoles.participants : Array.isArray(participantRoles) ? participantRoles : [];\n  if (!staffName) return null;\n  const normalized = staffName.trim().toLowerCase();\n  const match = rows.find((row: any) => String(row?.name || row?.sender || '').trim().toLowerCase() === normalized);\n  return match?.role || match?.resolvedRole || null;\n}`;
const newRoleResolver = `function roleForStaff(participantRoles: any, staffName: string | null) {\n  if (!staffName) return null;\n  const normalized = staffName.trim().toLowerCase();\n  const staffRows = Array.isArray(participantRoles?.staff) ? participantRoles.staff : [];\n  const staffMatch = staffRows.find((row: any) => String(row?.staffName || '').trim().toLowerCase() === normalized);\n  if (staffMatch?.role) return staffMatch.role;\n  const messageRows = Array.isArray(participantRoles?.messages) ? participantRoles.messages : [];\n  const messageMatch = messageRows.find((row: any) => String(row?.staffName || row?.sender || '').trim().toLowerCase() === normalized && row?.role && !['customer','system'].includes(row.role));\n  return messageMatch?.role || null;\n}`;
if (!evidenceSrc.includes(newRoleResolver)) {
  if (!evidenceSrc.includes(oldRoleResolver)) throw new Error('[whatsapp-evidence-v17] role resolver model anchor not found');
  evidenceSrc = evidenceSrc.replace(oldRoleResolver, newRoleResolver);
  fs.writeFileSync(evidenceFile, evidenceSrc);
  console.log('[whatsapp-evidence-v17] evidence participant role model aligned');
} else {
  console.log('[whatsapp-evidence-v17] evidence participant role model already aligned');
}

patch(
  'evidence ledger imports',
  `import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';`,
  `import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';\nimport { syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';\nimport { syncWhatsAppResponseTurnsV18 } from '@/lib/whatsappResponseTurnsV18';\nimport { syncWhatsAppOrderLifecycleV19 } from '@/lib/whatsappOrderLifecycleV19';`
);

patch(
  'sync evidence facts opportunities response turns and order lifecycle',
  `          persistedSessionSources.push({ sessionId: item.session.id, sourceId: persisted.id, contextOnly });`,
  `          persistedSessionSources.push({ sessionId: item.session.id, sourceId: persisted.id, contextOnly });\n          try {\n            await syncWhatsAppEvidenceLedgerV17(item.session, {\n              sourceId: persisted.id,\n              contextOnly,\n              operational,\n              analysisVersion: intelligence.version,\n              participantRoles,\n            });\n          } catch (evidenceError) {\n            console.warn('[whatsapp-evidence-v17] evidence sync failed; source remains preserved for review', persisted.id, evidenceError);\n          }\n          try {\n            await syncWhatsAppResponseTurnsV18(item.session, { sourceId: persisted.id, contextOnly, participantRoles });\n          } catch (turnError) {\n            console.warn('[whatsapp-turns-v18] response turn sync failed; source remains preserved for review', persisted.id, turnError);\n          }\n          try {\n            await syncWhatsAppOrderLifecycleV19(item.session, { sourceId: persisted.id, contextOnly, participantRoles });\n          } catch (lifecycleError) {\n            console.warn('[whatsapp-order-v19] order lifecycle sync failed; source remains preserved for review', persisted.id, lifecycleError);\n          }`
);

fs.writeFileSync(analyzerFile, analyzer);
console.log('[whatsapp-evidence-v17] evidence ledger, opportunities, response turns and order lifecycle wired successfully');
