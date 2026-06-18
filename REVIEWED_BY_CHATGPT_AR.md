# Dawaa Optimized - Reviewed Notes

تمت مراجعة النسخة قبل الاستخدام.

ملاحظات مهمة:

- إعدادات Vercel مضبوطة على Yarn Classic 1.22.22 لتجنب خطأ pnpm ERR_INVALID_THIS.
- package.json مضبوط على Node 22.x و yarn@1.22.22.
- تم حذف vitest من التثبيت لأنه سبب مشكلة ربط vite سابقًا.
- تم تصحيح scripts/doctor.cjs ليتوافق مع Yarn بدل pnpm.
- ملفات SQL لا تحتوي DROP TABLE أو TRUNCATE أو DELETE FROM، لكنها تضيف جداول/أعمدة/Views/Functions ويجب تشغيلها على Supabase بحذر وبالترتيب.

التطبيق يحتاج بعد الرفع:

1. git push
2. Vercel Redeploy without cache
3. تشغيل ملفات SQL المطلوبة حسب الصفحة:
   - CONVERSATION_REVIEWS_MANAGER_UPGRADE.sql
   - DAWAA_CUSTOMER_OPERATIONS_AUTO_FIX.sql
   - PERFORMANCE_UPGRADE_SETUP.sql
   - APPLY_THESE_INDEXES_IN_SUPABASE.sql أو SUPABASE_PERFORMANCE_INDEXES.sql بعد نجاح التطبيق
