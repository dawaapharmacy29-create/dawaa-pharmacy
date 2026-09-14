import { buildCurrentCyclePerformanceProfiles, type PerformanceProfile } from '@/lib/conversationAnalysis/conversationPerformanceProfiles';
import type { CycleConversationItem } from '@/lib/conversationAnalysis/conversationCycleAnalytics';

function rate(value: number | null) {
  return value == null ? '-' : `${value}%`;
}

function response(value: number | null) {
  if (value == null) return '-';
  return value < 60 ? `${Math.round(value)} ث` : `${Math.round(value / 60)} د`;
}

export default function ConversationPerformanceProfiles({ items }: { items: CycleConversationItem[] }) {
  const profiles = buildCurrentCyclePerformanceProfiles(items);
  if (!items.length) return null;

  return <section dir="rtl" className="space-y-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
    <div>
      <div className="text-lg font-black">ملف الأداء للدورة الحالية</div>
      <div className="mt-1 text-xs text-slate-400">{profiles.cycle.label} — النسبة تظهر مع حجم العينة حتى لا نرتب دكتورًا من شات واحد فوق دكتور لديه عشرات المحادثات.</div>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <ProfileTable title="أداء الفروع" rows={profiles.branches} />
      <ProfileTable title="أداء الدكاترة" rows={profiles.doctors} />
    </div>
  </section>;
}

function ProfileTable({ title, rows }: { title: string; rows: PerformanceProfile[] }) {
  return <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/30">
    <div className="p-3 font-black">{title}</div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-slate-950/50"><tr><th className="p-2 text-right">الاسم</th><th className="p-2 text-right">Conversion</th><th className="p-2 text-right">العينة</th><th className="p-2 text-right">الخدمة</th><th className="p-2 text-right">البيع</th><th className="p-2 text-right">أول رد</th><th className="p-2 text-right">Lost sales</th><th className="p-2 text-right">Follow-up</th><th className="p-2 text-right">بدون رد</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key} className="border-t border-slate-800 align-top"><td className="p-2"><div className="font-black">{row.label}</div><div className={`mt-1 text-[11px] ${row.sampleQuality === 'strong' || row.sampleQuality === 'usable' ? 'text-emerald-300' : 'text-amber-300'}`}>{row.sampleQualityLabel}</div>{row.weakestCriteria.length > 0 && <div className="mt-1 text-[11px] text-slate-500">أضعف: {row.weakestCriteria.map((x) => x.label).join('، ')}</div>}</td><td className="p-2 text-lg font-black text-emerald-200">{rate(row.conversionRate)}</td><td className="p-2"><div className="font-black">{row.eligibleSalesChats}</div><div className="text-[11px] text-slate-500">من {row.conversations} شات</div></td><td className="p-2">{rate(row.avgServiceScore)}</td><td className="p-2">{rate(row.avgCommercialScore)}</td><td className="p-2">{response(row.avgFirstResponseSeconds)}</td><td className="p-2">{rate(row.lostSalesRate)}</td><td className="p-2">{rate(row.followupRecoveryRate)}</td><td className="p-2">{row.unansweredMessages}</td></tr>)}</tbody>
      </table>
      {!rows.length && <div className="p-6 text-center text-sm text-slate-500">لا توجد محادثات في الدورة الحالية.</div>}
    </div>
  </div>;
}
