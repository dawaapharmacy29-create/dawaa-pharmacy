# إصلاح فتح التطبيق على iPhone / Safari

هذه النسخة تضيف Patch آمن لمشكلة ظهور شاشة:

> حدث خطأ غير متوقع

على iPhone Safari.

## ما الذي تم تعديله؟

1. إضافة ملف توافق خاص بـ iPhone/Safari:
   - `src/lib/mobileSafariCompat.ts`

2. إضافة Polyfills قبل تشغيل التطبيق لـ:
   - `Promise.withResolvers`
   - `crypto.randomUUID`
   - `requestIdleCallback`
   - بعض دوال Array الحديثة

3. تخفيض Target في Vite إلى:
   - `es2019`
   - `safari13`

4. تعطيل تسجيل Service Worker تلقائيًا على iPhone/Safari لتجنب تحميل JavaScript قديم من الكاش.

5. تحسين زر “إصلاح وإعادة تحميل التطبيق” ليقوم بـ:
   - حذف جميع caches القديمة
   - إلغاء Service Workers
   - مسح التخزين المحلي غير الخاص بـ Supabase
   - فتح صفحة `/login` من جديد

## بعد النشر

على الآيفون:
1. افتح الرابط من Safari.
2. لو ظهرت شاشة الخطأ القديمة مرة واحدة، اضغط زر:
   - إصلاح وإعادة تحميل التطبيق
3. بعدها المفروض يفتح صفحة تسجيل الدخول.

## ملاحظات مهمة

- لا يوجد أي SQL مطلوب لهذه النسخة.
- لم يتم تعديل Supabase أو RLS أو جداول قاعدة البيانات.
- إذا أردت تفعيل Service Worker لاحقًا، أضف في Vercel:
  - `VITE_ENABLE_PWA_SW=true`
  لكن لا أنصح بذلك الآن قبل استقرار نسخة iPhone.
