const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/lib/whatsappUnifiedIntelligenceV4.ts');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-media-confidence-v4] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-media-confidence-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-media-confidence-v4] ${label}: applied`);
}

patch(
  'media evidence interface',
  `export interface UnifiedConversationIntelligence {`,
  `export interface MediaEvidenceSummary {\n  total: number;\n  images: number;\n  voices: number;\n  videos: number;\n  documents: number;\n  missingContent: number;\n  replies: number;\n  forwarded: number;\n  coveragePercent: number;\n  limitation: string | null;\n}\n\nexport interface UnifiedConversationIntelligence {`
);

patch(
  'intelligence context fields',
  `  confidence: number;\n  requiresHumanApproval: boolean;`,
  `  confidence: number;\n  contextQuality: number;\n  mediaEvidence: MediaEvidenceSummary;\n  requiresHumanApproval: boolean;`
);

patch(
  'build media evidence',
  `  const highMedical = medicalSafetyFlags.some((x) => x.severity === 'high');`,
  `  const mediaKinds = session.mediaKinds || { text: 0, image: 0, voice: 0, video: 0, document: 0, deleted: 0, system: 0, unknown: 0 };\n  const missingMediaCount = Number(session.missingMediaCount ?? session.messages.filter((m) => m.mediaPlaceholder && !m.mediaAvailable).length);\n  const mediaTotal = Number(session.mediaCount || 0);\n  const mediaAvailable = Math.max(0, mediaTotal - missingMediaCount);\n  const mediaCoveragePercent = mediaTotal > 0 ? Math.round((mediaAvailable / mediaTotal) * 100) : 100;\n  const replyCount = Number(session.replyCount ?? session.messages.filter((m) => Boolean(m.replyTo?.text)).length);\n  const forwardedCount = Number(session.forwardedCount ?? session.messages.filter((m) => m.forwarded).length);\n  const contextQuality = clamp(Math.round(100 - Math.min(45, missingMediaCount * 12) + Math.min(8, replyCount * 2)));\n  const mediaEvidence: MediaEvidenceSummary = {\n    total: mediaTotal,\n    images: Number(mediaKinds.image || 0),\n    voices: Number(mediaKinds.voice || 0),\n    videos: Number(mediaKinds.video || 0),\n    documents: Number(mediaKinds.document || 0),\n    missingContent: missingMediaCount,\n    replies: replyCount,\n    forwarded: forwardedCount,\n    coveragePercent: mediaCoveragePercent,\n    limitation: missingMediaCount > 0\n      ? 'يوجد محتوى وسائط مشار إليه في المحادثة لكنه غير موجود فعليًا داخل ملف التصدير؛ لا يتم استنتاج محتواه آليًا.'\n      : null,\n  };\n\n  const highMedical = medicalSafetyFlags.some((x) => x.severity === 'high');`
);

patch(
  'context aware confidence',
  `  const confidencePenalty = session.mediaCount > 0 ? Math.min(25, session.mediaCount * 5) : 0;\n  const confidence = clamp(Math.round((signals.deterministicConfidence + 90) / 2 - confidencePenalty));\n  const requiresHumanApproval = highMedical || confidence < 78 || session.mediaCount > 0 || priority === 'urgent';`,
  `  const confidencePenalty = missingMediaCount > 0 ? Math.min(35, missingMediaCount * 9) : 0;\n  const replyContextBonus = Math.min(6, replyCount * 2);\n  const confidence = clamp(Math.round((signals.deterministicConfidence + 90) / 2 - confidencePenalty + replyContextBonus));\n  const medicallyIncompleteMedia = missingMediaCount > 0 && (medicalSafetyFlags.length > 0 || session.messages.some((m) => ['voice', 'image'].includes(m.kind)));\n  const requiresHumanApproval = highMedical || confidence < 78 || medicallyIncompleteMedia || priority === 'urgent';`
);

patch(
  'executive summary media limitation',
  `  const executiveSummary = \`${'${outcomeLabel[outcome]}.'} خدمة ${'${serviceScore}'}%، أداء بيعي ${'${commercialScore}'}%. ${'${followupRequired ? `المتابعة مطلوبة: ${suggestedFollowupReason}` : \'لا توجد متابعة عاجلة مثبتة.\'}'} ${'${requiresHumanApproval ? \'تحتاج اعتماد بشري قبل الأثر الرسمي.\' : \'صالحة لمراجعة بشرية سريعة.\'}'}\`;`,
  `  const executiveSummary = \`${'${outcomeLabel[outcome]}.'} خدمة ${'${serviceScore}'}%، أداء بيعي ${'${commercialScore}'}%. ${'${followupRequired ? `المتابعة مطلوبة: ${suggestedFollowupReason}` : \'لا توجد متابعة عاجلة مثبتة.\'}'} ${'${missingMediaCount > 0 ? `جودة السياق ${contextQuality}% بسبب ${missingMediaCount} مرفق غير متاح. ` : \'\'}'}${'${requiresHumanApproval ? \'تحتاج اعتماد بشري قبل الأثر الرسمي.\' : \'صالحة لمراجعة بشرية سريعة.\'}'}\`;`
);

patch(
  'return context evidence',
  `    confidence,\n    requiresHumanApproval,`,
  `    confidence,\n    contextQuality,\n    mediaEvidence,\n    requiresHumanApproval,`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-media-confidence-v4] context quality and media evidence applied successfully');
