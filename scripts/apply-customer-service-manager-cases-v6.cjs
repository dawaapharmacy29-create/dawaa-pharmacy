const fs = require('node:fs');

const filePath = 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx';
let source = fs.readFileSync(filePath, 'utf8');
const marker = "@/components/customerService/ManagerCasesPanel";

if (source.includes(marker)) {
  console.log('Customer service manager cases v6 already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    console.warn(`customer service manager cases skipped: ${label}`);
    return false;
  }
  source = source.replace(search, replacement);
  return true;
}

const imported = replaceOnce(
  `import type { DailyFollowup } from '@/types/database';`,
  `import type { DailyFollowup } from '@/types/database';\nimport ManagerCasesPanel from '@/components/customerService/ManagerCasesPanel';\nimport { createOrUpdateManagerCase } from '@/lib/customerServiceManagerCases';`,
  'manager imports'
);

const tabType = replaceOnce(
  `type WorkspaceTab = 'today' | 'doctor-requests' | 'care' | 'history' | 'performance';`,
  `type WorkspaceTab = 'today' | 'doctor-requests' | 'care' | 'history' | 'performance' | 'manager';`,
  'manager tab type'
);

const tabButton = replaceOnce(
  `<Tab active={tab === 'performance'} onClick={() => setTab('performance')} icon={BarChart3}>الأداء والتقارير</Tab>`,
  `<Tab active={tab === 'performance'} onClick={() => setTab('performance')} icon={BarChart3}>الأداء والتقارير</Tab><Tab active={tab === 'manager'} onClick={() => setTab('manager')} icon={AlertTriangle}>تدخل المدير</Tab>`,
  'manager tab button'
);

const managerPanel = replaceOnce(
  `      <QuickFollowupModal open={quickOpen}`,
  `      {tab === 'manager' && <ManagerCasesPanel branch={branch} />}\n\n      <QuickFollowupModal open={quickOpen}`,
  'manager panel'
);

const escalation = replaceOnce(
  `    if (!data.nextFollowupDate && smartNextFollowupDate && !completed) {\n      toast.success(\`تم اقتراح موعد المتابعة تلقائيًا: \${smartNextFollowupDate}\`);\n    }\n    setResultRow(null);`,
  `    if (!data.nextFollowupDate && smartNextFollowupDate && !completed) {\n      toast.success(\`تم اقتراح موعد المتابعة تلقائيًا: \${smartNextFollowupDate}\`);\n    }\n    if (data.result === 'يحتاج متابعة مدير') {\n      try {\n        await createOrUpdateManagerCase({\n          followupId: resultRow.id,\n          branch: resultRow.branch || branch,\n          customerId: resultRow.customer_id || null,\n          customerCode: resultRow.customer_code || null,\n          customerName: resultRow.customer_name || resultRow.name || 'عميل غير مسجل',\n          customerPhone: resultRow.customer_phone || resultRow.phone || null,\n          caseType: /شكوى/.test(String(data.notes || resultRow.followup_reason || '')) ? 'complaint' : 'manager_intervention',\n          complaintCategory: /تأخير/.test(String(data.notes || '')) ? 'تأخير' : /خصم/.test(String(data.notes || '')) ? 'خصم' : /توصيل/.test(String(data.notes || '')) ? 'توصيل' : null,\n          severity: /عاجل|حرج|غاضب|زعلان/.test(String(data.notes || '')) ? 'critical' : 'high',\n          escalationReason: data.notes || resultRow.followup_reason || 'الحالة تحتاج تدخل مدير',\n          requestedAction: 'مراجعة الحالة واتخاذ قرار واضح ثم متابعة رضا العميل',\n          escalatedByStaffId: (user as { staff_id?: string })?.staff_id || user?.id || null,\n          escalatedByName: user?.name || null,\n          metadata: { result: data.result, nextFollowupDate: smartNextFollowupDate },\n        });\n        toast.success('تم إرسال الحالة إلى مركز تدخل المدير');\n      } catch (managerCaseError) {\n        console.warn('Manager case creation failed', managerCaseError);\n        toast.warning('تم حفظ النتيجة لكن تعذر إنشاء بطاقة تدخل المدير');\n      }\n    }\n    setResultRow(null);`,
  'automatic manager case'
);

if (imported && tabType && tabButton && managerPanel && escalation) {
  fs.writeFileSync(filePath, source);
  console.log('Customer service manager cases v6 applied.');
} else {
  console.warn('Customer service manager cases v6 was not fully applied; source left unchanged.');
}
