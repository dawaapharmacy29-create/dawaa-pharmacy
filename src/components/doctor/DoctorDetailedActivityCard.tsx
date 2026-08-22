import { useEffect, useState } from 'react';
import { Headphones, MessageSquare, PackageSearch, Timer, UserRound } from 'lucide-react';
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

type CustomerRequestRow = { id: string; medicine_name: string | null; status: string | null; points_awarded: number | null };
type FollowupRow = { id: string; customer_name: string | null; followup_reason: string | null; points_value: number | null };
type PillarRow = { pillar_key: string; points: number };
type TabKey = 'conversations' | 'stock' | 'requests' | 'followups';

function monthCycleNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function scoreBadge(score: number) {
  if (score >= 90) return 'dawaa-badge--success';
  if (score >= 70) return 'dawaa-badge--warning';
  return 'dawaa-badge--danger';
}

export default function DoctorDetailedActivityCard({ staffId, doctorName }: { staffId: string; doctorName?: string }) {
  const [reviews, setReviews] = useState<ConversationReview[]>([]);
  const [stock, setStock] = useState<{ list_priority: StockItem[]; expiry_priority: StockItem[] } | null>(null);
  const [requests, setRequests] = useState<CustomerRequestRow[]>([]);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [pillars, setPillars] = useState<PillarRow[]>([]);
  const [tab, setTab] = useState<TabKey | null>(null);

  useEffect(() => {
    if (!staffId) return;
    const month = monthCycleNow();
    void supabase
      .rpc('get_doctor_conversation_reviews_list', { p_doctor_id: staffId, p_limit: 20 })
      .then(({ data }) => setReviews((data as ConversationReview[]) || []));
    void supabase
      .rpc('get_doctor_priority_stock_items', { p_doctor_id: staffId })
      .then(({ data }) => setStock(data as { list_priority: StockItem[]; expiry_priority: StockItem[] }));
    void supabase
      .from('customer_requests')
      .select('id,medicine_name,status,points_awarded')
      .eq('doctor_id', staffId)
      .gte('created_at', `${month}-01`)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setRequests((data as CustomerRequestRow[]) || []));
    if (doctorName) {
      void supabase
        .from('daily_followups')
        .select('id,customer_name,followup_reason,points_value')
        .eq('assigned_doctor', doctorName)
        .gte('created_at', `${month}-01`)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data }) => setFollowups((data as FollowupRow[]) || []));
    }
    void supabase
      .rpc('get_doctor_pillar_breakdown', { p_staff_id: staffId })
      .then(({ data }) => setPillars((data as PillarRow[]) || []));
  }, [staffId, doctorName]);

  const pillarPoints = (key: string) => pillars.find((p) => p.pillar_key === key)?.points ?? 0;

  const tabs: Array<{ key: TabKey; icon: typeof MessageSquare; label: string; count: number; points: number }> = [
    { key: 'conversations', icon: MessageSquare, label: 'المحادثات', count: reviews.length, points: pillarPoints('محادثات') },
    { key: 'stock', icon: PackageSearch, label: 'اللستة والرواكد', count: (stock?.list_priority?.length || 0) + (stock?.expiry_priority?.length || 0), points: pillarPoints('الرواكد') },
    { key: 'requests', icon: UserRound, label: 'طلبات العملاء', count: requests.length, points: pillarPoints('طلبات العملاء') },
    { key: 'followups', icon: Headphones, label: 'طلبات المتابعة', count: followups.length, points: pillarPoints('متابعات') },
  ];

  return (
    <div className="dawaa-card p-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(active ? null : t.key)}
              className={`dawaa-card dawaa-card--interactive flex flex-col items-center gap-1 p-3 text-center ${active ? 'dawaa-card--raised' : 'dawaa-card--soft'}`}
              aria-pressed={active}
            >
              <Icon size={16} className={active ? 'dawaa-heading' : 'dawaa-muted'} />
              <span className="dawaa-title text-xs">{t.label}</span>
              <span className="dawaa-caption text-[11px] font-bold">{t.count} · {t.points} نقطة</span>
            </button>
          );
        })}
      </div>

      {tab === 'conversations' ? (
        <div className="mt-4 space-y-2">
          {reviews.length === 0 ? (
            <EmptyText>لسه مفيش تقييمات محادثات مسجّلة لك.</EmptyText>
          ) : (
            reviews.map((r, i) => (
              <div key={i} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="dawaa-caption text-xs font-bold">{r.review_date}</p>
                  {r.top_deduction_reason && r.top_deduction_reason !== 'تقييم محادثة ممتاز' ? (
                    <p className="dawaa-caption mt-1 text-xs">{r.top_deduction_reason}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`dawaa-badge ${scoreBadge(r.total_score)}`}>{r.total_score}/100</span>
                  {r.points_value != null ? (
                    <span className="dawaa-badge dawaa-badge--info">{r.points_value > 0 ? '+' : ''}{r.points_value} نقطة</span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'stock' ? (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="dawaa-title text-sm">أهم أصناف اللستة محتاجة تركيزك</h3>
            <div className="mt-2 space-y-2">
              {!stock?.list_priority?.length ? (
                <EmptyText>لسه مفيش أصناف لستة متاحة.</EmptyText>
              ) : (
                stock.list_priority.map((item, i) => (
                  <div key={i} className="dawaa-card dawaa-card--soft p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="dawaa-title text-sm">{item.name}</span>
                      <span className="dawaa-caption text-xs font-bold">{item.sold_quantity || 0} من {item.target_min_quantity || '؟'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <h3 className="dawaa-title flex items-center gap-1.5 text-sm"><Timer size={14} /> أصناف قربت تنتهي صلاحيتها</h3>
            <div className="mt-2 space-y-2">
              {!stock?.expiry_priority?.length ? (
                <EmptyText>مفيش أصناف قريبة من الانتهاء حاليًا.</EmptyText>
              ) : (
                stock.expiry_priority.map((item, i) => (
                  <div key={i} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 p-3">
                    <span className="dawaa-title text-sm">{item.name}</span>
                    <span className="dawaa-badge dawaa-badge--danger">باقي {item.days_left} يوم</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'requests' ? (
        <div className="mt-4 space-y-2">
          {requests.length === 0 ? (
            <EmptyText>لسه مفيش طلبات عملاء مسجّلة لك الشهر ده.</EmptyText>
          ) : (
            requests.map((r) => (
              <div key={r.id} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="dawaa-title text-sm">{r.medicine_name || 'صنف غير محدد'}</p>
                  <p className="dawaa-caption mt-1 text-xs font-bold">{r.status || '—'}</p>
                </div>
                {r.points_awarded != null ? <span className="dawaa-badge dawaa-badge--info">+{r.points_awarded} نقطة</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'followups' ? (
        <div className="mt-4 space-y-2">
          {followups.length === 0 ? (
            <EmptyText>لسه مفيش طلبات متابعة مسجّلة لك الشهر ده.</EmptyText>
          ) : (
            followups.map((f) => (
              <div key={f.id} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="dawaa-title text-sm">{f.customer_name || 'عميل غير محدد'}</p>
                  <p className="dawaa-caption mt-1 text-xs font-bold">{f.followup_reason || '—'}</p>
                </div>
                {f.points_value != null ? <span className="dawaa-badge dawaa-badge--info">+{f.points_value} نقطة</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="dawaa-caption text-sm">{children}</p>;
}
