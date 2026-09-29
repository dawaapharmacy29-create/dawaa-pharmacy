const fs = require('fs');
const path = require('path');

function patchFile(filePath, patches) {
  const file = path.join(process.cwd(), filePath);
  let src = fs.readFileSync(file, 'utf8');
  for (const { label, from, to } of patches) {
    if (src.includes(to)) {
      console.log(`[whatsapp-analysis-quality-v5] ${label}: already applied`);
      continue;
    }
    if (!src.includes(from)) throw new Error(`[whatsapp-analysis-quality-v5] ${label}: anchor not found in ${filePath}`);
    src = src.replace(from, to);
    console.log(`[whatsapp-analysis-quality-v5] ${label}: applied`);
  }
  fs.writeFileSync(file, src);
}

patchFile('src/lib/whatsappConversationSignals.ts', [
  {
    label: 'confidence depends on evidence volume not merely text presence',
    from: `  const nudges = inbound.filter((m) => includesAny(m.text, NUDGE));\n  const meaningfulInboundCount = inbound.filter((m) => m.kind === 'text' && m.text.trim().length > 1).length;\n  const evidenceCoverage = session.messages.length\n    ? Math.max(0, 1 - media.length / session.messages.length)\n    : 0;\n  const deterministicConfidence = Math.round(\n    Math.min(100, (0.65 + 0.25 * evidenceCoverage + (meaningfulInboundCount > 0 ? 0.1 : 0)) * 100)\n  );`,
    to: `  const nudges = inbound.filter((m) => includesAny(m.text, NUDGE));\n  const meaningfulInboundCount = inbound.filter((m) => m.kind === 'text' && m.text.trim().length > 1).length;\n  const meaningfulOutboundCount = outbound.filter((m) => m.kind === 'text' && m.text.trim().length > 1).length;\n  const meaningfulTextCount = meaningfulInboundCount + meaningfulOutboundCount;\n  const evidenceCoverage = session.messages.length\n    ? Math.max(0, 1 - media.length / session.messages.length)\n    : 0;\n  // الثقة هنا هي ثقة في اكتمال الدليل، وليست ثقة في أن أي استنتاج صحيح لمجرد وجود نص.\n  // جلسة من رسالتين فقط لا يجوز أن تحصل على 95-100% حتى لو النص واضح.\n  const volumeScore = meaningfulTextCount >= 15 ? 78\n    : meaningfulTextCount >= 10 ? 72\n      : meaningfulTextCount >= 6 ? 62\n        : meaningfulTextCount >= 4 ? 52\n          : meaningfulTextCount >= 2 ? 38\n            : 22;\n  const directionBonus = meaningfulInboundCount > 0 && meaningfulOutboundCount > 0 ? 9 : 0;\n  const staffEvidenceBonus = session.outboundStaffNames.length > 0 ? 6 : 0;\n  const mediaCoverageBonus = Math.round(evidenceCoverage * 5);\n  const deterministicConfidence = Math.max(15, Math.min(96,\n    volumeScore + directionBonus + staffEvidenceBonus + mediaCoverageBonus - Math.min(20, media.length * 4)\n  ));`
  }
]);

