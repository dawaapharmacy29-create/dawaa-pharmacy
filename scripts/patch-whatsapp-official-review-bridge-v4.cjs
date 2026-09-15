const fs = require('fs');
const path = require('path');

const reviewsFile = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let reviews = fs.readFileSync(reviewsFile, 'utf8');

function patchReviews(label, from, to) {
  if (reviews.includes(to)) {
    console.log(`[whatsapp-review-bridge-v4] ${label}: already applied`);
    return;
  }
  if (!reviews.includes(from)) throw new Error(`[whatsapp-review-bridge-v4] ${label}: anchor not found in Reviews.tsx`);
  reviews = reviews.replace(from, to);
  console.log(`[whatsapp-review-bridge-v4] ${label}: applied`);
}

patchReviews(
  'bridge imports',
  `import { useDebounce } from '@/hooks/useDebounce';`,
  `import { useDebounce } from '@/hooks/useDebounce';\nimport { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';\nimport { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';\nimport { confirmWhatsAppReviewQueueItem } from '@/lib/whatsappReviewPersistenceV4';`
);

patchReviews(
  'bridge state',
  `  const [managerReviewTarget, setManagerReviewTarget] =\n    useState<ConversationReviewHistoryRow | null>(null);`,
  `  const [managerReviewTarget, setManagerReviewTarget] =\n    useState<ConversationReviewHistoryRow | null>(null);\n  const whatsappSourceId = String(searchParams.get('waSource') || '').trim();\n  const [whatsappSourceLoading, setWhatsappSourceLoading] = useState(false);\n  const [whatsappUnresolvedKeys, setWhatsappUnresolvedKeys] = useState<ReviewCriterionKey[]>([]);\n  const whatsappSourceLoadedRef = useRef<string | null>(null);`
);

const prefillEffect = `\n  useEffect(() => {\n    if (!newOnlyMode || !whatsappSourceId || whatsappSourceLoadedRef.current === whatsappSourceId) return;\n    if (!staffOptions.length) return;\n    let cancelled = false;\n    setWhatsappSourceLoading(true);\n    void (async () => {\n      try {\n        const { data, error } = await supabase\n          .from('whatsapp_review_sources')\n          .select('id,branch,customer_id,customer_code,customer_name,customer_phone,staff_id,staff_name,raw_text,conversation_started_at,invoice_match_status,matched_invoice_number,commercial_eligible,chat_suggested_sold,official_review_id')\n          .eq('id', whatsappSourceId)\n          .maybeSingle();\n        if (error) throw error;\n        if (!data) throw new Error('لم يتم العثور على جلسة واتساب المطلوبة');\n        if (data.official_review_id) {\n          if (!cancelled) {\n            toast.info('الجلسة مرتبطة بالفعل بتقييم رسمي؛ تم فتح التقييم الموجود');\n            navigate(\`/reviews?section=history&id=\${encodeURIComponent(String(data.official_review_id))}\`, { replace: true });\n          }\n          return;\n        }\n        const rawText = String(data.raw_text || '');\n        const parsed = splitWhatsAppSessions(parseWhatsAppExport(rawText), 120);\n        const session = parsed[0];\n        if (!session) throw new Error('تعذر إعادة بناء جلسة واتساب من النص المحفوظ');\n        const suggestion = buildOfficialReviewSuggestion(session, data.customer_name || session.customerName);\n        const nextState = defaultReviewState();\n        const unresolved = [];\n        for (const item of suggestion.items) {\n          const key = item.key;\n          if (!nextState[key]) continue;\n          if (item.status === 'assessed' && item.selectedOption) {\n            nextState[key] = { applies: true, choice: item.selectedOption, notes: \`AI V4: \${item.reason}\` };\n          } else if (item.status === 'not_applicable') {\n            nextState[key] = { ...nextState[key], applies: false, notes: \`AI V4: \${item.reason}\` };\n          } else {\n            unresolved.push(key);\n            nextState[key] = { ...nextState[key], notes: \`⚠️ يحتاج مراجعة بشرية — \${item.reason}\` };\n          }\n        }\n        const normalize = (value) => normalizeArabicName(String(value || ''));\n        const branchName = normalizeBranchName(String(data.branch || ''));\n        const staffMatch = staffOptions.find((row) => {\n          const idMatch = data.staff_id && String(row.id) === String(data.staff_id);\n          const nameMatch = data.staff_name && normalize(row.name) === normalize(data.staff_name);\n          const branchMatch = !branchName || normalizeBranchName(row.branch || '') === branchName;\n          return (idMatch || nameMatch) && branchMatch;\n        }) || staffOptions.find((row) => data.staff_name && normalize(row.name) === normalize(data.staff_name));\n        const firstInbound = session.messages.find((m) => m.direction === 'inbound');\n        const firstOutbound = firstInbound\n          ? session.messages.find((m) => m.direction === 'outbound' && m.timestamp >= firstInbound.timestamp)\n          : session.messages.find((m) => m.direction === 'outbound');\n        if (branchName) setTargetBranch(branchName);\n        setReviewState(nextState);\n        setSevereErrors(defaultSevereErrors());\n        setWhatsappUnresolvedKeys(unresolved);\n        setForm((current) => ({\n          ...current,\n          reviewerId: user?.id || '',\n          staffId: staffMatch?.id || '',\n          customerId: String(data.customer_id || ''),\n          customerCode: String(data.customer_code || ''),\n          customerName: String(data.customer_name || session.customerName || ''),\n          customerPhone: String(data.customer_phone || ''),\n          evaluationKind: 'واتساب',\n          evaluationReason: 'متابعة جودة',\n          invoiceNo: String(data.matched_invoice_number || ''),\n          convertedToSale: data.invoice_match_status === 'verified' ? 'yes' : '',\n          conversationDate: session.startedAt ? new Date(session.startedAt.getTime() - session.startedAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : isoInputNow(),\n          firstCustomerMessageAt: firstInbound ? new Date(firstInbound.timestamp.getTime() - firstInbound.timestamp.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',\n          firstStaffReplyAt: firstOutbound ? new Date(firstOutbound.timestamp.getTime() - firstOutbound.timestamp.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',\n          notes: \`WhatsApp Review V4 • Queue \${whatsappSourceId}\`,\n          reviewerNotes: \`تم تجهيز التقييم آليًا من Export واتساب. البنود غير المحسومة: \${unresolved.length}. ثقة الاقتراح: \${suggestion.confidence}%، تغطية آلية: \${suggestion.coveragePercent}%.\`,\n        }));\n        setCustSearch(String(data.customer_name || data.customer_code || data.customer_phone || ''));\n        whatsappSourceLoadedRef.current = whatsappSourceId;\n        if (!cancelled) toast.success(\`تم تجهيز التقييم من واتساب: \${suggestion.assessedCount} بند مقترح، \${unresolved.length} يحتاج مراجعة\`);\n      } catch (error) {\n        if (!cancelled) toast.error(error instanceof Error ? error.message : 'تعذر تجهيز التقييم من Queue');\n      } finally {\n        if (!cancelled) setWhatsappSourceLoading(false);\n      }\n    })();\n    return () => { cancelled = true; };\n  }, [newOnlyMode, whatsappSourceId, staffOptions, user?.id, navigate]);\n`;

