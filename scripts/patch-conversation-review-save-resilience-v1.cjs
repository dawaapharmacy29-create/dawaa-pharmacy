const fs = require('fs');
const path = 'src/pages/Reviews.tsx';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!s.includes(from)) throw new Error(`pattern not found: ${label}`);
  s = s.replace(from, to);
}

replaceOnce(
`    const ins = await supabase.from(table).insert(currentPayload).select('id').single();\n    if (!ins.error) return { id: ins.data?.id as string | undefined, removedColumns };\n    const missing = missingColumnName(ins.error.message);`,
`    const ins = await supabase.from(table).insert(currentPayload).select('id').single();\n    if (!ins.error) return { id: ins.data?.id as string | undefined, removedColumns, reusedExisting: false };\n\n    // لو حصل retry بعد إن السيرفر حفظ التقييم لكن المتصفح ما استلمش الرد،\n    // رجّع نفس الصف بدل ما نعتبره خطأ أو نكرر التقييم/النقاط.\n    if (table === 'conversation_sales_reviews' && ins.error.code === '23505') {\n      const staffName = String(currentPayload.staff_name || '');\n      const reviewerName = String(currentPayload.reviewer_name || '');\n      const conversationDate = currentPayload.conversation_date as string | null | undefined;\n      const customerName = currentPayload.customer_name as string | null | undefined;\n      let query = supabase\n        .from(table)\n        .select('id')\n        .eq('staff_name', staffName)\n        .eq('reviewer_name', reviewerName)\n        .eq('conversation_date', conversationDate || '');\n      query = customerName == null ? query.is('customer_name', null) : query.eq('customer_name', customerName);\n      const existing = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();\n      if (!existing.error && existing.data?.id) {\n        return { id: String(existing.data.id), removedColumns, reusedExisting: true };\n      }\n    }\n\n    const missing = missingColumnName(ins.error.message);`,
'insertSafe duplicate recovery'
);

replaceOnce(
`  const [saving, setSaving] = useState(false);`,
`  const [saving, setSaving] = useState(false);\n  const saveInFlightRef = useRef(false);`,
'save in-flight ref'
);

replaceOnce(
`    setSaving(true);\n    try {`,
`    if (saveInFlightRef.current) {\n      toast.info('جاري حفظ التقييم بالفعل...');\n      return false;\n    }\n    saveInFlightRef.current = true;\n    setSaving(true);\n    try {`,
'save guard'
);

// Only replace the first save() finally, not edit/manager saves.
replaceOnce(
`    } finally {\n      setSaving(false);\n    }\n  };\n\n  const startNewReview = () => {`,
`    } finally {\n      saveInFlightRef.current = false;\n      setSaving(false);\n    }\n  };\n\n  const startNewReview = () => {`,
'save guard release'
);

replaceOnce(
`      const reviewRowId = ins.id;\n      if (ins.removedColumns.length) {`,
`      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);\n      if (reusedExistingReview) {\n        console.info('[reviews] recovered existing review after duplicate/retry', reviewRowId);\n      }\n      if (ins.removedColumns.length) {`,
'reused existing marker'
);

const startMarker = `      // نمط متكرر: لو نفس نوع الخطأ اتكرر لنفس الدكتور في نفس الدورة (مش أول مرة)،`;
const pointsMarker = `      if (repeatedDoctorImpact !== 0) {`;
const start = s.indexOf(startMarker);
const points = s.indexOf(pointsMarker, start);
if (start < 0 || points < 0) throw new Error('coaching block markers not found');
const coachingBlock = s.slice(start, points);
s = s.slice(0, start) + s.slice(points);

const currentUserMarker = `      const currentUserProfile = getCurrentUserProfile();`;
const currentUserPos = s.indexOf(currentUserMarker, points - coachingBlock.length);
if (currentUserPos < 0) throw new Error('post save marker not found');
s = s.slice(0, currentUserPos) + coachingBlock + '\n' + s.slice(currentUserPos);

const postStart = s.indexOf(currentUserMarker);
const postEndMarker = `      try {\n        window.localStorage.removeItem(REVIEW_DRAFT_KEY);`;
const postEnd = s.indexOf(postEndMarker, postStart);
if (postStart < 0 || postEnd < 0) throw new Error('post-save region markers not found');