const customerResolverPath = path.join(process.cwd(), 'src/lib/whatsappCustomerResolverV4.ts');
const customerResolverSource = fs.readFileSync(customerResolverPath, 'utf8');
if (customerResolverSource.includes("'strong_name_candidates'") && customerResolverSource.includes('customerNameSimilarity')) {
  console.log('[whatsapp-analysis-quality-v5] hardened customer resolver detected; legacy resolver patches skipped');
} else {
  patchFile('src/lib/whatsappCustomerResolverV4.ts', [
    {
      label: 'customer resolver supports exact customer code',
      from: `  strategy: 'phone_exact' | 'name_exact_branch' | 'name_exact' | 'none' | 'ambiguous';`,
      to: `  strategy: 'code_exact' | 'phone_exact' | 'name_exact_branch' | 'name_exact' | 'none' | 'ambiguous';`
    },
    {
      label: 'search identity by raw name stripped name and code hint',
      from: `  const candidates = uniqueById(await searchCustomers(raw, 12));\n  if (!candidates.length) {`,
      to: `  const codeHint = (raw.match(/(?:^|\\s|[-_])(\\d{2,8})(?=$|\\s|[-_])/g) || [])\n    .map((value) => value.replace(/\\D/g, ''))\n    .filter(Boolean)\n    .pop() || null;\n  const nameWithoutCode = raw.replace(/(?:^|\\s|[-_])\\d{2,8}(?=$|\\s|[-_])/g, ' ').replace(/\\s+/g, ' ').trim();\n  const searches = await Promise.all([\n    searchCustomers(raw, 12),\n    ...(codeHint ? [searchCustomers(codeHint, 12)] : []),\n    ...(nameWithoutCode && nameWithoutCode !== raw ? [searchCustomers(nameWithoutCode, 12)] : []),\n  ]);\n  const candidates = uniqueById(searches.flat());\n  if (!candidates.length) {`
    },
    {
      label: 'prefer exact code before phone and name',
      from: `  const rawPhone = normalizePhone(raw);`,
      to: `  if (codeHint) {\n    const exactCode = candidates.filter((row) => String(row.code || '').trim() === codeHint);\n    if (exactCode.length === 1) {\n      return { customer: exactCode[0], confidence: 0.995, strategy: 'code_exact', reason: 'تم استخراج كود العميل من هوية/اسم ملف التصدير ومطابقته بالكامل.', candidates };\n    }\n    if (exactCode.length > 1) {\n      const branchKey = normalizeBranch(branch);\n      const sameBranch = branchKey ? exactCode.filter((row) => normalizeBranch(row.branch) === branchKey) : [];\n      if (sameBranch.length === 1) {\n        return { customer: sameBranch[0], confidence: 0.98, strategy: 'code_exact', reason: 'كود العميل متطابق وتم حسم السجل باستخدام الفرع.', candidates: exactCode };\n      }\n      return { customer: null, confidence: 0.5, strategy: 'ambiguous', reason: 'كود العميل موجود في أكثر من سجل؛ يحتاج اختيارًا بشريًا.', candidates: exactCode };\n    }\n  }\n\n  const rawPhone = normalizePhone(raw);`
    },
    {
      label: 'exact name ignores trailing customer code',
      from: `  const rawName = normalizeArabicText(raw);`,
      to: `  const rawName = normalizeArabicText(nameWithoutCode || raw);`
    }
  ]);
}

