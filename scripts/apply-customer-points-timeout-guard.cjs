const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/pages/CustomerPointsLedger.tsx');
let source = fs.readFileSync(target, 'utf8');

const helperAnchor = "const formatDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG') : 'لم يتم';";
const helperReplacement = `${helperAnchor}\nconst periodDays = (start: string, end: string) => Math.floor((new Date(\`${'${end}'}T12:00:00\`).getTime() - new Date(\`${'${start}'}T12:00:00\`).getTime()) / 86400000) + 1;\nconst threeMonthEnd = (start: string) => { const d = new Date(\`${'${start}'}T12:00:00\`); d.setMonth(d.getMonth() + 3); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };`;
if (!source.includes('const periodDays =')) {
  if (!source.includes(helperAnchor)) throw new Error('Customer points date helper anchor not found');
  source = source.replace(helperAnchor, helperReplacement);
}

const previewAnchor = `  const previewPeriod = async () => {\n    if (!periodStart || !periodEnd) return toast.error('حدد بداية ونهاية الفترة');`;
const previewReplacement = `  const previewPeriod = async () => {\n    if (!periodStart || !periodEnd) return toast.error('حدد بداية ونهاية الفترة');\n    if (periodDays(periodStart, periodEnd) > 100) {\n      const correctedEnd = threeMonthEnd(periodStart);\n      setPeriodEnd(correctedEnd);\n      return toast.info('تم ضبط نهاية الفترة تلقائيًا على دورة 3 شهور لتسريع الحساب. اضغط قراءة الفواتير مرة أخرى.');\n    }`;
if (!source.includes("تم ضبط نهاية الفترة تلقائيًا على دورة 3 شهور")) {
  if (!source.includes(previewAnchor)) throw new Error('Preview period anchor not found');
  source = source.replace(previewAnchor, previewReplacement);
}

const calculateAnchor = `  const calculateCycle = async () => {\n    if (!setting) return toast.error('احفظ إعداد النقاط أولًا');`;
const calculateReplacement = `  const calculateCycle = async () => {\n    if (!setting) return toast.error('احفظ إعداد النقاط أولًا');\n    if (periodDays(periodStart, periodEnd) > 100) {\n      const correctedEnd = threeMonthEnd(periodStart);\n      setPeriodEnd(correctedEnd);\n      return toast.error('الفترة أكبر من دورة 3 شهور. تم تصحيح تاريخ النهاية؛ راجع الفترة ثم أرسل الطلب.');\n    }`;
if (!source.includes("الفترة أكبر من دورة 3 شهور")) {
  if (!source.includes(calculateAnchor)) throw new Error('Calculate cycle anchor not found');
  source = source.replace(calculateAnchor, calculateReplacement);
}

source = source.replace(
  `    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حساب الفترة'); }`,
  `    } catch (error) {\n      const message = error instanceof Error ? error.message : 'تعذر حساب الفترة';\n      toast.error(/statement timeout|canceling statement/i.test(message) ? 'الفترة كبيرة أو فهرسة الفواتير لم تُفعّل بعد. نفّذ إصلاح سرعة النقاط ثم أعد المحاولة.' : message);\n    }`,
);

fs.writeFileSync(target, source, 'utf8');
console.log('Customer points timeout guard applied.');
