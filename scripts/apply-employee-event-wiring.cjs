const fs = require('fs');
const path = require('path');

function patchFile(relativePath, replacements) {
  const filePath = path.join(process.cwd(), relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(filePath, source);
}

patchFile('src/lib/pointsPersistence.ts', [
  {
    label: 'points event import',
    before: `import { sameEventDeductionGuard } from '@/lib/incentives/incentiveRulesEngine';`,
    after: `import { sameEventDeductionGuard } from '@/lib/incentives/incentiveRulesEngine';\nimport { recordEmployeeEvent } from '@/lib/employeeEventService';`,
  },
  {
    label: 'points event record on update',
    before: `      return { error: null, id: existingRows[0].id as string };`,
    after: `      await recordEmployeeEvent({\n        subjectStaffId: input.employeeId, subjectName: input.employeeName, actorUserId: input.createdById, actorName: input.createdByName, actorRole: input.createdByRole, branch: input.branch,\n        category: signedDelta >= 0 ? 'reward' : 'deduction', eventType: 'points_transaction_updated', title: signedDelta >= 0 ? 'تم تحديث مكافأة أو نقاط' : 'تم تحديث خصم أو نقاط',\n        description: reason + ' — ' + (description || input.userNote || ''), sourceTable: TABLES.employeeTransactions, sourceId: existingRows[0].id as string, route: '/doctor-dashboard?tab=payroll',\n        pointsDelta: signedDelta, priority: signedDelta < 0 ? 'high' : 'normal', metadata: { status: input.status, source, rule_code: ruleCode },\n      });\n      return { error: null, id: existingRows[0].id as string };`,
  },
  {
    label: 'points event record on insert',
    before: `  return { error: null, id: transaction.data?.id as string | undefined };`,
    after: `  const transactionId = transaction.data?.id as string | undefined;\n  await recordEmployeeEvent({\n    subjectStaffId: input.employeeId, subjectName: input.employeeName, actorUserId: input.createdById, actorName: input.createdByName, actorRole: input.createdByRole, branch: input.branch,\n    category: signedDelta >= 0 ? 'reward' : 'deduction', eventType: signedDelta >= 0 ? 'points_reward_added' : 'points_deduction_added', title: signedDelta >= 0 ? 'تم إضافة نقاط أو مكافأة' : 'تم تسجيل خصم أو جزاء',\n    description: reason + ' — ' + (description || input.userNote || ''), sourceTable: TABLES.employeeTransactions, sourceId: transactionId || input.sourceRecordId || null, route: '/doctor-dashboard?tab=payroll',\n    pointsDelta: signedDelta, priority: signedDelta < 0 ? 'high' : 'normal', requiresAction: input.status === 'pending', metadata: { status: input.status, source, rule_code: ruleCode },\n  });\n  return { error: null, id: transactionId };`,
  },
]);

patchFile('src/pages/Reviews.tsx', [
  {
    label: 'review event import',
    before: `import { notifyEmployee } from '@/lib/notificationService';`,
    after: `import { notifyEmployee } from '@/lib/notificationService';\nimport { recordEmployeeEvent } from '@/lib/employeeEventService';`,
  },
  {
    label: 'review event record',
    before: `      try {\n        await notifyEmployee({`,
    after: `      try {\n        await recordEmployeeEvent({\n          subjectStaffId: selectedStaff.id, subjectName: selectedStaff.name, actorUserId: currentUserProfile.id, actorName: currentUserProfile.name, actorRole: currentUserProfile.role, branch: selectedStaff.branch,\n          category: 'conversation_review', eventType: 'conversation_review_created', title: result.finalScore < 70 ? 'تقييم محادثة يحتاج مراجعة' : 'تم تسجيل تقييم محادثة جديد',\n          description: \`النتيجة \${result.finalScore}/100. \${result.mainPositiveReason || ''} \${result.mainNegativeReason || finalTraining || ''}\`.trim(),\n          sourceTable: 'conversation_sales_reviews', sourceId: reviewRowId || null, route: reviewRowId ? \`/doctor-dashboard?tab=reviews&review_id=\${reviewRowId}\` : '/doctor-dashboard?tab=reviews',\n          pointsDelta: repeatedDoctorImpact, priority: result.finalScore < 70 ? 'high' : 'normal', requiresAction: result.finalScore < 70, notify: false,\n          metadata: { score: result.finalScore, positive_note: result.mainPositiveReason, improvement_note: result.mainNegativeReason, training: finalTraining },\n        });\n        await notifyEmployee({`,
  },
  {
    label: 'review personal route',
    before: `          target_route: reviewRowId ? \`/reviews?id=\${reviewRowId}\` : '/reviews',`,
    after: `          target_route: reviewRowId ? \`/doctor-dashboard?tab=reviews&review_id=\${reviewRowId}\` : '/doctor-dashboard?tab=reviews',`,
  },
]);

patchFile('src/pages/TimeOff.tsx', [
  {
    label: 'timeoff event import',
    before: `import { canonicalMaxPoints, canonicalSnapshotPoints } from '@/lib/pointsLedger';`,
    after: `import { canonicalMaxPoints, canonicalSnapshotPoints } from '@/lib/pointsLedger';\nimport { recordEmployeeEvent } from '@/lib/employeeEventService';`,
  },
  {
    label: 'timeoff event record',
    before: `    setSaving(false);\n    toast.success(form.deduct_points ? 'تم حفظ الإذن وتسجيل خصم النقاط.' : 'تم حفظ الإذن/الإجازة بدون خصم نقاط.');`,
    after: `    await recordEmployeeEvent({\n      subjectStaffId: selectedStaff.id, subjectName: selectedStaff.name, actorUserId: getSafeCurrentUserId() ?? null, actorName: user?.name || 'الإدارة', actorRole: user?.role || null, branch: selectedStaff.branch,\n      category: isLeaveType ? 'leave' : isHourlyPermission ? 'permission' : form.type.includes('غياب') ? 'attendance' : 'system', eventType: editingId ? 'time_off_updated' : 'time_off_created',\n      title: editingId ? 'تم تعديل طلب إذن أو إجازة' : 'تم تسجيل طلب إذن أو إجازة', description: \`\${form.type} — \${finalStatus} — \${finalReason}\`,\n      sourceTable: TABLES.shiftExceptions, sourceId: editingId || null, route: '/doctor-dashboard?tab=payroll', pointsDelta: form.deduct_points ? -deductionPoints : 0, priority: form.type.includes('غياب') ? 'high' : 'normal',\n      requiresAction: finalStatus === 'pending', metadata: { date: form.date, date_end: form.date_end, duration_hours: calculatedHours, status: finalStatus },\n    });\n    setSaving(false);\n    toast.success(form.deduct_points ? 'تم حفظ الإذن وتسجيل خصم النقاط.' : 'تم حفظ الإذن/الإجازة بدون خصم نقاط.');`,
  },
]);

console.log('[employee-event-wiring] applied');
