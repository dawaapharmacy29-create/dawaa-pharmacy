import { useEffect, useMemo, useState } from 'react';
import { Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { TABLES } from '@/lib/supabaseTables';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';
import { useAuth } from '@/hooks/useAuth';
import { isManagerRole, isDoctorRole } from '@/lib/security/userDataScope';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import {
  calculateCompositeScore,
  type CompositeScoreResult,
} from '@/lib/incentives/compositeScoreService';

const PILLAR_COLORS: Record<string, string> = {
  sales: 'from-teal-400 to-teal-600',
  conversations: 'from-sky-400 to-sky-600',
  customer_service: 'from-amber-400 to-amber-600',
  data_quality: 'from-purple-400 to-purple-600',
  discipline: 'from-rose-400 to-rose-600',
};

function scoreTone(score: number) {
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-red-300';
}

export default function DoctorPerformancePillars() {
  const { user } = useAuth();
  const managerView = isManagerRole(user);
  const currentCycle = monthCycleFromDate(new Date());
  const [cycle, setCycle] = useState(currentCycle);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [result, setResult] = useState<CompositeScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: staff = [] } = useSupabaseQuery<StaffChoice & { role?: string }>({
    table: TABLES.staff,
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });
  const staffChoices = useMemo(() => mergeStaffChoices(staff), [staff]);
  const doctorChoices = useMemo(
    () => (managerView ? staffChoices : staffChoices.filter((s) => s.id === (user?.staffId || user?.id))),
    [staffChoices, managerView, user?.staffId, user?.id]
  );

  useEffect(() => {
    if (!selectedStaffId && doctorChoices.length) {
      const defaultId = managerView ? doctorChoices[0]?.id : (user?.staffId || user?.id || doctorChoices[0]?.id);
      if (defaultId) setSelectedStaffId(defaultId);
    }
  }, [doctorChoices, managerView, user?.staffId, user?.id, selectedStaffId]);

  useEffect(() => {
    if (!selectedStaffId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    calculateCompositeScore(selectedStaffId, cycle)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'تعذر حساب الدرجة المركّبة');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStaffId, cycle]);

  if (!isDoctorRole(user) && !managerView) {
    return (
      <div dir="rtl" className="p-6 text-sm text-slate-400">
        هذه الصفحة متاحة للدكاترة والإدارة فقط.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Gauge className="h-6 w-6 text-teal-300" />
        <div>
          <h1 className="text-xl font-black text-white">الدرجة المركّبة للأداء</h1>
          <p className="text-sm text-slate-400">توزيع أدائك على 5 محاور موزونة بدل رقم واحد مبهم.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {managerView && (
          <select
            className="input-dark"
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
          >
            {doctorChoices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="month"
          className="input-dark"
          value={cycle}
          onChange={(e) => setCycle(e.target.value)}
        />
      </div>

      {loading && <p className="text-sm text-slate-400">جارٍ الحساب...</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {result && !loading && (
        <>
          <div className="stat-card flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">الدرجة المركّبة الإجمالية</div>
              <div className={`text-4xl font-black ${scoreTone(result.compositeScore)}`}>
                {result.compositeScore}
                <span className="text-lg text-slate-500"> / 100</span>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              مبني على {result.transactionCount} معاملة نقاط خلال الدورة
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {result.pillars.map((pillar) => (
              <div key={pillar.key} className="stat-card space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-black text-white">{pillar.label}</span>
                  <span className="text-xs font-bold text-slate-400">وزن {Math.round(pillar.weight * 100)}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${PILLAR_COLORS[pillar.key]}`}
                    style={{ width: `${pillar.subScore}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className={scoreTone(pillar.subScore)}>{pillar.subScore.toFixed(0)} / 100</span>
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    {pillar.rawPointsDelta >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-400" />
                    )}
                    صافي النقاط: {pillar.rawPointsDelta >= 0 ? '+' : ''}
                    {pillar.rawPointsDelta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {result.unmappedPointsDelta !== 0 && (
            <p className="text-xs text-slate-500">
              ملاحظة: {result.unmappedPointsDelta >= 0 ? '+' : ''}
              {result.unmappedPointsDelta} نقطة من معاملات غير مربوطة بكود قاعدة معروف، مش داخلة في حساب المحاور.
            </p>
          )}
        </>
      )}
    </div>
  );
}
