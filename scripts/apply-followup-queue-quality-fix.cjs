const fs = require('node:fs');
const path = require('node:path');

const file = path.join(
  process.cwd(),
  'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx'
);

let source = fs.readFileSync(file, 'utf8');

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    if (source.includes(replacement)) {
      console.log(`✓ ${label} مطبق بالفعل`);
      return;
    }
    throw new Error(`تعذر تطبيق ${label}: المقطع الأصلي غير موجود`);
  }
  source = source.replace(search, replacement);
  console.log(`✓ ${label}`);
}

replaceOnce(
  "  const [statusFilter, setStatusFilter] = useState('all');",
  "  const [statusFilter, setStatusFilter] = useState('open');",
  'جعل القائمة اليومية تعرض المفتوح افتراضيًا'
);

replaceOnce(
  `    key: normalizeKey(\n      row.customer_code,\n      row.customer_phone,\n      row.phone,\n      row.customer_id,\n      row.customer_name\n    ),`,
  `    key: normalizeKey(\n      row.customer_id,\n      row.customer_code,\n      normalizePhone(row.customer_phone || row.phone),\n      row.customer_name\n    ),`,
  'تقديم معرف العميل على الكود والهاتف في مفتاح منع التكرار'
);

replaceOnce(
  `    key: normalizeKey(\n      customer.customer_code,\n      customer.customer_phone,\n      customer.phone,\n      customer.customer_id,\n      customer.customer_name\n    ),`,
  `    key: normalizeKey(\n      customer.customer_id,\n      customer.customer_code,\n      normalizePhone(customer.customer_phone || customer.phone),\n      customer.customer_name\n    ),`,
  'توحيد مفتاح العملاء القادمين من التحليلات'
);

replaceOnce(
  `      const finalQueue = snapshot.items.filter(\n        (saved) =>\n          saved.status === 'completed' ||\n          saved.source !== 'at_risk' ||\n          (!staleCodes.has(String(saved.code || '').trim()) &&\n            !stalePhones.has(normalizePhone(saved.phone)))\n      ).map((saved) => {`,
  `      const finalQueue = snapshot.items.filter(\n        (saved) =>\n          saved.status !== 'completed' &&\n          (saved.source !== 'at_risk' ||\n            (!staleCodes.has(String(saved.code || '').trim()) &&\n              !stalePhones.has(normalizePhone(saved.phone))))\n      ).map((saved) => {`,
  'إزالة المتابعات المكتملة من المطلوب الآن مع بقائها في السجل'
);

replaceOnce(
  `    const headers = [\n      'العميل',\n      'الكود',\n      'الهاتف',\n      'الفرع',\n      'حالة الفرع',\n      'النوع',\n      'الأولوية',\n      'سبب الأولوية',\n      'مقدم الطلب',\n      'سبب المتابعة',\n      'الحالة',\n      'الموعد القادم',\n    ];\n    const rows = visibleQueue.map((item) => [\n      item.name,\n      item.code,\n      item.phone,\n      item.branch,\n      item.branchEvidence,\n      queueLabel(item),\n      item.priority,\n      item.priorityReason,\n      item.requestedBy,\n      item.reason,\n      resultOf(item.row),\n      item.row?.next_followup_date || '',\n    ]);`,
  `    const headers = [\n      'معرف المتابعة',\n      'معرف العميل',\n      'العميل',\n      'الكود',\n      'الهاتف',\n      'الفرع',\n      'حالة الفرع',\n      'النوع',\n      'الأولوية',\n      'سبب الأولوية',\n      'مقدم الطلب',\n      'سبب المتابعة',\n      'حالة المتابعة',\n      'حالة قائمة اليوم',\n      'تاريخ إنشاء الطلب',\n      'أول محاولة',\n      'عدد المحاولات',\n      'الموعد القادم',\n      'آخر شراء',\n      'أيام منذ آخر شراء',\n      'المتوسط الشهري',\n      'متوسط الفاتورة',\n      'إجمالي المشتريات',\n      'حالة جودة البيانات',\n      'مشكلات البيانات',\n      'عدد الطلبات المفتوحة المرتبطة',\n    ];\n    const rows = visibleQueue.map((item) => {\n      const issues = [\n        !item.code ? 'كود العميل غير موجود' : '',\n        !item.phone ? 'رقم الهاتف غير موجود' : '',\n        item.phone && normalizePhone(item.phone).length < 10 ? 'رقم الهاتف غير صالح' : '',\n        !item.branch ? 'الفرع غير محدد' : '',\n        item.branchNeedsReview ? 'بيانات الفرع تحتاج مراجعة' : '',\n        !item.reason || item.reason === '0' ? 'سبب المتابعة غير واضح' : '',\n        !item.requestedBy || item.requestedBy === 'غير محدد' ? 'مقدم الطلب غير محدد' : '',\n        !item.completed && OPEN_RESULTS.has(resultOf(item.row)) && !item.row?.next_followup_date\n          ? 'الحالة مفتوحة بدون موعد قادم'\n          : '',\n      ].filter(Boolean);\n      const customerId =\n        item.customer?.customer_id || item.customer?.id || item.row?.customer_id || '';\n      return [\n        item.row?.id || item.row?.linked_followup_id || '',\n        customerId,\n        item.name,\n        item.code,\n        item.phone,\n        item.branch,\n        item.branchEvidence,\n        queueLabel(item),\n        item.priority,\n        item.priorityReason,\n        item.requestedBy,\n        item.reason,\n        resultOf(item.row),\n        item.completed ? 'مكتملة' : item.status,\n        item.row?.created_at || item.row?.date || item.row?.followup_date || '',\n        rowValue(item.row, 'first_attempt_at'),\n        rowNumber(item.row, 'attempt_count', 'contact_attempts_count'),\n        item.row?.next_followup_date || '',\n        item.lastPurchase,\n        daysSince(item.lastPurchase) ?? '',\n        item.avgMonthly,\n        item.avgInvoice,\n        item.totalSpent,\n        issues.length ? 'تحتاج مراجعة' : 'مكتملة',\n        issues.join(' | '),\n        item.openRequestCount || 1,\n      ];\n    });`,
  'توسيع تصدير القائمة وإضافة تشخيص جودة البيانات والتكرار'
);

replaceOnce(
  `            setStatusFilter('all');`,
  `            setStatusFilter('open');`,
  'إبقاء زر قائمة اليوم على المتابعات المفتوحة'
);

fs.writeFileSync(file, source);
console.log('تم تطبيق إصلاح قائمة المتابعات بنجاح.');
