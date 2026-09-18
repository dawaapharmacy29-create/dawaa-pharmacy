const fs = require('fs');
const path = require('path');

function patchFile(rel, mutate) {
  const file = path.join(process.cwd(), rel);
  let src = fs.readFileSync(file, 'utf8');
  const next = mutate(src);
  if (next !== src) fs.writeFileSync(file, next);
}

function insertAfter(src, anchor, value, label) {
  if (src.includes(value.trim())) return src;
  if (!src.includes(anchor)) throw new Error(`[review-transcript-v1] ${label} anchor not found`);
  return src.replace(anchor, `${anchor}\n${value}`);
}

patchFile('src/pages/SmartConversationReviewRebuild.tsx', (source) => {
  let src = source;
  src = insertAfter(src, `import { useMemo, useState } from 'react';`, `import { useNavigate } from 'react-router-dom';`, 'smart navigate import');
  src = insertAfter(src, `import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';`, `import { buildConversationReviewSnapshot, writePendingConversationReviewTransfer } from '@/lib/conversationReviewTranscript';`, 'smart transcript import');

  const componentAnchor = `export default function SmartConversationReviewRebuild() {`;
  if (!src.includes('const navigate = useNavigate();')) {
    if (!src.includes(componentAnchor)) throw new Error('[review-transcript-v1] smart component anchor not found');
    src = src.replace(componentAnchor, `${componentAnchor}\n  const navigate = useNavigate();`);
  }

  const returnAnchor = `\n  return (\n    <div dir="rtl" className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">`;
  if (!src.includes('function openOfficialReview()')) {
    if (!src.includes(returnAnchor)) throw new Error('[review-transcript-v1] smart return anchor not found');
    const handler = `\n  function openOfficialReview() {\n    if (!selectedSession || !selectedStaff || !pipeline?.scope.valid || !pipeline.review || !decision) {\n      toast.error('اختر المسؤول والفترة الصحيحة قبل فتح التقييم الرسمي');\n      return;\n    }\n    const snapshot = buildConversationReviewSnapshot({\n      session: selectedSession,\n      displayMessages: pipeline.scope.displayMessages,\n      scoredMessageIds: pipeline.scope.inScopeMessageIds,\n      contextMessageIds: pipeline.scope.contextMessageIds,\n      evidenceMessageIds: decision.evidenceMessageIds,\n      staffName: selectedStaff.staffName,\n      staffRole: selectedStaff.role,\n      sourceFileName: fileName || null,\n      from: fromValue ? new Date(fromValue) : null,\n      to: toValue ? new Date(toValue) : null,\n      decision,\n    });\n    writePendingConversationReviewTransfer(snapshot);\n    navigate('/reviews?mode=new&fromSmart=1');\n  }\n`;
    src = src.replace(returnAnchor, `${handler}${returnAnchor}`);
  }

  const criteriaAnchor = `{decision.affectedCriteria.length ? <div className="mt-3 flex flex-wrap gap-2">{decision.affectedCriteria.map((item) => <span key={item} className="rounded-full bg-black/20 px-2.5 py-1 text-xs text-white">{criteriaLabels[item] || item}</span>)}</div> : null}`;
  if (!src.includes('نقل المحادثة إلى التقييم الرسمي')) {
    if (!src.includes(criteriaAnchor)) throw new Error('[review-transcript-v1] smart decision anchor not found');
    src = src.replace(criteriaAnchor, `${criteriaAnchor}\n          {selectedStaff && pipeline?.scope.valid ? <div className="mt-4"><button type="button" onClick={openOfficialReview} className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">نقل المحادثة إلى التقييم الرسمي</button><div className="mt-1 text-xs text-slate-400">سيتم نقل الرسائل داخل النطاق مع رسائل السياق والدليل، بدون اعتماد درجة تلقائيًا.</div></div> : null}`);
  }
  return src;
});

