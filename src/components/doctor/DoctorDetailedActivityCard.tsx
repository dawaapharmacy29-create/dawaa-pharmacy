import { useEffect, useState } from 'react';
import { MessageSquare, PackageSearch, Timer } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ConversationReview = {
  review_date: string;
  total_score: number;
  reviewer_name: string | null;
  top_deduction_reason: string | null;
  points_value: number | null;
};

type StockItem = {
  name: string;
  current_quantity?: number;
  sold_quantity?: number;
  target_min_quantity?: number;
  expiry_date?: string;
  days_left?: number;
};

export default function DoctorDetailedActivityCard({ staffId }: { staffId: string }) {
  const [reviews, setReviews] = useState<ConversationReview[]>([]);
  const [stock, setStock] = useState<{ list_priority: StockItem[]; expiry_priority: StockItem[] } | null>(null);
  const [tab, setTab] = useState<'conversations' | 'stock'>('conversations');

  useEffect(() => {
    if (!staffId) return;
    void supabase
      .rpc('get_doctor_conversation_reviews_list', { p_doctor_id: staffId, p_limit: 20 })
      .then(({ data }) => setReviews((data as ConversationReview[]) || []));
    void supabase
      .rpc('get_doctor_priority_stock_items', { p_doctor_id: staffId })
      .then(({ data }) => setStock(data as { list_priority: StockItem[]; expiry_priority: StockItem[] }));
  }, [staffId]);

  const scoreColor = (score: number) => (score >= 90 ? 'text-emerald-300' : score >= 70 ? 'text-amber-300' : 'text-rose-300');

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
      <div className="flex gap-2 border-b border-white/10 pb-3">
        <button
          type="button"
          onClick={() => setTab('conversations')}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black ${tab === 'conversations' ? 'bg-teal-500/20 text-teal-200' : 'text-slate-400'}`}
        >
          <MessageSquare size={14} /> محادثاتي ({reviews.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('stock')}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black ${tab === 'stock' ? 'bg-teal-500/20 text-teal-200' : 'text-slate-400'}`}
        >
          <PackageSearch size={14} /> أولويات اللستة والرواكد
        </button>
      </div>

      {tab === 'conversations' ? (
        <div className="mt-4 space-y-2">
          {reviews.length === 0 ? (
            <p className="text-sm text-slate-400">لسه مفيش تقييمات محادثات مسجّلة لك.</p>
          ) : (
            reviews.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-black/20 p-3">
                <div>
                  <p className="text-xs font-bold text-slate-400">{r.review_date}</p>
                  {r.top_deduction_reason && r.top_deduction_reason !== 'تقييم محادثة ممتاز' ? (
                    <p className="mt-1 text-xs text-amber-200">{r.top_deduction_reason}</p>
                  ) : null}
                </div>
                <div className="text-left">
                  <p className={`text-lg font-black ${scoreColor(r.total_score)}`}>{r.total_score}/100</p>
                  {r.points_value != null ? (
                    <p className="text-xs font-bold text-teal-300">{r.points_value > 0 ? '+' : ''}{r.points_value} نقطة</p>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-sm font-black text-white">أهم أصناف اللستة محتاجة تركيزك</h3>
            <div className="mt-2 space-y-2">
              {!stock?.list_priority?.length ? (
                <p className="text-sm text-slate-400">لسه مفيش أصناف لستة متاحة.</p>
              ) : (
                stock.list_priority.map((item, i) => (
                  <div key={i} className="rounded-xl bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-white">{item.name}</span>
                      <span className="text-xs font-bold text-slate-400">
                        {item.sold_quantity || 0} من {item.target_min_quantity || '؟'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-black text-rose-300"><Timer size={14} /> أصناف قربت تنتهي صلاحيتها</h3>
            <div className="mt-2 space-y-2">
              {!stock?.expiry_priority?.length ? (
                <p className="text-sm text-slate-400">مفيش أصناف قريبة من الانتهاء حاليًا.</p>
              ) : (
                stock.expiry_priority.map((item, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-rose-400/20 bg-rose-500/5 p-3">
                    <span className="font-black text-white">{item.name}</span>
                    <span className="text-xs font-bold text-rose-300">باقي {item.days_left} يوم</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
