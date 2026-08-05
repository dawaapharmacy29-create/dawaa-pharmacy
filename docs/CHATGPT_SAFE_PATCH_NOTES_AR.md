# تعديلات ChatGPT الآمنة للتجربة

تم عمل تعديلات صغيرة فقط للاستفادة من النسخة الحالية بدون تغيير منطق التطبيق أو لمس ملفات SQL/البيانات.

## ما تم تعديله

1. توحيد مدير الحزم على npm بدل وجود إعدادات متضاربة بين package.json و package-lock.json.
   - packageManager أصبح: npm@10.9.2
   - Vercel أصبح يستخدم: npm install --legacy-peer-deps --no-audit --no-fund
   - buildCommand أصبح: npm run build

2. مزامنة package-lock.json مع package.json حتى لا يحدث اختلاف في Vercel أو على جهازك.

3. إضافة vitest كـ devDependency لأن المشروع كان يحتوي على ملف اختبار يستورد vitest.

4. تحويل اختبار قاعدة البيانات الحقيقي من test عادي إلى integration test:
   - من: staffPerformanceProfileService.test.ts
   - إلى: staffPerformanceProfileService.integration.ts
   - السبب: هذا الاختبار يحتاج بيانات Supabase حقيقية وقد يعلق أو يبطئ التشغيل العادي.
   - تشغيله اختياريًا يكون بالأمر: npm run test:integration

5. إضافة scripts مفيدة:
   - npm run test
   - npm run test:integration
   - npm run check

6. تحسين scripts/doctor.cjs بحيث يفحص الإعدادات حسب مدير الحزم الموجود بدل إجبار yarn فقط.

7. تنظيف .npmrc من إعدادات غير مدعومة في npm لتقليل تحذيرات التثبيت.

## نتيجة الاختبار داخل ChatGPT

تم تشغيل الأوامر التالية بنجاح:

```bash
npm install --legacy-peer-deps --no-audit --no-fund
npm run doctor
npm run test
npm run build
```

نتيجة build: نجح ✅

ملاحظة: `npm run typecheck` لم يظهر أخطاء، لكنه لم ينته داخل وقت التنفيذ المتاح في بيئة ChatGPT، لذلك لا أعتمد عليه كنتيجة نهائية. الاعتماد الأساسي هنا على نجاح build، ثم يفضل تجربته على جهازك أو Vercel Preview.

## ما لم يتم لمسه

- لم يتم تعديل أي SQL أو migrations.
- لم يتم تغيير بيانات موظفين أو صلاحيات.
- لم يتم تغيير منطق الصفحات أو التصميم.
- لم يتم حذف ملفات مهمة.

## طريقة التجربة المقترحة

```bash
npm install --legacy-peer-deps --no-audit --no-fund
npm run doctor
npm run test
npm run build
```

لو نجح build، ارفع النسخة على فرع Preview وليس main مباشرة.

```bash
git checkout -b preview-safe-chatgpt-patch
git add .
git commit -m "safe deploy patch for npm and doctor checks"
git push origin preview-safe-chatgpt-patch
```

بعد ظهور Preview على Vercel، جرّب الصفحات الأساسية:

- /login
- /executive-2027
- /customers
- /customer-service
- /team
- /schedule
- /points
- /reviews
- /delivery
- /staff-accounts
- /activity-log

## ملاحظة مهمة

هذه التعديلات تجهيزية وآمنة للتجربة. النسخة الحالية لا تغيّر قاعدة البيانات، لذلك مناسبة كتجربة Preview قبل الدمج على main.
