const fs = require('fs');
const path = 'src/pages/Reviews.tsx';
let s = fs.readFileSync(path, 'utf8');
const from = `        if (pointsResult.error) {\n          toast.warning(\`تم حفظ التقييم، لكن لم يتم حفظ تأثير النقاط: \${pointsResult.error}\`);\n        }`;
const to = `        if (pointsResult.error) {\n          // التقييم نفسه اتسجل، لكن النقاط جزء أساسي من دورة الحوافز.\n          // لا نمسح المسودة ولا نعتبر العملية مكتملة: إعادة الضغط على حفظ\n          // ستسترجع نفس التقييم (idempotent) وتحاول ربط النقاط مرة أخرى بلا تكرار.\n          toast.error(\`تم حفظ التقييم لكن ربط النقاط لم يكتمل. اضغط حفظ مرة أخرى لإكمال الربط: \${pointsResult.error}\`);\n          return false;\n        }`;
if (!s.includes(from)) throw new Error('points error block not found');
s = s.replace(from, to);
fs.writeFileSync(path, s);
console.log('patched points retry behavior');
