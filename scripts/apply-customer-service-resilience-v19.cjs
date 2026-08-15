const fs = require('fs');
const path = 'src/components/customerService/CustomerDailyPriorityQueues.tsx';
let s = fs.readFileSync(path, 'utf8');
const oldLine = "      if (failed) throw new Error(`${failed[0]}: ${failed[1].error?.message || 'خطأ غير معروف'}`);";
const newLine = "      if (failed) setError(`تعذر تحميل ${failed[0]} مؤقتًا: ${failed[1].error?.message || 'خطأ غير معروف'} — تم عرض باقي القوائم المتاحة.`);";
if (!s.includes(oldLine)) throw new Error('target line not found');
s = s.replace(oldLine, newLine);
fs.writeFileSync(path, s);
