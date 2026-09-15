const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

const duplicated = `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);\n      if (whatsappSourceId && reviewRowId) {\n        try {\n          await confirmWhatsAppReviewQueueItem(whatsappSourceId, {\n            officialReviewId: reviewRowId,\n            reviewerId: String(user?.id || user?.staffId || ''),\n            reviewerName: String(user?.name || user?.username || ''),\n            approved: true,\n          });\n        } catch (queueError) {\n          console.warn('[reviews] official review saved but queue link failed', queueError);\n          toast.warning('تم حفظ التقييم الرسمي، لكن تعذر تحديث حالة Queue تلقائيًا');\n        }\n      }\n      const reusedExistingReview = Boolean(ins.reusedExisting);`;

const earlyBlock = `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);\n      if (whatsappSourceId && reviewRowId) {\n        try {\n          await confirmWhatsAppReviewQueueItem(whatsappSourceId, {\n            officialReviewId: reviewRowId,\n            reviewerId: String(user?.id || user?.staffId || ''),\n            reviewerName: String(user?.name || user?.username || ''),\n            approved: true,\n          });\n        } catch (queueError) {\n          console.warn('[reviews] official review saved but queue link failed', queueError);\n          toast.warning('تم حفظ التقييم الرسمي، لكن تعذر تحديث حالة Queue تلقائيًا');\n        }\n      }`;

const declarationOnly = `      const reviewRowId = ins.id;\n      const reusedExistingReview = Boolean(ins.reusedExisting);`;

if (src.includes(duplicated)) {
  src = src.replace(duplicated, earlyBlock);
  console.log('[whatsapp-bridge-cleanup-v4] duplicate declaration removed');
}

if (src.includes(earlyBlock)) {
  src = src.replace(earlyBlock, declarationOnly);
  console.log('[whatsapp-bridge-cleanup-v4] removed premature queue approval');
}

const lateAnchor = `\n\n      const currentUserProfile = getCurrentUserProfile();`;
const lateApproval = `\n\n      if (whatsappSourceId && reviewRowId) {\n        try {\n          await confirmWhatsAppReviewQueueItem(whatsappSourceId, {\n            officialReviewId: reviewRowId,\n            reviewerId: String(user?.id || user?.staffId || ''),\n            reviewerName: String(user?.name || user?.username || ''),\n            approved: true,\n          });\n        } catch (queueError) {\n          console.warn('[reviews] official review saved but queue link failed', queueError);\n          toast.warning('تم حفظ التقييم الرسمي وتأثير النقاط، لكن تعذر تحديث حالة Queue تلقائيًا');\n        }\n      }\n\n      const currentUserProfile = getCurrentUserProfile();`;

if (!src.includes(lateApproval)) {
  if (!src.includes(lateAnchor)) throw new Error('[whatsapp-bridge-cleanup-v4] late approval anchor not found');
  src = src.replace(lateAnchor, lateApproval);
  console.log('[whatsapp-bridge-cleanup-v4] queue approval moved after critical review/points save');
} else {
  console.log('[whatsapp-bridge-cleanup-v4] late queue approval already applied');
}

fs.writeFileSync(file, src);
