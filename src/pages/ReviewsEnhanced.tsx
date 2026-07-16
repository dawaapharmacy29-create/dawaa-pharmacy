import Reviews from '@/pages/Reviews';
import ConversationReviewEvidence from '@/pages/ConversationReviewEvidence';

export default function ReviewsEnhanced() {
  const params = new URLSearchParams(window.location.search);
  const evidenceMode = params.get('mode') === 'evidence';

  if (evidenceMode) {
    return <div dir="rtl" className="space-y-4">
      <button type="button" onClick={() => { window.location.href = '/reviews'; }} className="btn-secondary">العودة إلى تقييم المحادثات</button>
      <ConversationReviewEvidence />
    </div>;
  }

  return <div dir="rtl" className="space-y-4">
    <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="font-black text-white">صور المحادثة ورسالة التوجيه</div><p className="mt-1 text-sm text-slate-300">بعد حفظ التقييم، افتحي أداة المرفقات لإضافة رسالة مباشرة للدكتور وحتى 5 صور من الشات.</p></div>
        <button type="button" onClick={() => { window.location.href = '/reviews?mode=evidence'; }} className="btn-primary">إرفاق صور ورسالة</button>
      </div>
    </div>
    <Reviews />
  </div>;
}
