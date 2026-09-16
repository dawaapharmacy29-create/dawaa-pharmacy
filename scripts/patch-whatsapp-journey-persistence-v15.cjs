const fs = require('fs');
const path = require('path');

function patchFile(filePath, patches) {
  const file = path.join(process.cwd(), filePath);
  let src = fs.readFileSync(file, 'utf8');
  for (const { label, from, to } of patches) {
    if (src.includes(to)) { console.log(`[whatsapp-journey-persistence-v15] ${label}: already applied`); continue; }
    if (!src.includes(from)) throw new Error(`[whatsapp-journey-persistence-v15] ${label}: anchor not found in ${filePath}`);
    src = src.replace(from, to);
    console.log(`[whatsapp-journey-persistence-v15] ${label}: applied`);
  }
  fs.writeFileSync(file, src);
}

patchFile('src/lib/whatsappReviewPersistenceV4.ts', [
  {
    label: 'context-only persistence flag',
    from: `  createdBy?: string | null;\n}`,
    to: `  createdBy?: string | null;\n  contextOnly?: boolean;\n}`,
  },
  {
    label: 'archive context-only sessions',
    from: `  const reviewStatus = inferQueueStatus(intelligence);`,
    to: `  const reviewStatus: ReviewQueueStatus = context.contextOnly ? 'archived' : inferQueueStatus(intelligence);`,
  },
  {
    label: 'context-only analysis and scores',
    from: `      analysis_status: intelligence.requiresHumanApproval ? 'needs_review' : 'analyzed',\n      review_status: reviewStatus,\n      priority: intelligence.priority,\n      analysis_confidence: intelligence.confidence,\n      service_score: intelligence.serviceScore,\n      commercial_score: intelligence.commercialScore,\n      commercial_eligible: intelligence.commercialEligible,\n      chat_suggested_sold: intelligence.chatSuggestedSold,\n      followup_required: intelligence.followupRequired,\n      suggested_followup_reason: intelligence.suggestedFollowupReason,\n      analysis_json: serializeIntelligence(intelligence),`,
    to: `      analysis_status: context.contextOnly ? 'context_only' : intelligence.requiresHumanApproval ? 'needs_review' : 'analyzed',\n      review_status: reviewStatus,\n      priority: context.contextOnly ? 'normal' : intelligence.priority,\n      analysis_confidence: intelligence.confidence,\n      service_score: context.contextOnly ? null : intelligence.serviceScore,\n      commercial_score: context.contextOnly ? null : intelligence.commercialScore,\n      commercial_eligible: context.contextOnly ? false : intelligence.commercialEligible,\n      chat_suggested_sold: context.contextOnly ? false : intelligence.chatSuggestedSold,\n      followup_required: context.contextOnly ? false : intelligence.followupRequired,\n      suggested_followup_reason: context.contextOnly ? 'جلسة سياق مرتبطة برحلة العميل ولا تُقيّم منفردة.' : intelligence.suggestedFollowupReason,\n      analysis_json: { ...serializeIntelligence(intelligence), contextOnly: Boolean(context.contextOnly) },`,
  },
]);

const analyzerFile = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let analyzer = fs.readFileSync(analyzerFile, 'utf8');
function patchAnalyzer(label, from, to) {
  if (analyzer.includes(to)) { console.log(`[whatsapp-journey-persistence-v15] ${label}: already applied`); return; }
  if (!analyzer.includes(from)) throw new Error(`[whatsapp-journey-persistence-v15] ${label}: anchor not found in analyzer`);
  analyzer = analyzer.replace(from, to);
  console.log(`[whatsapp-journey-persistence-v15] ${label}: applied`);
}

patchAnalyzer(
  'journey persistence import',
  `import { buildWhatsAppCustomerJourneyIntelligenceV15 } from '@/lib/whatsappCustomerJourneyIntelligenceV15';`,
  `import { buildWhatsAppCustomerJourneyIntelligenceV15 } from '@/lib/whatsappCustomerJourneyIntelligenceV15';\nimport { syncWhatsAppCustomerJourneyV15, type JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';`
);