patchFile('src/lib/whatsappUnifiedIntelligenceV4.ts', [
  {
    label: 'upgrade intelligence version and add session kind type',
    from: `export type UnifiedPriority = 'normal' | 'important' | 'urgent';`,
    to: `export type UnifiedPriority = 'normal' | 'important' | 'urgent';\nexport type UnifiedSessionKind = 'sales' | 'followup_response' | 'complaint' | 'medical_consultation' | 'general_service';`
  },
  {
    label: 'upgrade analysis version literal',
    from: `  version: 'whatsapp-review-v4';`,
    to: `  version: 'whatsapp-review-v5';\n  sessionKind: UnifiedSessionKind;\n  evaluationCoverage: number;\n  applicableDimensions: string[];\n  notApplicableDimensions: string[];`
  },
  {
    label: 'classify session purpose and applicability',
    from: `function scoreService(session: WhatsAppConversationSession) {`,
    to: `function classifySessionKind(session: WhatsAppConversationSession, signals: ReturnType<typeof extractConversationSignals>): UnifiedSessionKind {\n  const all = allText(session);\n  const inbound = inboundText(session);\n  if (signals.complaintOrEscalationDetected || has(all, COMPLAINT_RX)) return 'complaint';\n  if (signals.saleIntentDetected || has(inbound, NEED_RX) || has(all, SALE_CLOSE_RX)) return 'sales';\n  const followupResponse = /(احسن|أحسن|افضل|أفضل|كويس|كويسة|تمام الحمد|الحمد ?لله|الحمدلله|بقيت|بقت|خف|خفت|تحسن|اتحسن|اتحسنت|ممتاز)/i.test(inbound);\n  if (followupResponse && session.messages.length <= 6) return 'followup_response';\n  if (has(all, MEDICAL_RX)) return 'medical_consultation';\n  return 'general_service';\n}\n\nfunction applicabilityFor(kind: UnifiedSessionKind) {\n  if (kind === 'followup_response') return {\n    applicable: ['response_speed', 'tone', 'empathy'],\n    notApplicable: ['opening', 'need_discovery', 'availability', 'alternative', 'sale_closing', 'delivery', 'commercial_score'],\n  };\n  if (kind === 'complaint') return {\n    applicable: ['response_speed', 'tone', 'empathy', 'complaint_recovery', 'apology_when_needed'],\n    notApplicable: ['availability', 'alternative', 'sale_closing', 'commercial_score'],\n  };\n  if (kind === 'medical_consultation') return {\n    applicable: ['response_speed', 'tone', 'need_discovery', 'medical_safety'],\n    notApplicable: ['sale_closing', 'delivery'],\n  };\n  if (kind === 'sales') return {\n    applicable: ['opening', 'response_speed', 'need_discovery', 'availability', 'alternative', 'sale_closing', 'delivery', 'commercial_score'],\n    notApplicable: [],\n  };\n  return {\n    applicable: ['response_speed', 'tone'],\n    notApplicable: ['availability', 'alternative', 'sale_closing', 'delivery', 'commercial_score'],\n  };\n}\n\nfunction evaluationCoverageFor(session: WhatsAppConversationSession, kind: UnifiedSessionKind) {\n  const count = session.messages.length;\n  let score = count >= 15 ? 92 : count >= 10 ? 84 : count >= 6 ? 72 : count >= 4 ? 58 : count >= 2 ? 38 : 24;\n  if (kind === 'followup_response' && count <= 4) score = Math.min(score, 42);\n  if (!session.outboundStaffNames.length) score -= 8;\n  const missing = Number(session.missingMediaCount || 0);\n  score -= Math.min(30, missing * 8);\n  return clamp(Math.round(score));\n}\n\nfunction scoreService(session: WhatsAppConversationSession, kind: UnifiedSessionKind) {`
  },
  {
    label: 'service score respects not-applicable dimensions',
    from: `  let score = 100;\n  if (!s.greetingDetected) score -= 10;\n  if (!s.closingDetected) score -= 8;`,
    to: `  let score = 100;\n  const fullFlow = kind === 'sales';\n  // لا نعاقب جلسة متابعة قصيرة على عدم وجود ترحيب/إغلاق لأنها غالبًا جزء من سياق سابق.\n  if (fullFlow && !s.greetingDetected) score -= 10;\n  if (fullFlow && !s.closingDetected) score -= 8;`
  },
  {
    label: 'build kind coverage and conditional commercial score',
    from: `  const signals = extractConversationSignals(session);\n  const { journeyStages, lostSales, outcome } = analyzeJourney(session);\n  const medicalSafetyFlags = analyzeMedicalSafety(session);\n  const serviceScore = scoreService(session);\n  const commercialScore = scoreCommercial(session, lostSales, outcome);`,
    to: `  const signals = extractConversationSignals(session);\n  const sessionKind = classifySessionKind(session, signals);\n  const applicability = applicabilityFor(sessionKind);\n  const evaluationCoverage = evaluationCoverageFor(session, sessionKind);\n  const { journeyStages, lostSales, outcome } = analyzeJourney(session);\n  const medicalSafetyFlags = analyzeMedicalSafety(session);\n  const serviceScore = scoreService(session, sessionKind);\n  const commercialScore = sessionKind === 'sales' ? scoreCommercial(session, lostSales, outcome) : 0;`
  },
  {
    label: 'commercial eligibility only for true sales sessions',
    from: `  const commercialEligible = signals.saleIntentDetected || journeyStages.some((x) => ['need', 'availability', 'alternative', 'closing'].includes(x.key) && x.detected);`,
    to: `  const commercialEligible = sessionKind === 'sales' && (signals.saleIntentDetected || journeyStages.some((x) => ['need', 'availability', 'alternative', 'closing'].includes(x.key) && x.detected));`
  },
  {
    label: 'context quality includes conversation completeness not media only',
    from: `  const contextQuality = clamp(Math.round(100 - Math.min(45, missingMediaCount * 12) + Math.min(8, replyCount * 2)));`,
    to: `  const messageContextBase = session.messages.length >= 15 ? 96 : session.messages.length >= 10 ? 90 : session.messages.length >= 6 ? 78 : session.messages.length >= 4 ? 62 : session.messages.length >= 2 ? 46 : 30;\n  const contextQuality = clamp(Math.round(messageContextBase - Math.min(45, missingMediaCount * 12) + Math.min(8, replyCount * 2)));`
  },
  {
    label: 'confidence capped by coverage and unknown staff requires review',
    from: `  const confidencePenalty = missingMediaCount > 0 ? Math.min(35, missingMediaCount * 9) : 0;\n  const replyContextBonus = Math.min(6, replyCount * 2);\n  const confidence = clamp(Math.round((signals.deterministicConfidence + 90) / 2 - confidencePenalty + replyContextBonus));\n  const medicallyIncompleteMedia = missingMediaCount > 0 && (medicalSafetyFlags.length > 0 || session.messages.some((m) => ['voice', 'image'].includes(m.kind)));\n  const requiresHumanApproval = highMedical || confidence < 78 || medicallyIncompleteMedia || priority === 'urgent';`,
    to: `  const confidencePenalty = missingMediaCount > 0 ? Math.min(35, missingMediaCount * 9) : 0;\n  const replyContextBonus = Math.min(6, replyCount * 2);\n  const rawConfidence = clamp(Math.round((signals.deterministicConfidence + contextQuality) / 2 - confidencePenalty + replyContextBonus));\n  // لا نسمح لثقة التحليل أن تتجاوز اكتمال الجلسة بفارق كبير.\n  const confidence = Math.min(rawConfidence, clamp(evaluationCoverage + 15));\n  const medicallyIncompleteMedia = missingMediaCount > 0 && (medicalSafetyFlags.length > 0 || session.messages.some((m) => ['voice', 'image'].includes(m.kind)));\n  const missingStaffIdentity = session.messages.some((m) => m.direction === 'outbound') && session.outboundStaffNames.length === 0;\n  const shortOrPartialSession = evaluationCoverage < 65;\n  const requiresHumanApproval = highMedical || confidence < 78 || medicallyIncompleteMedia || priority === 'urgent' || missingStaffIdentity || shortOrPartialSession;`
  },
  {
    label: 'summary explains session kind n-a and evidence coverage',
    from: `  const executiveSummary = \`${'${outcomeLabel[outcome]}.'} خدمة ${'${serviceScore}'}%، أداء بيعي ${'${commercialScore}'}%. ${'${followupRequired ? `المتابعة مطلوبة: ${suggestedFollowupReason}` : \'لا توجد متابعة عاجلة مثبتة.\'}'} ${'${missingMediaCount > 0 ? `جودة السياق ${contextQuality}% بسبب ${missingMediaCount} مرفق غير متاح. ` : \'\'}'}${'${requiresHumanApproval ? \'تحتاج اعتماد بشري قبل الأثر الرسمي.\' : \'صالحة لمراجعة بشرية سريعة.\'}'}\`;`,
    to: `  const kindLabel: Record<UnifiedSessionKind, string> = { sales: 'جلسة بيع', followup_response: 'رد على متابعة', complaint: 'شكوى/احتواء', medical_consultation: 'استشارة دوائية', general_service: 'خدمة عامة' };\n  const commercialText = commercialEligible ? 'أداء بيعي ' + commercialScore + '%.' : 'التقييم البيعي غير منطبق على هذا الجزء.';\n  const executiveSummary = kindLabel[sessionKind] + ' — ' + outcomeLabel[outcome] + '. جودة الرد الظاهر ' + serviceScore + '%، ' + commercialText + ' تغطية الدليل ' + evaluationCoverage + '% وثقة التحليل ' + confidence + '%. ' + (followupRequired ? 'المتابعة مطلوبة: ' + suggestedFollowupReason : 'لا توجد متابعة عاجلة مثبتة.') + ' ' + (missingMediaCount > 0 ? 'يوجد ' + missingMediaCount + ' مرفق غير متاح. ' : '') + (requiresHumanApproval ? 'لا يعتمد رسميًا قبل المراجعة البشرية.' : 'صالحة لمراجعة بشرية سريعة.');`
  },
  {
    label: 'return v5 quality metadata',
    from: `    version: 'whatsapp-review-v4',\n    outcome,`,
    to: `    version: 'whatsapp-review-v5',\n    sessionKind,\n    evaluationCoverage,\n    applicableDimensions: applicability.applicable,\n    notApplicableDimensions: applicability.notApplicable,\n    outcome,`
  }
]);

