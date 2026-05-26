# دليل تطبيق الإصلاحات — صيدلية دواء 2027

## الملفات المرفقة وأماكنها في المشروع

| الملف المرفق | المسار في المشروع |
|---|---|
| `activityLog.ts` | `src/lib/activityLog.ts` |
| `useAuth.ts` | `src/hooks/useAuth.ts` |
| `supabaseTables.ts` | `src/lib/supabaseTables.ts` |
| `vite.config.mjs` | `vite.config.mjs` |
| `database_fixes.sql` | شغّله في Supabase SQL Editor |

---

## الخطوة 1 — قاعدة البيانات (Supabase SQL Editor)

1. افتح Supabase Dashboard
2. روح **SQL Editor**
3. انسخ محتوى `database_fixes.sql` والصقه
4. اضغط **Run**
5. تحقق إن النتيجة ظهرت فيها الجداول الرسمية والجديدة

---

## الخطوة 2 — ملفات الكود

### أ) `src/lib/activityLog.ts`
**ما اتغير:** حذف الـ fallback لجدول `activity_logs` المكرر. دلوقتي الكود بيكتب في `activity_log` فقط.

### ب) `src/hooks/useAuth.ts`
**ما اتغير:**
- حذف قائمة المستخدمين وكلمات المرور المكتوبة في الكود (الـ hardcoded passwords)
- دلوقتي النظام بيعتمد على Supabase `staff_account_login` فقط
- حذف كل الـ `console.warn/log` من الـ auth
- لو Supabase مش متوفر بيرجع `false` بدل ما يستخدم بيانات مكشوفة

### ج) `src/lib/supabaseTables.ts`
**ما اتغير:** أضاف كل الجداول المستخدمة في التطبيق (كانت 11 دلوقتي 45+)

### د) `vite.config.mjs`
**ما اتغير:**
- `drop_console: true` في production — يحذف كل console.log تلقائياً
- `drop_debugger: true` — يحذف debugger statements
- تقسيم الـ bundle لـ chunks أصغر (vendor, supabase, ui) لتحسين التحميل

---

## ملاحظة مهمة — بعد تغيير useAuth.ts

بعد ما تطبق ملف `useAuth.ts` الجديد، لازم تتأكد إن كل الموظفين عندهم حسابات في جدول `staff_accounts` في Supabase. لو حد مش عارف يدخل:

1. روح Supabase → Table Editor → `staff_accounts`
2. أضف صف جديد للموظف
3. أو استخدم صفحة **حسابات وصلاحيات** في التطبيق لإضافته

---

## ملف .gitignore — أضف السطر ده

```
.pnpm-store/
```

عشان الـ pnpm-store ميتحملش في الـ repository.

---

## ملخص التحسينات

| التحسين | النتيجة |
|---|---|
| حذف hardcoded passwords | أمان أعلى |
| توحيد activity_log | بيانات متسقة |
| جداول الصفحات الجديدة | الصفحات هتشتغل صح |
| drop_console في production | أداء أسرع |
| supabaseTables.ts محدث | أسهل صيانة |
