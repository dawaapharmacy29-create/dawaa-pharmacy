const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

const duplicated = `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);\n      if (whatsappSourceId && reviewRowId) {\n        try {\n          await confirmWhatsAppReviewQueueItem(whatsappSourceId, {\n            officialReviewId: reviewRowId,\n            reviewerId: String(user?.id || user?.staffId || ''),\n            reviewerName: String(user?.name || user?.username || ''),\n            approved: true,\n          });\n        } catch (queueError) {\n          console.warn('[reviews] official review saved but queue link failed', queueError);\n          toast.warning('تم حفظ التقييم الرسمي، لكن تعذر تحديث حالة Queue تلقائيًا');\n        }\n      }\n      const reusedExistingReview = Boolean(ins.reusedExisting);`;

const fixed = `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);\n      if (whatsappSourceId && reviewRowId) {\n        try {\n          await confirmWhatsAppReviewQueueItem(whatsappSourceId, {\n            officialReviewId: reviewRowId,\n            reviewerId: String(user?.id || user?.staffId || ''),\n            reviewerName: String(user?.name || user?.username || ''),\n            approved: true,\n          });\n        } catch (queueError) {\n          console.warn('[reviews] official review saved but queue link failed', queueError);\n          toast.warning('تم حفظ التقييم الرسمي، لكن تعذر تحديث حالة Queue تلقائيًا');\n        }\n      }`;

if (src.includes(duplicated)) {
  src = src.replace(duplicated, fixed);
  fs.writeFileSync(file, src);
  console.log('[whatsapp-bridge-cleanup-v4] duplicate declaration removed');
} else if (src.includes(fixed)) {
  console.log('[whatsapp-bridge-cleanup-v4] already clean');
} else {
  throw new Error('[whatsapp-bridge-cleanup-v4] expected bridge block not found');
}
