import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, UserX } from 'lucide-react';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import {
  UNCODED_REASONS,
  loadUncodedAnalysis,
  pct,
  type UncodedAnalysis,
  type UncodedReason,
} from '@/lib/uncodedInvoices';

// «الفواتير اللي مش متكودة»: كام فاتورة في كل فرع على كود ٧ أو من غير كود، الدكتور كتب ملاحظة ولا لأ، والملاحظة
// بتقول إيه. صفحة متابعة للإدارة؛ لو ظهرت مشكلة ممكن تدخل في التقييم بعدين.

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const n = (v: number) => v.toLocaleString('ar-EG');
const dm = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

const REASON_COLOR: Record<UncodedReason, string> = {
  none: '#dc2626',
  data: '#0f766e',
  refused: '#b45309',
  child: '#2563eb',
  hurry: '#7c3aed',
  no_phone: '#64748b',
  bad_number: '#db2777',
  other: '#94a3b8',
};

export default function UncodedInvoicesAnalysis() {
  const today = cairoToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<UncodedAnalysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setData(await loadUncodedAnalysis(from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const doctors = useMemo(
    () => (data?.doctors ?? []).filter((d) => !branch || d.branch === branch),
    [data, branch]
  );
  const days = useMemo(() => {
    const map = new Map<string, { day: string; uncoded: number; no_note: number; total: number }>();
    for (const d of data?.days ?? []) {
      if (branch && d.branch !== branch) continue;
      const e = map.get(d.day) ?? { day: d.day, uncoded: 0, no_note: 0, total: 0 };
      e.uncoded += d.uncoded;
      e.no_note += d.no_note;
      e.total += d.total;
      map.set(d.day, e);
    }
    return [...map.values()];
  }, [data, branch]);
  const maxDay = Math.max(1, ...days.map((d) => d.uncoded));

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <Panel>
        <SectionTitle
          icon={<UserX size={18} />}
          title="الفواتير اللي مش على كود عميل"
          subtitle="فواتير على كود ٧ أو من غير كود: الدكتور كتب ملاحظة ولا لأ، والسبب إيه. للمتابعة، ومش داخلة في التقييم."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-1 font-bold">
            من
            <input
              type="date"
              className="input-field !w-auto"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="inline-flex items-center gap-1 font-bold">
            لـ
            <input
              type="date"
              className="input-field !w-auto"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <select
            className="input-field !w-auto"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">الفرعين</option>
            <option value="فرع شكري">فرع شكري</option>
            <option value="فرع الشامي">فرع الشامي</option>
          </select>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} تحديث
          </button>
        </div>
      </Panel>

      {error ? (
        <Panel>
          <EmptyState label={error} />
        </Panel>
      ) : !data ? (
        <div className="flex justify-center p-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {data.branches
              .filter((b) => !branch || b.branch === branch)
              .map((b) => {
                const reasons = (Object.keys(UNCODED_REASONS) as UncodedReason[])
                  .map((k) => ({ k, v: b.reasons[k] ?? 0 }))
                  .filter((r) => r.v > 0)
                  .sort((a, c) => c.v - a.v);
                return (
                  <Panel key={b.branch}>
                    <div className="text-lg font-black">{b.branch}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <Stat label="كل الفواتير" value={n(b.total)} />
                      <Stat
                        label="مش متكودة"
                        value={`${n(b.uncoded)}`}
                        sub={`${pct(b.uncoded, b.total)}%`}
                        warn
                      />
                      <Stat
                        label="من غير ملاحظة"
                        value={n(b.no_note)}
                        sub={`${pct(b.no_note, b.uncoded)}% منهم`}
                        warn={b.no_note > b.with_note}
                      />
                    </div>
                    <div className="mt-3 flex h-3 overflow-hidden rounded-full">
                      {reasons.map((r) => (
                        <div
                          key={r.k}
                          style={{
                            width: `${pct(r.v, b.uncoded)}%`,
                            background: REASON_COLOR[r.k],
                          }}
                          title={`${UNCODED_REASONS[r.k]}: ${r.v}`}
                        />
                      ))}
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {reasons.map((r) => (
                        <li key={r.k} className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: REASON_COLOR[r.k] }}
                          />
                          <span className="flex-1">{UNCODED_REASONS[r.k]}</span>
                          <span className="font-black">{n(r.v)}</span>
                          <span className="w-12 text-left text-xs opacity-60">
                            {pct(r.v, b.uncoded)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                );
              })}
          </div>

          <Panel>
            <SectionTitle
              title="الدكاترة"
              subtitle="مرتبين بعدد الفواتير المش متكودة اللي من غير أي ملاحظة"
            />
            {doctors.length === 0 ? (
              <EmptyState label="مفيش فواتير مش متكودة في الفترة دي" />
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--dawaa-theme-soft)] text-xs">
                    <tr className="text-right">
                      <th className="p-2">الدكتور</th>
                      <th className="p-2">فواتيره</th>
                      <th className="p-2">مش متكودة</th>
                      <th className="p-2">من غير ملاحظة</th>
                      <th className="p-2">كاتب البيانات</th>
                      <th className="p-2">رفض</th>
                      <th className="p-2">طفل</th>
                      <th className="p-2">مستعجل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doctors.map((d) => {
                      const silent = pct(d.no_note, d.uncoded);
                      return (
                        <tr
                          key={`${d.branch}|${d.seller}`}
                          className="border-t border-[var(--dawaa-theme-border)]"
                        >
                          <td className="p-2">
                            <span className="font-bold">{d.seller}</span>
                            {!branch ? (
                              <span className="block text-[11px] opacity-60">{d.branch}</span>
                            ) : null}
                          </td>
                          <td className="p-2">{n(d.total)}</td>
                          <td className="p-2">
                            <span className="font-black">{n(d.uncoded)}</span>
                            <span className="mr-1 text-xs opacity-60">
                              {pct(d.uncoded, d.total)}%
                            </span>
                          </td>
                          <td className="p-2">
                            <span
                              className={`font-black ${
                                silent >= 70 && d.no_note >= 5
                                  ? 'text-[var(--dawaa-status-danger-text)]'
                                  : ''
                              }`}
                            >
                              {n(d.no_note)}
                            </span>
                            <span className="mr-1 text-xs opacity-60">{silent}%</span>
                          </td>
                          <td className="p-2">{d.data ? n(d.data) : '—'}</td>
                          <td className="p-2">{d.refused ? n(d.refused) : '—'}</td>
                          <td className="p-2">{d.child ? n(d.child) : '—'}</td>
                          <td className="p-2">{d.hurry ? n(d.hurry) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs opacity-60">
              الاسم زي ما هو في ملف المبيعات؛ لو الدكتور متسجل بطريقتين (زي «اميرة» و«اميره») بيظهر
              في سطرين.
            </p>
          </Panel>

          <Panel>
            <SectionTitle
              title="يوم بيوم"
              subtitle="الأحمر: من غير ملاحظة · الرمادي: عليها ملاحظة"
            />
            <div className="mt-3 flex h-40 items-end gap-1 overflow-x-auto">
              {days.map((d) => (
                <div
                  key={d.day}
                  className="flex min-w-[1.6rem] flex-1 flex-col items-center"
                  title={`${dm(d.day)}: ${d.uncoded} مش متكودة من ${d.total}، ${d.no_note} من غير ملاحظة`}
                >
                  <div className="flex w-full flex-col justify-end" style={{ height: '8.5rem' }}>
                    <div
                      className="w-full rounded-t bg-slate-300"
                      style={{ height: `${((d.uncoded - d.no_note) / maxDay) * 100}%` }}
                    />
                    <div
                      className="w-full bg-red-500"
                      style={{ height: `${(d.no_note / maxDay) * 100}%` }}
                    />
                  </div>
                  <span className="mt-1 text-[10px] opacity-60">{dm(d.day)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-2">
      <div className="text-[11px] font-bold opacity-70">{label}</div>
      <div className={`text-xl font-black ${warn ? 'text-[var(--dawaa-status-danger-text)]' : ''}`}>
        {value}
      </div>
      {sub ? <div className="text-[11px] opacity-60">{sub}</div> : null}
    </div>
  );
}