patchFile('src/pages/Reviews.tsx', (source) => {
  let src = source;
  src = insertAfter(src, `import { useDebounce } from '@/hooks/useDebounce';`, `import ConversationReviewTranscriptCard from '@/components/reviews/ConversationReviewTranscriptCard';\nimport { clearPendingConversationReviewTransfer, readPendingConversationReviewTransfer, type ConversationReviewSnapshot } from '@/lib/conversationReviewTranscript';`, 'reviews imports');

  const formAnchor = `  const [form, setForm] = useState(() => ({\n    ...emptyReviewForm,\n    reviewerId: user?.id || '',\n    conversationDate: isoInputNow(),\n  }));`;
  if (!src.includes('pendingConversationSnapshot')) {
    if (!src.includes(formAnchor)) throw new Error('[review-transcript-v1] reviews form state anchor not found');
    src = src.replace(formAnchor, `${formAnchor}\n  const [pendingConversationSnapshot, setPendingConversationSnapshot] = useState<ConversationReviewSnapshot | null>(null);\n  useEffect(() => {\n    const pending = readPendingConversationReviewTransfer();\n    if (!pending) return;\n    setPendingConversationSnapshot(pending);\n    setForm((current) => ({ ...current, evaluationKind: 'واتساب' }));\n  }, []);`);
  }

  if (!src.includes('title="المحادثة محل التقييم"')) {
    const dataSectionRx = /(^\s*<section[^\n>]*>\s*\n\s*<div[^\n>]*>بيانات المحادثة<\/div>)/m;
    const match = src.match(dataSectionRx);
    if (!match) {
      console.warn('[review-transcript-v1] reviews conversation data anchor not found; transcript card render skipped');
    } else {
      src = src.replace(match[0], `          {pendingConversationSnapshot ? <ConversationReviewTranscriptCard snapshot={pendingConversationSnapshot} title="المحادثة محل التقييم" defaultOpen /> : null}\n\n${match[0]}`);
    }
  }

  if (!src.includes(`conversation_snapshot: pendingConversationSnapshot`)) {
    const createRawRx = /(raw_scores\s*:\s*\{\s*\n\s*)(criteria\s*:\s*selectedChoices\s*,)/m;
    if (!createRawRx.test(src)) {
      console.warn('[review-transcript-v1] create raw_scores anchor not found; smart transcript persistence on create skipped');
    } else {
      src = src.replace(createRawRx, `$1conversation_snapshot: pendingConversationSnapshot,\n          $2`);
    }
  }

  if (!src.includes(`conversation_snapshot: normalizeRawScores(editingReview.raw_scores)?.conversation_snapshot || null`)) {
    const editRawRx = /(raw_scores\s*:\s*\{\s*\n\s*)(criteria\s*:\s*editReviewState\s*,)/m;
    if (!editRawRx.test(src)) {
      console.warn('[review-transcript-v1] edit raw_scores anchor not found; existing transcript preservation on edit skipped');
    } else {
      src = src.replace(editRawRx, `$1conversation_snapshot: normalizeRawScores(editingReview.raw_scores)?.conversation_snapshot || null,\n          $2`);
    }
  }

  const saveClearAnchor = `      try {\n        window.localStorage.removeItem(REVIEW_DRAFT_KEY);\n        setDraftSavedAt(null);\n      } catch {}`;
  if (!src.includes('clearPendingConversationReviewTransfer();\n        setPendingConversationSnapshot(null);')) {
    if (!src.includes(saveClearAnchor)) { console.warn('[review-transcript-v1] save clear anchor not found'); return src; }
    src = src.replace(saveClearAnchor, `      try {\n        window.localStorage.removeItem(REVIEW_DRAFT_KEY);\n        clearPendingConversationReviewTransfer();\n        setPendingConversationSnapshot(null);\n        setDraftSavedAt(null);\n      } catch {}`);
  }

  const newClearAnchor = `    window.localStorage.removeItem(REVIEW_DRAFT_KEY);\n    toast.success('تم فتح تقييم جديد');`;
  if (!src.includes(`clearPendingConversationReviewTransfer();\n    setPendingConversationSnapshot(null);\n    toast.success('تم فتح تقييم جديد');`)) {
    if (!src.includes(newClearAnchor)) { console.warn('[review-transcript-v1] new review clear anchor not found'); return src; }
    src = src.replace(newClearAnchor, `    window.localStorage.removeItem(REVIEW_DRAFT_KEY);\n    clearPendingConversationReviewTransfer();\n    setPendingConversationSnapshot(null);\n    toast.success('تم فتح تقييم جديد');`);
  }
  return src;
});

patchFile('src/pages/ConversationReviewDetailsFast.tsx', (source) => {
  let src = source;
  src = insertAfter(src, `import { toNumber } from '@/lib/utils';`, `import ConversationReviewTranscriptCard from '@/components/reviews/ConversationReviewTranscriptCard';`, 'fast detail import');
  const anchor = `      <section className="dawaa-card p-4 space-y-3">\n        <div className="font-black text-lg">كل بنود التقييم</div>`;
  if (!src.includes('title="المحادثة التي بُني عليها التقييم"')) {
    if (!src.includes(anchor)) { console.warn('[review-transcript-v1] fast detail render anchor not found'); return src; }
    src = src.replace(anchor, `      <ConversationReviewTranscriptCard reviewRow={row} title="المحادثة التي بُني عليها التقييم" defaultOpen />\n\n${anchor}`);
  }
  return src;
});

patchFile('src/components/doctor/DoctorReviewDetails.tsx', (source) => {
  let src = source;
  src = insertAfter(src, `import { getCurrentCycle, getCycleForDate, isDateInCycle, type PharmacyCycle } from '@/lib/pharmacy-cycle';`, `import ConversationReviewTranscriptCard from '@/components/reviews/ConversationReviewTranscriptCard';`, 'doctor detail import');
  const anchor = `          {text(row.reviewer_message) ? <div className="rounded-2xl border border-teal-400/30 bg-teal-500/10 p-4"><div className="font-black text-teal-100">رسالة دكتورة خدمة العملاء لك</div>`;
  if (!src.includes('title="المحادثة التي تم تقييمك عليها"')) {
    if (!src.includes(anchor)) { console.warn('[review-transcript-v1] doctor transcript anchor not found'); return src; }
    src = src.replace(anchor, `          <ConversationReviewTranscriptCard reviewRow={row} title="المحادثة التي تم تقييمك عليها" defaultOpen={false} />\n\n${anchor}`);
  }
  return src;
});

console.log('[review-transcript-v1] conversation transcript persistence + evaluator + doctor learning view wired');
