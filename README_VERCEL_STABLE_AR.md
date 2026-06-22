# نسخة Dawaa المستقرة للنشر على Vercel (باستخدام pnpm)

هذه النسخة مخصصة لحل مشكلة فشل التثبيت في Vercel التي كانت تظهر كالتالي:

`npm error Exit handler never called!`

## ما الذي تغير؟

- التحول الكامل إلى **pnpm@10.14.0** لضمان ثبات عملية التثبيت وسرعتها.
- تشغيل Vercel على **Node 22.x** (أحدث نسخة مستقرة مدعومة).
- استخدام `pnpm install --frozen-lockfile` لضمان تطابق البيئات.
- تفعيل Corepack لضمان استخدام النسخة الصحيحة من pnpm تلقائيًا.
- تحديث `scripts/doctor.cjs` للتحقق من سلامة إعدادات pnpm و Node 22.x قبل النشر.
- إزالة ملفات lock القديمة (`package-lock.json` و `yarn.lock`) لمنع التضارب.
- عدم تعديل أي SQL أو Supabase migrations أو RLS أو بيانات إنتاج.

## أوامر التحقق المحلية

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run doctor
pnpm run test
pnpm run build
```

## إعدادات Vercel

يتم التحكم في عملية النشر تلقائيًا عبر ملف `vercel.json`:

```json
{
  "framework": "vite",
  "installCommand": "corepack enable && corepack prepare pnpm@10.14.0 --activate && pnpm install --frozen-lockfile",
  "buildCommand": "pnpm run build",
  "outputDirectory": "dist"
}
```

## ملاحظات هامة
- لا تستخدم `npm` أو `yarn` في هذا المشروع، استخدم `pnpm` فقط.
- تأكد من وجود ملف `pnpm-lock.yaml` في مستودع الكود.
- لا يوجد SQL مطلوب لتشغيل هذا التحديث.
