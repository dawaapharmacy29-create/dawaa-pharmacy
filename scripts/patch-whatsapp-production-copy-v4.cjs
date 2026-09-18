const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-production-copy-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-production-copy-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-production-copy-v4] ${label}: applied`);
}

patch(
  'replace experimental badge',
  `مختبر تجريبي — بدون حفظ أو خصم نقاط`,
  `مركز WhatsApp Review V4 — التقاط وتحليل تلقائي • النقاط بعد الاعتماد فقط`
);

patch(
  'empty state operational copy',
  `لن يتم إنشاء تقييم أو نقاط تلقائيًا في هذه المرحلة.`,
  `بعد ربط فولدر الجهاز، أي Export جديد سيتم تحليله وحفظه في Queue تلقائيًا؛ لا يتم تطبيق نقاط أو خصومات قبل الاعتماد البشري.`
);

patch(
  'page description operational copy',
  `التحليل يجمع بين مستوى المحادثة كلها ومستوى كل جلسة: هوية العميل، تبديل الدكاترة، سرعة الرد، الشكوى، البيع، الدليفري، المتابعة والدليل الذي بُني عليه كل حكم.`,
  `المنظومة تلتقط Export واتساب من فولدر الجهاز، تقسمه لجلسات، تربط العميل والدكتور، تحلل الخدمة والبيع والمتابعة والميديا، تحفظه في Queue وتطابق الفاتورة تلقائيًا مع بقاء الاعتماد الرسمي تحت مراجعة بشرية.`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-production-copy-v4] operational copy applied successfully');