patchAnalyzer(
  'collect persisted session mappings',
  `    const result = { inserted: 0, duplicates: 0, excluded: 0, failed: 0 };\n    try {`,
  `    const result = { inserted: 0, duplicates: 0, excluded: 0, failed: 0 };\n    const persistedSessionSources: JourneySessionSourceV15[] = [];\n    try {`
);

patchAnalyzer(
  'persist outbound followups as context only',
  `        // Outbound-only pharmacy follow-ups are useful operationally but are not scored as customer conversations.\n        if (item.kind === 'pharmacy_followup') {\n          result.excluded += 1;\n          continue;\n        }`,
  `        // Outbound-only pharmacy follow-ups are essential journey context, but are never scored as standalone doctor conversations.\n        const contextOnly = item.kind === 'pharmacy_followup';\n        if (contextOnly) result.excluded += 1;`
);

patchAnalyzer(
  'pass context-only to source persistence',
  `            createdBy: String(user?.name || user?.username || user?.id || ''),\n          });`,
  `            createdBy: String(user?.name || user?.username || user?.id || ''),\n            contextOnly,\n          });\n          persistedSessionSources.push({ sessionId: item.session.id, sourceId: persisted.id, contextOnly });`
);

const actionStart = `          try {\n            await syncWhatsAppOperationalActionsV6(operational, {`;
const actionEnd = `          } catch (actionError) {\n            console.warn('[whatsapp-operational-v6] action sync failed; review source preserved', persisted.id, actionError);\n          }`;
if (!analyzer.includes('if (!contextOnly) {\n            try {\n              await syncWhatsAppOperationalActionsV6')) {
  if (!analyzer.includes(actionStart) || !analyzer.includes(actionEnd)) throw new Error('[whatsapp-journey-persistence-v15] per-session action sync anchors not found');
  analyzer = analyzer.replace(actionStart, `          if (!contextOnly) {\n            try {\n              await syncWhatsAppOperationalActionsV6(operational, {`);
  analyzer = analyzer.replace(actionEnd, `            } catch (actionError) {\n              console.warn('[whatsapp-operational-v6] action sync failed; review source preserved', persisted.id, actionError);\n            }\n          }`);
  console.log('[whatsapp-journey-persistence-v15] skip operational actions for context-only sessions: applied');
}

patchAnalyzer(
  'sync one cross-session journey after queue persistence',
  `      setQueueResult(result);\n      if (!options?.silent) {`,
  `      if (persistedSessionSources.length) {\n        try {\n          const journeyModel = buildWhatsAppCustomerJourneyIntelligenceV15(queueItems.map((entry) => entry.session));\n          await syncWhatsAppCustomerJourneyV15(journeyModel, {\n            sourceFileName: options?.sourceName || sourceFileName || fileName || null,\n            branch: importBranch,\n            createdBy: String(user?.name || user?.username || user?.id || ''),\n            sessionSources: persistedSessionSources,\n          });\n        } catch (journeyError) {\n          console.warn('[whatsapp-journey-v15] journey sync failed; individual sessions preserved', journeyError);\n        }\n      }\n      setQueueResult(result);\n      if (!options?.silent) {`
);

analyzer = analyzer.replace('متابعات صادرة مستبعدة', 'جلسات سياق غير مُقيّمة');
analyzer = analyzer.replace('جلسات المتابعة الصادرة فقط تُستبعد من التقييم الرسمي', 'جلسات المتابعة الصادرة تُحفظ كسياق للرحلة وتُستبعد فقط من التقييم الرسمي');

fs.writeFileSync(analyzerFile, analyzer);
console.log('[whatsapp-journey-persistence-v15] context sessions and journey persistence wired successfully');
