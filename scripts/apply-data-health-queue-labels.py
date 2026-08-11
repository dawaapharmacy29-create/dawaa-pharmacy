from pathlib import Path

path = Path('src/lib/dataHealth/appDataHealthService.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str):
    global text
    if new in text:
        print(f'{label}: already applied')
        return
    if old not in text:
        raise SystemExit(f'{label}: source not found')
    text = text.replace(old, new, 1)
    print(f'{label}: applied')

replace_once(
    "    issue({ key: 'accounts-without-staff', label: 'حسابات بدون موظف مربوط', count: num('accounts_without_staff'), severity: severityForCount(num('accounts_without_staff'), 5), source: 'staff_accounts', suggestedFix: 'اربط كل حساب دخول بسجل موظف صحيح.', affectedPages: ['/staff-accounts', '/team'] }),\n",
    "    issue({ key: 'accounts-without-staff', label: 'حسابات دخول نشطة بدون موظف مربوط', count: num('accounts_without_staff'), severity: severityForCount(num('accounts_without_staff'), 1), source: 'staff_accounts', suggestedFix: 'اربط أي حساب دخول نشط بسجل موظف صحيح. الحسابات الخاصة بالمدير العام والدليفري مستثناة من هذا الفحص.', affectedPages: ['/staff-accounts', '/team'] }),\n    issue({ key: 'legacy-inactive-accounts', label: 'حسابات Legacy معطلة', count: num('legacy_inactive_accounts'), severity: 'info', source: 'staff_accounts', suggestedFix: 'معلومة أرشيفية فقط؛ الحسابات معطلة ولا تستطيع تسجيل الدخول.', affectedPages: ['/staff-accounts'] }),\n",
    'account health classification',
)

replace_once(
    "    issue({ key: 'reviews-without-points', label: 'تقييمات محادثات تنتظر اعتماد تأثير النقاط', count: num('reviews_without_points'), severity: severityForCount(num('reviews_without_points'), 10), source: 'conversation_sales_reviews', suggestedFix: 'راجع واعتمد تأثير التقييمات المعلقة.', affectedPages: ['/reviews', '/points'] }),\n",
    "    issue({ key: 'reviews-without-points', label: 'تقييمات ناقصها سجل نقاط', count: num('reviews_without_points'), severity: severityForCount(num('reviews_without_points'), 1), source: 'conversation_sales_reviews + employee_transactions', suggestedFix: 'أعد بناء Transaction pending للتقييم فقط إذا لم يكن له source_id مطابق؛ لا تعتمد الخصم تلقائيًا.', affectedPages: ['/reviews', '/points'] }),\n    issue({ key: 'pending-review-approvals', label: 'تقييمات تنتظر اعتماد تأثير النقاط', count: num('pending_review_approvals'), severity: 'info', source: 'conversation_sales_reviews + employee_transactions', suggestedFix: 'طابور اعتماد إداري طبيعي؛ الاعتماد أو الرفض يتم من الصلاحية المختصة ولا يعتبر خطأ بيانات.', affectedPages: ['/reviews', '/points'] }),\n",
    'review approval classification',
)

replace_once(
    "    issue({ key: 'unassigned-customer-requests', label: 'طلبات عملاء مفتوحة بدون مسؤول', count: num('unassigned_customer_requests'), severity: severityForCount(num('unassigned_customer_requests'), 5), source: 'customer_requests', suggestedFix: 'اسند كل طلب مفتوح لمسؤول واضح.', affectedPages: ['/customer-requests'] }),\n",
    "    issue({ key: 'unassigned-customer-requests', label: 'طلبات عملاء مفتوحة بدون مسؤول', count: num('unassigned_customer_requests'), severity: severityForCount(num('unassigned_customer_requests'), 5), source: 'customer_requests', suggestedFix: 'راجع طلبات المزامنة غير المحسومة وحدد الفرع أولًا قبل الإسناد.', affectedPages: ['/customer-requests'] }),\n    issue({ key: 'request-sync-conflicts', label: 'طلبات مزامنة تحتاج تحديد فرع', count: num('unresolved_request_sync_conflicts'), severity: severityForCount(num('unresolved_request_sync_conflicts'), 5), source: 'customer_requests.sync_conflict', suggestedFix: 'راجع بيانات العميل/الهاتف وحدد الفرع يدويًا فقط عندما لا يوجد دليل موثوق يسمح بالربط التلقائي.', affectedPages: ['/customer-requests'] }),\n",
    'request sync conflict queue',
)

path.write_text(text, encoding='utf-8')
print('data health labels patch prepared')
