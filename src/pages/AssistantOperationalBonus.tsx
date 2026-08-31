import { useState } from 'react';
import { Gift, Loader2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';

const ELIGIBLE_STAFF = [
  { id: '82b9c2a1-6139-4b07-9937-ef80a6e926d8', name: 'نور' },
  { id: 'e3640642-5c60-4815-8001-1bb93193668f', name: 'هاجر' },
  { id: 'dea91886-1ae8-4766-a166-9952866a5024', name: 'هبة حماده' },
];

type Target = 'team' | string;

export default function AssistantOperationalBonus() {
  const [target, setTarget] = useState<Target>('team');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('مكافأة تميز مفاجئة');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const pointsValue = Number(points);
    if (!pointsValue || pointsValue <= 0) {
      toast.error('اكتب عدد نقاط صحيح أكبر من صفر.');
      return;
    }
    setSubmitting(true);
    try {
      if (target === 'team') {
        const { error } = await supabase.rpc('grant_assistant_operational_team_bonus_v1', {
          p_points: pointsValue,
          p_reason: reason.trim() || 'مكافأة تميز — الفريق كله',
        });
        if (error) throw error;
        toast.success(`اتضافت ${pointsValue} نقطة للتلاتة`);
      } else {
        const staffName = ELIGIBLE_STAFF.find((s) => s.id === target)?.name || '';
        const { error } = await supabase.rpc('grant_assistant_operational_bonus_v1', {
          p_staff_id: target,
          p_points: pointsValue,
          p_reason: reason.trim() || 'مكافأة تميز مفاجئة',
        });
        if (error) throw error;
        toast.success(`اتضافت ${pointsValue} نقطة لـ ${staffName}`);
      }
      setPoints('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ في المنح');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>مكافأة تميز مفاجئة</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          لنور وهاجر وهبة حماده — فردًا أو كفريق، بأي عدد نقاط تحدده دلوقتي.
        </p>
      </div>

      <Panel className="p-4 space-y-4">
        <SectionTitle title="اختار مين يستاهل المكافأة" icon={<Gift size={18} />} />

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setTarget('team')}
            className="flex w-full items-center gap-3 rounded-xl border p-3 text-right transition"
            style={{
              borderColor: target === 'team' ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
              background: target === 'team' ? 'var(--dawaa-theme-soft)' : 'transparent',
            }}
          >
            <Users size={18} style={{ color: 'var(--dawaa-theme-primary-strong)' }} />
            <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>الفريق كله (نور وهاجر وهبة حماده)</span>
          </button>
          {ELIGIBLE_STAFF.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTarget(s.id)}
              className="flex w-full items-center gap-3 rounded-xl border p-3 text-right transition"
              style={{
                borderColor: target === s.id ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                background: target === s.id ? 'var(--dawaa-theme-soft)' : 'transparent',
              }}
            >
              <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{s.name}</span>
            </button>
          ))}
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>عدد النقاط</p>
          <input
            type="number"
            min="1"
            className="input-dark w-full text-sm"
            placeholder="مثلًا: 20"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>سبب المكافأة</p>
          <input
            type="text"
            className="input-dark w-full text-sm"
            placeholder="مكافأة تميز مفاجئة"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white transition"
          style={{ background: 'var(--dawaa-theme-primary)' }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
          امنح المكافأة الآن
        </button>
      </Panel>
    </div>
  );
}