patchReviews(
  'prefill official review from queue',
  `  const canEditReviews = checkPermission('edit_reviews');`,
  prefillEffect + `\n  const canEditReviews = checkPermission('edit_reviews');`
);

patchReviews(
  'mark unresolved criterion reviewed on applies',
  `  const setCriterionApplies = (key: ReviewCriterionKey, applies: boolean) => {\n    setReviewState((current) => ({ ...current, [key]: { ...current[key], applies } }));\n  };`,
  `  const markWhatsappCriterionReviewed = (key: ReviewCriterionKey) => {\n    if (!whatsappSourceId) return;\n    setWhatsappUnresolvedKeys((current) => current.filter((item) => item !== key));\n  };\n\n  const setCriterionApplies = (key: ReviewCriterionKey, applies: boolean) => {\n    markWhatsappCriterionReviewed(key);\n    setReviewState((current) => ({ ...current, [key]: { ...current[key], applies } }));\n  };`
);

patchReviews(
  'mark unresolved criterion reviewed on choice',
  `  const setCriterionChoice = (key: ReviewCriterionKey, choice: string) => {\n    setReviewState((current) => ({ ...current, [key]: { ...current[key], choice } }));\n  };`,
  `  const setCriterionChoice = (key: ReviewCriterionKey, choice: string) => {\n    markWhatsappCriterionReviewed(key);\n    setReviewState((current) => ({ ...current, [key]: { ...current[key], choice } }));\n  };`
);

patchReviews(
  'block official save until unresolved reviewed',
  `    if (saveInFlightRef.current) {\n      toast.info('جاري حفظ التقييم بالفعل...');\n      return false;\n    }`,
  `    if (whatsappSourceId && whatsappUnresolvedKeys.length > 0) {\n      toast.error(\`راجع البنود غير المحسومة أولًا (متبقي \${whatsappUnresolvedKeys.length})\`);\n      return false;\n    }\n\n    if (saveInFlightRef.current) {\n      toast.info('جاري حفظ التقييم بالفعل...');\n      return false;\n    }`
);

