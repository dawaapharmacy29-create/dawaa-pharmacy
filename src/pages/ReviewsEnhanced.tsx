import { useLocation, useNavigate } from 'react-router-dom';
import Reviews from '@/pages/Reviews';
import ConversationReviewEvidence from '@/pages/ConversationReviewEvidence';
import ConversationReviewsHistoryAdvanced from '@/pages/ConversationReviewsHistoryAdvanced';
import ConversationReviewDetailsFast from '@/pages/ConversationReviewDetailsFast';

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
        <ConversationReviewEvidence />
      </div>
    );
  }

  if (historyMode && selectedReviewId && !editMode) {
    return <ConversationReviewDetailsFast key={`review-detail-${selectedReviewId}`} />;
  }

  if (historyMode && !selectedReviewId) {
    return <ConversationReviewsHistoryAdvanced key="conversation-reviews-history" />;
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
      <Reviews key={editMode && selectedReviewId ? `reviews-edit-${selectedReviewId}` : 'reviews-main'} />
    </div>
  );
}
