const fs = require('node:fs');
const path = require('node:path');

// GitHub quality gates must be read-only. The legacy repair remains available
// for the current local/Vercel build flow, but must never mutate an Actions checkout.
if (process.env.GITHUB_ACTIONS === 'true') {
  console.log('✓ تخطي إصلاح قائمة المتابعات الكتابي داخل GitHub Actions');
  process.exit(0);
}

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
  `    key: normalizeKey(
      row.customer_code,
      row.customer_phone,
      row.phone,
      row.customer_id,
      row.customer_name
    ),`,
  `    key: normalizeKey(
      row.customer_id,
      row.customer_code,
      normalizePhone(row.customer_phone || row.phone),
      row.customer_name
    ),`,
  'تقديم معرف العميل على الكود والهاتف في مفتاح منع التكرار'
);

replaceOnce(
  `    key: normalizeKey(
      customer.customer_code,
      customer.customer_phone,
      customer.phone,
      customer.customer_id,
      customer.customer_name
    ),`,
  `    key: normalizeKey(
      customer.customer_id,
      customer.customer_code,
      normalizePhone(customer.customer_phone || customer.phone),
      customer.customer_name
    ),`,
  'توحيد مفتاح العملاء القادمين من التحليلات'
);

replaceOnce(
  `      const finalQueue = snapshot.items.filter(
        (saved) =>
          saved.status === 'completed' ||
          saved.source !== 'at_risk' ||
          (!staleCodes.has(String(saved.code || '').trim()) &&
            !stalePhones.has(normalizePhone(saved.phone)))
      ).map((saved) => {`,
  `      const finalQueue = snapshot.items.filter(
        (saved) =>
          saved.status !== 'completed' &&
          (saved.source !== 'at_risk' ||
            (!staleCodes.has(String(saved.code || '').trim()) &&
              !stalePhones.has(normalizePhone(saved.phone))))
      ).map((saved) => {`,
  'إزالة المتابعات المكتملة من المطلوب الآن مع بقائها في السجل'
);

replaceOnce(
  `    const headers = [
      'العميل',
      'الكود',
      'الهاتف',
      'الفرع',
      'حالة الفرع',
      'النوع',
      'الأولوية',
      'سبب الأولوية',
      'مقدم الطلب',
      'سبب المتابعة',
      'الحالة',
      'الموعد القادم',
    ];
    const rows = visibleQueue.map((item) => [
      item.name,
      item.code,
      item.phone,
      item.branch,
      item.branchEvidence,
      queueLabel(item),
      item.priority,
      item.priorityReason,
      item.requestedBy,
      item.reason,
      resultOf(item.row),
      item.row?.next_followup_date || '',
    ]);`,
  `    const headers = [
      'معرف المتابعة',
      'معرف العميل',
      'العميل',
      'الكود',
      'الهاتف',
      'الفرع',
      'حالة الفرع',
      'النوع',
      'الأولوية',
      'سبب الأولوية',
      'مقدم الطلب',
      'سبب المتابعة',
      'حالة المتابعة',
      'حالة قائمة اليوم',
      'تاريخ إنشاء الطلب',
      'أول محاولة',
      'عدد المحاولات',
      'الموعد القادم',
      'آخر شراء',
      'أيام منذ آخر شراء',
      'المتوسط الشهري',
      'متوسط الفاتورة',
      'إجمالي المشتريات',
      'حالة جودة البيانات',
      'مشكلات البيانات',
      'عدد الطلبات المفتوحة المرتبطة',
    ];
    const rows = visibleQueue.map((item) => {
      const issues = [
        !item.code ? 'كود العميل غير موجود' : '',
        !item.phone ? 'رقم الهاتف غير موجود' : '',
        item.phone && normalizePhone(item.phone).length < 10 ? 'رقم الهاتف غير صالح' : '',
        !item.branch ? 'الفرع غير محدد' : '',
        item.branchNeedsReview ? 'بيانات الفرع تحتاج مراجعة' : '',
        !item.reason || item.reason === '0' ? 'سبب المتابعة غير واضح' : '',
        !item.requestedBy || item.requestedBy === 'غير محدد' ? 'مقدم الطلب غير محدد' : '',
        !item.completed && OPEN_RESULTS.has(resultOf(item.row)) && !item.row?.next_followup_date
          ? 'الحالة مفتوحة بدون موعد قادم'
          : '',
      ].filter(Boolean);
      const customerId =
        item.customer?.customer_id || item.customer?.id || item.row?.customer_id || '';
      return [
        item.row?.id || item.row?.linked_followup_id || '',
        customerId,
        item.name,
        item.code,
        item.phone,
        item.branch,
        item.branchEvidence,
        queueLabel(item),
        item.priority,
        item.priorityReason,
        item.requestedBy,
        item.reason,
        resultOf(item.row),
        item.completed ? 'مكتملة' : item.status,
        item.row?.created_at || item.row?.date || item.row?.followup_date || '',
        rowValue(item.row, 'first_attempt_at'),
        rowNumber(item.row, 'attempt_count', 'contact_attempts_count'),
        item.row?.next_followup_date || '',
        item.lastPurchase,
        daysSince(item.lastPurchase) ?? '',
        item.avgMonthly,
        item.avgInvoice,
        item.totalSpent,
        issues.length ? 'تحتاج مراجعة' : 'مكتملة',
        issues.join(' | '),
        item.openRequestCount || 1,
      ];
    });`,
  'توسيع تصدير القائمة وإضافة تشخيص جودة البيانات والتكرار'
);

replaceOnce(
  `            setStatusFilter('all');`,
  `            setStatusFilter('open');`,
  'إبقاء زر قائمة اليوم على المتابعات المفتوحة'
);

fs.writeFileSync(file, source);
console.log('تم تطبيق إصلاح قائمة المتابعات بنجاح.');
