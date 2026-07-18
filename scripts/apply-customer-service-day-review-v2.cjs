const fs = require('node:fs');

const filePath = 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx';
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) throw new Error(`customer service day review patch missing: ${label}`);
  source = source.replace(search, replacement);
}

replaceOnce(
  `} from '@/lib/customerServiceDailyExecution';`,
  `} from '@/lib/customerServiceDailyExecution';\nimport { saveCustomerServiceDailyReview } from '@/lib/customerServiceDailyReview';`,
  'review import'
);

replaceOnce(
  `  function copyScript(item: QueueItem) {`,
  `  const operationalSummary = useMemo(() => {\n    const completed = queue.filter((item) => item.completed).length;\n    const remaining = Math.max(0, queue.length - completed);\n    const noAnswer = allFollowups.filter((row) => String(row.date || row.followup_date || '').slice(0, 10) === todayIso() && resultOf(row) === 'لم يرد').length;\n    const scheduled = allFollowups.filter((row) => String(row.next_followup_date || '').slice(0, 10) >= todayIso() && !isCompleted(row)).length;\n    const needsManager = allFollowups.filter((row) => row.needs_manager && !isCompleted(row)).length;\n    const purchases = allFollowups.filter((row) => String(row.completed_at || row.updated_at || row.followup_date || row.date || '').slice(0, 10) === todayIso() && (row.purchase_after_followup || rowNumber(row, 'purchase_amount') > 0));\n    return {\n      total: queue.length,\n      completed,\n      remaining,\n      noAnswer,\n      scheduled,\n      needsManager,\n      purchaseCount: purchases.length,\n      purchaseAmount: purchases.reduce((sum, row) => sum + rowNumber(row, 'purchase_amount'), 0),\n      rate: queue.length ? Math.round((completed / queue.length) * 100) : 0,\n    };\n  }, [queue, allFollowups]);\n\n  async function reviewToday() {\n    const reason = operationalSummary.remaining > 0\n      ? window.prompt(\`متبقي \${operationalSummary.remaining} حالة. اكتب سبب واضح للحالات غير المكتملة:\`)\n      : '';\n    if (operationalSummary.remaining > 0 && !String(reason || '').trim()) {\n      toast.error('لن يتم حفظ مراجعة اليوم بدون سبب للحالات المتبقية');\n      return;\n    }\n    const notes = window.prompt('ملاحظات مدير خدمة العملاء عن يوم العمل (اختياري):') || '';\n    try {\n      await saveCustomerServiceDailyReview({\n        branch,\n        ownerName: owner,\n        total: operationalSummary.total,\n        completed: operationalSummary.completed,\n        noAnswer: operationalSummary.noAnswer,\n        scheduled: operationalSummary.scheduled,\n        needsManager: operationalSummary.needsManager,\n        purchaseCount: operationalSummary.purchaseCount,\n        purchaseAmount: operationalSummary.purchaseAmount,\n        remainingReason: reason || null,\n        managerNotes: notes || null,\n        reviewedByStaffId: user?.staff_id || user?.id || null,\n        reviewedByName: user?.name || null,\n      });\n      toast.success(operationalSummary.remaining ? 'تم حفظ مراجعة اليوم مع توثيق الحالات المتبقية' : 'تم اعتماد اكتمال قائمة اليوم');\n    } catch (error) {\n      toast.error((error as Error).message || 'تعذر حفظ مراجعة اليوم');\n    }\n  }\n\n  function copyScript(item: QueueItem) {`,
  'review handler'
);

replaceOnce(
  `      {loadError && <div className="flex items-center justify-between rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100"><span>تعذر تحميل البيانات: {loadError}</span><button className="btn-secondary" onClick={() => void loadWorkspace()}>إعادة المحاولة</button></div>}\n\n      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">`,
  `      {loadError && <div className="flex items-center justify-between rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100"><span>تعذر تحميل البيانات: {loadError}</span><button className="btn-secondary" onClick={() => void loadWorkspace()}>إعادة المحاولة</button></div>}\n\n      <section className="rounded-3xl border border-white/10 bg-[#10243d] p-4">\n        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">\n          <div className="min-w-0 flex-1">\n            <div className="flex items-center justify-between gap-3"><span className="text-sm font-black text-white">تقدم تنفيذ قائمة اليوم</span><span className="text-2xl font-black text-teal-200">{operationalSummary.rate}%</span></div>\n            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-teal-400 transition-all" style={{ width: \`${operationalSummary.rate}%\` }} /></div>\n            <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-300">\n              <button className="rounded-xl bg-white/5 px-3 py-2" onClick={() => { setTab('today'); setStatusFilter('open'); }}>متبقي: {operationalSummary.remaining}</button>\n              <button className="rounded-xl bg-white/5 px-3 py-2" onClick={() => { setTab('today'); setStatusFilter('completed'); }}>مكتمل: {operationalSummary.completed}</button>\n              <span className="rounded-xl bg-white/5 px-3 py-2">لم يرد: {operationalSummary.noAnswer}</span>\n              <span className="rounded-xl bg-white/5 px-3 py-2">متابعة قادمة: {operationalSummary.scheduled}</span>\n              <span className="rounded-xl bg-white/5 px-3 py-2">يحتاج مدير: {operationalSummary.needsManager}</span>\n              <span className="rounded-xl bg-white/5 px-3 py-2">مبيعات المتابعة: {formatCurrency(operationalSummary.purchaseAmount)}</span>\n            </div>\n          </div>\n          <button className="btn-primary shrink-0" onClick={() => void reviewToday()}>مراجعة نهاية اليوم</button>\n        </div>\n      </section>\n\n      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">`,
  'progress panel'
);

fs.writeFileSync(filePath, source);
console.log('Customer service day review v2 applied.');
