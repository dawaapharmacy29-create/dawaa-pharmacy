import { lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const Reviews = lazy(() => import('@/pages/Reviews'));
const ConversationReviewEvidence = lazy(() => import('@/pages/ConversationReviewEvidence'));
const ConversationReviewsHistoryAdvanced = lazy(() => import('@/pages/ConversationReviewsHistoryAdvanced'));
const ConversationReviewDetailsFast = lazy(() => import('@/pages/ConversationReviewDetailsFast'));

function ReviewModeLoader({ label = 'جاري تحميل الصفحة...' }: { label?: string }) {
  return (
    <div dir="rtl" className="dawaa-card dawaa-card--soft flex min-h-[180px] items-center justify-center p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
        <div className="dawaa-title text-sm font-black">{label}</div>
      </div>
    </div>
  );
}

export default function ReviewsEnhanced() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || '';
  const evidenceMode = mode === 'evidence';
  const editMode = mode === 'edit';
  const historyMode = params.get('section') === 'history';
  const selectedReviewId = String(params.get('id') || '').trim();

  if (evidenceMode) {
    return (
      <div dir="rtl" className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/reviews', { replace: true })}
          className="dawaa-button dawaa-button--secondary"
        >
          العودة إلى تقييم المحادثات
        </button>
        <Suspense fallback={<ReviewModeLoader label="جاري تحميل مرفقات المحادثة..." />}>
          <ConversationReviewEvidence />
        </Suspense>
      </div>
    );
  }

  if (historyMode && selectedReviewId && !editMode) {
    return (
      <Suspense fallback={<ReviewModeLoader label="جاري تحميل تفاصيل التقييم..." />}>
        <ConversationReviewDetailsFast key={`review-detail-${selectedReviewId}`} />
      </Suspense>
    );
  }

  if (historyMode && !selectedReviewId) {
    return (
      <Suspense fallback={<ReviewModeLoader label="جاري تحميل سجل التقييمات..." />}>
        <ConversationReviewsHistoryAdvanced key="conversation-reviews-history" />
      </Suspense>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="dawaa-card dawaa-card--soft p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="dawaa-title font-black">صور المحادثة ورسالة التوجيه</div>
            <p className="dawaa-caption mt-1 text-sm">
              بعد حفظ التقييم، افتحي أداة المرفقات لإضافة رسالة مباشرة للدكتور وحتى 5 صور من الشات.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/reviews?mode=evidence')}
            className="dawaa-button dawaa-button--primary"
          >
            إرفاق صور ورسالة
          </button>
        </div>
      </div>
      <Suspense fallback={<ReviewModeLoader label={editMode ? 'جاري تحميل تعديل التقييم...' : 'جاري تحميل نموذج التقييم...'} />}>
        <Reviews key={editMode && selectedReviewId ? `reviews-edit-${selectedReviewId}` : 'reviews-main'} />
      </Suspense>
    </div>
  );
}
