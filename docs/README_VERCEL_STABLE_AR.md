# نسخة Dawaa المستقرة للنشر على Vercel

هذه النسخة مخصصة لحل مشكلة فشل التثبيت في Vercel التي كانت تظهر كالتالي:

`npm error Exit handler never called!`

## ما الذي تغير؟

- تثبيت إصدار npm مستقر: `npm@10.9.2`.
- تثبيت Node على `22.x`.
- جعل Vercel يستخدم `npm ci` بدل `npm install` لثبات أعلى وسرعة أفضل.
- تفعيل install command داخل `vercel.json` حتى لا يعتمد المشروع على إعداد يدوي من لوحة Vercel.
- تنظيف أنواع غير ضرورية كانت تسبب تحذيرات: `@types/uuid` و `@types/dompurify` لأن المكتبتين توفران الأنواع داخليًا.
- إضافة `.vercelignore` لمنع رفع ملفات مؤقتة أو build artifacts.
- عدم تعديل أي SQL أو Supabase migrations أو RLS أو بيانات إنتاج.

## أوامر التحقق المحلية

```bash
npm install -g npm@10.9.2
npm ci --legacy-peer-deps --no-audit --no-fund
npm run doctor
npm run test
npm run build
```

## على Vercel

المفروض يظهر في اللوج:

```bash
npm install -g npm@10.9.2 && npm ci --legacy-peer-deps --no-audit --no-fund
```

لو ظهر الأمر القديم `npm install --legacy-peer-deps` فقط، فهذا يعني أن Vercel لا يقرأ `vercel.json` أو أن التعديل لم يتم رفعه على GitHub.

## لا يوجد SQL مطلوب

لا تشغل أي ملفات SQL مع هذه النسخة. هذه نسخة كود ونشر فقط.
