# تطوير صفحة خدمة العملاء - Customer Service Operations V6

تم تطوير صفحة `src/pages/CustomerService.tsx` وخدمة إنشاء قائمة اليوم الذكية في `src/lib/api/customerServiceCommandCenter.ts`.

## الملفات المعدلة

- `src/pages/CustomerService.tsx`
- `src/lib/api/customerServiceCommandCenter.ts`
- `CHATGPT_CUSTOMER_SERVICE_OPERATIONS_V6_AR.md`

## أهم التطويرات

1. إضافة قسم جديد واضح باسم **Customer Service Operations V6**.
2. إضافة شريط فلاتر قوي داخل قسم التدقيق:
   - بحث بالاسم / الكود / الرقم.
   - الفرع.
   - مسؤول خدمة العملاء.
   - الحالة.
   - الأولوية.
   - نتيجة المتابعة.
   - تصنيف العميل.
   - رقم صحيح / بدون رقم صحيح.
   - مسترجع / غير مسترجع.
   - تاريخ المتابعة من / إلى.
3. جعل الكروت والجدول والتصدير يعتمدون على نفس مصدر البيانات بعد تطبيق الفلاتر.
4. إضافة تنبيه أن الأرقام متأثرة بالفلاتر الحالية عند استخدام أي فلتر.
5. تحسين جدول التفاصيل:
   - يعرض "يعرض X من Y متابعة".
   - لا يقتصر صامتًا على أول 80 صف.
   - أضف زر "عرض المزيد".
   - أضف أعمدة الأولوية ودرجة الأولوية ومشاكل البيانات.
6. تحسين CSV:
   - إضافة `priority_label`.
   - إضافة `priority_score`.
   - إضافة `data_quality_issues`.
   - تصدير المعروض يخرج نفس الصفوف الموجودة في الجدول بعد الفلاتر.
   - تصدير التحليل الكامل يخرج كل الصفوف بعد scope الأساسي.
7. تحسين جودة البيانات:
   - invalid_phone
   - missing_customer_code
   - missing_customer_name
   - missing_branch
   - missing_assigned_to
   - missing_followup_date
8. تطوير إنشاء قائمة اليوم بذكاء:
   - يمنع تكرار نفس العميل داخل الدفعة.
   - يتجنب العملاء الذين لديهم متابعة مفتوحة أو متابعة اليوم.
   - يتجنب العملاء بدون رقم صالح.
   - يعرض تقرير واضح بعد الإنشاء:
     - created_count
     - skipped_duplicates_count
     - skipped_open_followups_count
     - skipped_invalid_phone_count
     - failed_count

## الفحص

- تم تشغيل `npm run build` بنجاح داخل بيئة العمل.
- `npm run typecheck` لم يكتمل داخل بيئة العمل بسبب timeout، لذلك يجب تشغيله محليًا قبل الـ commit النهائي.

## تعليمات التطبيق الآمن

بعد فك النسخة على جهازك، لا تعمل commit إذا ظهر عدد كبير من الملفات.
الأفضل عزل الملفات التالية فقط:

```text
src/pages/CustomerService.tsx
src/lib/api/customerServiceCommandCenter.ts
CHATGPT_CUSTOMER_SERVICE_OPERATIONS_V6_AR.md
```

ثم شغّل:

```powershell
npm run typecheck
npm run build
git status
```

Commit مقترح:

```text
Improve customer service operations filters and smart queue
```