patchFile('src/lib/whatsappReviewPersistenceV4.ts', [
  {
    label: 'needs context status uses evidence coverage',
    from: `  if (intelligence.confidence < 60) return 'needs_context';`,
    to: `  if (intelligence.confidence < 60 || intelligence.evaluationCoverage < 50) return 'needs_context';`
  },
  {
    label: 'read prior analysis version for safe reanalysis',
    from: `.select('id, source_hash, review_status')`,
    to: `.select('id, source_hash, review_status, analysis_version, reviewer_confirmed, official_review_id')`
  },
  {
    label: 'reanalyze duplicate when engine version changes and no official approval exists',
    from: `  if (existing?.id) {\n    return { id: String(existing.id), duplicate: true, sourceHash, reviewStatus: (existing.review_status || reviewStatus) as ReviewQueueStatus };\n  }`,
    to: `  if (existing?.id) {\n    const canRefreshAnalysis = existing.analysis_version !== intelligence.version && !existing.reviewer_confirmed && !existing.official_review_id;\n    if (canRefreshAnalysis) {\n      const refreshedStaffName = context.staffName || session.outboundStaffNames[0] || null;\n      const refreshedCustomerName = context.customerName || session.customerName || null;\n      const refreshPatch = {\n        ...(context.customerId ? { customer_id: context.customerId } : {}),\n        ...(context.customerCode ? { customer_code: context.customerCode } : {}),\n        ...(refreshedCustomerName ? { customer_name: refreshedCustomerName } : {}),\n        ...(context.customerPhone ? { customer_phone: context.customerPhone } : {}),\n        ...(context.staffId ? { staff_id: context.staffId } : {}),\n        ...(refreshedStaffName ? { staff_name: refreshedStaffName } : {}),\n        analysis_version: intelligence.version,\n        analysis_status: intelligence.requiresHumanApproval ? 'needs_review' : 'analyzed',\n        review_status: reviewStatus,\n        priority: intelligence.priority,\n        analysis_confidence: intelligence.confidence,\n        service_score: intelligence.serviceScore,\n        commercial_score: intelligence.commercialScore,\n        commercial_eligible: intelligence.commercialEligible,\n        chat_suggested_sold: intelligence.chatSuggestedSold,\n        followup_required: intelligence.followupRequired,\n        suggested_followup_reason: intelligence.suggestedFollowupReason,\n        analysis_json: serializeIntelligence(intelligence),\n        raw_text: rawText,\n        updated_at: new Date().toISOString(),\n      };\n      const { error: refreshError } = await supabase.from('whatsapp_review_sources').update(refreshPatch).eq('id', existing.id);\n      if (refreshError) throw refreshError;\n      await appendWhatsAppReviewAudit(String(existing.id), 'analysis_refreshed', null, serializeIntelligence(intelligence), context.createdBy || null, null);\n    }\n    return { id: String(existing.id), duplicate: true, sourceHash, reviewStatus: (canRefreshAnalysis ? reviewStatus : existing.review_status || reviewStatus) as ReviewQueueStatus };\n  }`
  }
]);

console.log('[whatsapp-analysis-quality-v5] evidence-aware analysis quality hardening applied successfully');
