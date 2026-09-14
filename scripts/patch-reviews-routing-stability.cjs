const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

const legacyUnmountCleanup = `  const closeSelectedReviewRef = useRef(closeSelectedReview);\n  useEffect(() => {\n    closeSelectedReviewRef.current = closeSelectedReview;\n  }, [closeSelectedReview]);\n  useEffect(() => {\n    // مقصود نستخدم مصفوفة تبعيات فاضية هنا: عايزين النداء ده يحصل مرة واحدة\n    // بس لما الصفحة تتقفل فعليًا (unmount)، مش كل مرة closeSelectedReview\n    // يتغير مرجعها لأي سبب أثناء إعادة الرندر العادية.\n    return () => {\n      closeSelectedReviewRef.current();\n    };\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n`;

if (src.includes(legacyUnmountCleanup)) {
  src = src.replace(legacyUnmountCleanup, '');
  console.log('[reviews-routing-stability] removed URL mutation during Reviews unmount');
} else if (src.includes('closeSelectedReviewRef')) {
  throw new Error('[reviews-routing-stability] closeSelectedReviewRef exists but expected cleanup shape changed');
} else {
  console.log('[reviews-routing-stability] unmount cleanup already removed');
}

fs.writeFileSync(file, src);
console.log('[reviews-routing-stability] Reviews route cleanup verified');