const replacement = `      const currentUserProfile = getCurrentUserProfile();\n\n      // الحفظ الأساسي + أثر النقاط خلصوا هنا. باقي الأعمال تحسينات لاحقة لا ينبغي\n      // أن تجمّد زر الحفظ أو تعطل الموظف عن بدء تقييم جديد.\n      const postSaveTasks: Promise<unknown>[] = [];\n      postSaveTasks.push(\n        logActivity(\n          currentUserProfile.id,\n          currentUserProfile.name,\n          'تقييم محادثة',\n          'تقييم المحادثات',\n          \`درجة \${result.finalScore}/100 - \${selectedStaff.name}\`,\n          selectedStaff.branch || '',\n          {\n            user_role: currentUserProfile.role,\n            target_type: 'conversation_review',\n            target_id: reviewRowId || '',\n          }\n        )\n      );\n      postSaveTasks.push(\n        notifyEmployee({\n          title: result.finalScore < 70 ? 'تقييم محادثة يحتاج مراجعة' : 'تم حفظ تقييم محادثة',\n          message:\n            result.finalScore < 70\n              ? \`درجتك \${result.finalScore}/100. يرجى مراجعة التقييم لتجنب تكرار الخطأ.\`\n              : \`تقييم المحادثة \${result.finalScore}/100. \${result.finalScore >= 90 ? 'أداء ممتاز.' : 'راجع الملاحظات للتحسين.'}\`,\n          type: 'conversation_review',\n          priority: result.finalScore < 70 ? 'high' : 'normal',\n          recipient_staff_id: selectedStaff.id,\n          branch: selectedStaff.branch,\n          target_type: 'conversation_review',\n          target_id: reviewRowId || '',\n          target_route: reviewRowId\n            ? \`/doctor-dashboard?tab=reviews&reviewId=\${reviewRowId}\`\n            : '/doctor-dashboard?tab=reviews',\n          requires_action: result.finalScore < 70,\n          created_by: currentUserProfile.id,\n          created_by_name: currentUserProfile.name,\n          metadata: {\n            staff_name: selectedStaff.name,\n            score: result.finalScore,\n            points_impact: repeatedDoctorImpact,\n            positive_note: result.mainPositiveReason,\n            improvement_note: result.mainNegativeReason,\n          },\n        })\n      );\n\n      if (result.finalScore < 70 && (form.customerName || form.customerPhone || form.customerCode)) {\n        postSaveTasks.push(\n          insertSafe('followups', {\n            customer_id: form.customerId || null,\n            customer_name: form.customerName || 'عميل يحتاج متابعة جودة',\n            customer_phone: form.customerPhone || null,\n            customer_code: form.customerCode || null,\n            branch: selectedStaff.branch || null,\n            followup_status: 'pending',\n            status: 'pending',\n            priority: result.hasSevereError ? 'عاجل' : 'مهم',\n            followup_reason: 'تقييم محادثة سلبي يحتاج متابعة',\n            followup_summary: \`تقييم محادثة \${result.finalScore}/100 بواسطة \${currentUserProfile.name}. \${result.mainNegativeReason || finalTraining}\`,\n            assigned_staff_id: selectedStaff.id,\n            responsible_name: selectedStaff.name,\n            source: 'conversation_review',\n            source_record_id: reviewRowId || null,\n            created_by: currentUserProfile.id,\n            created_by_name: currentUserProfile.name,\n            created_at: new Date().toISOString(),\n          })\n        );\n      }\n\n      if (!newOnlyMode) postSaveTasks.push(loadReviewHistory());\n\n      void Promise.allSettled(postSaveTasks).then((results) => {\n        const failed = results.filter((item) => item.status === 'rejected');\n        if (failed.length) console.warn('[reviews] non-critical post-save tasks failed', failed);\n      });\n\n`;

s = s.slice(0, postStart) + replacement + s.slice(postEnd);

replaceOnce(
`      toast.success('تم حفظ تقييم المحادثة وتحديث سجل التقييمات بنجاح');`,
`      toast.success(\n        reusedExistingReview\n          ? 'التقييم كان محفوظًا بالفعل وتم استكمال الربط بدون تكرار'\n          : 'تم حفظ تقييم المحادثة وتأثير النقاط بنجاح'\n      );`,
'success message'
);

fs.writeFileSync(path, s);
console.log('patched Reviews.tsx for resilient/fast save');