patchReviews(
  'link official review after save',
  `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);`,
  `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);\n      if (whatsappSourceId && reviewRowId) {\n        try {\n          await confirmWhatsAppReviewQueueItem(whatsappSourceId, {\n            officialReviewId: reviewRowId,\n            reviewerId: String(user?.id || user?.staffId || ''),\n            reviewerName: String(user?.name || user?.username || ''),\n            approved: true,\n          });\n        } catch (queueError) {\n          console.warn('[reviews] official review saved but queue link failed', queueError);\n          toast.warning('تم حفظ التقييم الرسمي، لكن تعذر تحديث حالة Queue تلقائيًا');\n        }\n      }\n      const reusedExistingReview = Boolean(ins.reusedExisting);`
);

const bridgeBanner = `\n        {whatsappSourceId ? (\n          <div className="mb-4 rounded-2xl border border-violet-400/30 bg-violet-500/10 p-4">\n            <div className="font-black text-violet-100">تقييم قادم من WhatsApp Review V4</div>\n            <div className="mt-1 text-xs leading-6 text-violet-100/80">\n              تم ملء البنود القابلة للإثبات آليًا فقط. {whatsappSourceLoading ? 'جاري تجهيز البيانات...' : whatsappUnresolvedKeys.length ? \`متبقي \${whatsappUnresolvedKeys.length} بند يحتاج قرارك قبل السماح بالحفظ.\` : 'كل البنود غير المحسومة تمت مراجعتها ويمكن الحفظ.'}\n            </div>\n          </div>\n        ) : null}\n`;

patchReviews(
  'whatsapp bridge banner',
  `      {newOnlyMode ? (\n        <section className="space-y-4">`,
  `      {newOnlyMode ? (\n        <section className="space-y-4">` + bridgeBanner
);

fs.writeFileSync(reviewsFile, reviews);

const queueFile = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let queue = fs.readFileSync(queueFile, 'utf8');
function patchQueue(label, from, to) {
  if (queue.includes(to)) { console.log(`[whatsapp-review-bridge-v4] queue ${label}: already applied`); return; }
  if (!queue.includes(from)) throw new Error(`[whatsapp-review-bridge-v4] queue ${label}: anchor not found`);
  queue = queue.replace(from, to);
  console.log(`[whatsapp-review-bridge-v4] queue ${label}: applied`);
}
patchQueue(
  'navigation import',
  `import { useAuth } from '@/hooks/useAuth';`,
  `import { useAuth } from '@/hooks/useAuth';\nimport { useNavigate } from 'react-router-dom';`
);
patchQueue(
  'navigate hook',
  `export default function WhatsAppReviewQueueV4() {\n  const { user } = useAuth();`,
  `export default function WhatsAppReviewQueueV4() {\n  const { user } = useAuth();\n  const navigate = useNavigate();`
);
const reviewAction = `\n            <section className="dawaa-card dawaa-card--raised p-4">\n              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">\n                <div>\n                  <div className="font-black text-white">الاعتماد الرسمي</div>\n                  <div className="mt-1 text-xs leading-6 text-slate-400">يفتح نموذج التقييم الرسمي محمّلًا باقتراحات V4. لن يُسمح بالحفظ قبل مراجعة البنود غير المحسومة.</div>\n                </div>\n                <button\n                  type="button"\n                  disabled={selected.review_status === 'approved'}\n                  onClick={() => navigate(\`/reviews?mode=new&waSource=\${encodeURIComponent(selected.id)}\`)}\n                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-2.5 text-sm font-black text-emerald-100 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-45"\n                >\n                  {selected.review_status === 'approved' ? 'تم اعتماد التقييم ✓' : 'مراجعة واعتماد التقييم'}\n                </button>\n              </div>\n            </section>\n`;
patchQueue(
  'official review action',
  `            <section className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4 text-xs leading-6 text-cyan-100"><CheckCircle2 size={16} className="ml-2 inline"/>المستخدم الحالي: {String(user?.name || user?.username || 'غير محدد')}. زر الاعتماد النهائي سيظهر بعد إنشاء التقييم الرسمي وربطه بهذه الجلسة؛ لن يتم اعتماد Queue بدون سجل تقييم رسمي.</section>`,
  reviewAction + `            <section className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4 text-xs leading-6 text-cyan-100"><CheckCircle2 size={16} className="ml-2 inline"/>المستخدم الحالي: {String(user?.name || user?.username || 'غير محدد')}. Queue لا تُعتمد إلا بعد نجاح حفظ سجل التقييم الرسمي وربطه بهذه الجلسة.</section>`
);
fs.writeFileSync(queueFile, queue);
console.log('[whatsapp-review-bridge-v4] official review bridge applied successfully');
