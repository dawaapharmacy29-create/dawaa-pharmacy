import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { MiniBox, Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  loadCompetition,
  markCoupon,
  saveCreditSettings,
  type Competition,
  type CompetitionMember,
  type Coupon,
} from '@/lib/customerServiceTasks/api';

// المسابقة والكريديت: كل واحدة بتتقاس على اللي كان هيحصل لوحده في فرعها، والنقط بتتحسب من الشيت والفواتير.

const pct = (n: number) => `${Math.round(n * 100)}%`;
const egp = (n: number) => `${Math.round(n).toLocaleString('en-US')} ج`;

function previousCycle(start: string): string {
  const [y, m] = start.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 26));
  return d.toISOString().slice(0, 10);
}

const COUPON_STATUS: Record<Coupon['status'], string> = {
  active: 'لسه صالح',
  used: 'اتستخدم',
  review: 'اشترى من غير الخصم، راجعه',
  expired: 'انتهى من غير استخدام',
  cancelled: 'اتلغى',
  free_delivery: 'توصيل مجاني',
};

function Item({ title, points, weight, detail }: { title: string; points: number; weight: number; detail: string }) {
  const fill = Math.min(points / weight, 1);
  return (
    <div className="mt-3">
      <div className="flex justify-between text-sm">
        <span>{title}</span>
        <b>
          {Math.round(points * 10) / 10} / {weight}
        </b>
      </div>
      <div className="my-1 h-2 rounded-full bg-[var(--dawaa-theme-border)]">
        <div className="h-2 rounded-full bg-teal-600" style={{ width: `${Math.round(fill * 100)}%` }} />
      </div>
      <div className="text-xs opacity-70">{detail}</div>
    </div>
  );
}

function MemberCard({ m, first, comp }: { m: CompetitionMember; first: boolean; comp: Competition }) {
  const roi = m.coupon_cost > 0 ? m.coupon_extra / m.coupon_cost : 0;
  return (
    <div
      className={`rounded-3xl border p-4 ${first ? 'border-2 border-teal-600' : 'border-[var(--dawaa-theme-border)]'}`}
    >
      <div className="flex items-center gap-3">
        {first ? <Trophy className="text-amber-500" size={22} /> : null}
        <div className="flex-1">
          <div className="text-lg font-black">{m.name ?? '—'}</div>
          <div className="text-xs opacity-70">
            {m.branch} · {m.work_days} يوم شغل
            {m.eligible ? '' : ' · لسه مش مستوفية شروط الدخول (إنجاز ٧٠٪ و١٥ يوم)'}
          </div>
        </div>
        <div className="text-3xl font-black">{Math.round(m.score)}</div>
      </div>
      <Item
        title="رجّعت عملاء بطّلوا أو قلّلوا"
        points={m.p_returned}
        weight={25}
        detail={`${m.returned} من ${m.reached_back} ردوا اشتروا خلال ١٤ يوم (${m.reached_back ? pct(m.returned / m.reached_back) : '0%'}) · الهدف ${pct(m.t_returned)}`}
      />
      <Item
        title="ثبّتت العملاء الجداد"
        points={m.p_new}
        weight={15}
        detail={`${m.new_back} من ${m.new_n} عميل جديد رجع اشترى خلال ٣٠ يوم (${m.new_n ? pct(m.new_back / m.new_n) : '0%'}) · الهدف ${pct(m.t_new)}`}
      />
      <Item
        title="زوّدت صرف العملاء"
        points={m.p_uplift}
        weight={35}
        detail={`${egp(m.uplift)} فوق المعتاد من ${m.spent_more} عميل · الهدف ${egp(comp.targets.uplift)}${m.uplift_pending ? ` · ${m.uplift_pending} عميل لسه بيتحسب` : ''}`}
      />
      <Item
        title="استخدام الكريديت"
        points={m.p_credit}
        weight={15}
        detail={`${m.coupons_used} من ${m.coupons_issued} كوبون اتستخدم · اتصرف ${egp(m.coupon_cost)} ورجّع ${egp(m.coupon_extra)} (${roi ? `${Math.round(roi * 10) / 10}×` : '—'}) · الهدف ${comp.targets.roi}×`}
      />
      <Item
        title="الشغل والدقة"
        points={m.p_work}
        weight={10}
        detail={`خلّصت ${pct(m.completion)} من الشيت · رفعت ${pct(m.upload_rate)} من الأيام · اختارت السبب في ${pct(m.reason_rate)}`}
      />
    </div>
  );
}

export default function CsCompetitionTab() {
  const [cycle, setCycle] = useState<string | null>(null);
  const [comp, setComp] = useState<Competition | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [budget, setBudget] = useState('');
  const [cap, setCap] = useState('');
  const [days, setDays] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const c = await loadCompetition(cycle);
      setComp(c);
      const b = c.branches[0];
      if (b) {
        setBudget(String(b.budget));
        setCap(String(b.cap));
        setDays(String(b.days));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cycle]);
  useEffect(() => {
    void load();
  }, [load]);

  async function mark(id: string, status: 'used' | 'not_used' | 'cancelled' | null) {
    setBusy(id);
    try {
      await markCoupon(id, status);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function saveCredit() {
    setBusy('credit');
    try {
      await saveCreditSettings(Number(budget), Number(cap), Number(days));
      toast.success('اتحفظت إعدادات الكريديت');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  if (error)
    return (
      <Panel>
        <div className="text-red-600">{error}</div>
        <button className="btn-secondary mt-2" onClick={() => void load()}>
          جرّب تاني
        </button>
      </Panel>
    );
  if (!comp)
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="animate-spin" />
      </div>
    );

  const current = cycle === null;
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-black">
            المسابقة · دورة {comp.cycle_start} لحد {comp.cycle_end}
          </h2>
          <div className="mr-auto flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => setCycle(previousCycle(comp.cycle_start))}
            >
              الدورة اللي قبلها
            </button>
            {current ? null : (
              <button className="btn-secondary" onClick={() => setCycle(null)}>
                الدورة الحالية
              </button>
            )}
            <button className="btn-secondary" onClick={() => void load()} aria-label="تحديث">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm opacity-70">
          النقط بتقيس الزيادة اللي جت من التواصل بس: العميل اللي رجع أو صرف أكتر من عادته بعد ما اتكلّم. لحد {comp.as_of}.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {comp.members.length ? (
            comp.members.map((m, i) => (
              <MemberCard key={m.staff_account_id} m={m} first={i === 0 && m.score > 0} comp={comp} />
            ))
          ) : (
            <div className="text-sm opacity-70">مفيش شغل متسجل في الدورة دي لسه.</div>
          )}
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-2 font-black">هدف الفريق: عملاء نشطين أكتر</h3>
        <p className="mb-2 text-sm opacity-70">
          العملاء اللي اشتروا في آخر ٣٠ يوم، مقارنة بأول الدورة. لو الفرعين زادوا ٥٪، الفريق كله ياخد المكافأة.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {comp.team.map((t) => {
            const change = t.start ? (t.now - t.start) / t.start : 0;
            return (
              <MiniBox
                key={t.branch}
                label={t.branch}
                value={`${t.now} (${change >= 0 ? '+' : ''}${Math.round(change * 100)}%)`}
                tone={change >= 0.05 ? 'green' : 'cyan'}
              />
            );
          })}
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-2 font-black">كريديت الفروع</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {comp.branches.map((b) => (
            <div key={b.branch} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
              <div className="mb-1 font-black">{b.branch}</div>
              <div>
                اتصرف {egp(b.used)} · محجوز {egp(b.active)} · فاضل <b>{egp(b.remaining)}</b> من {egp(b.budget)}
              </div>
              <div className="opacity-70">
                {b.used_n} من {b.issued} كوبون اتستخدم · رجّعوا {egp(b.extra)} زيادة
                {b.review_n ? ` · ${b.review_n} محتاجين مراجعة` : ''}
              </div>
            </div>
          ))}
        </div>
        {comp.can_manage ? (
          <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col">
              كريديت كل فرع في الدورة (ج)
              <input className="input-field w-36" value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" />
            </label>
            <label className="flex flex-col">
              أقصى حاجة للعميل (ج)
              <input className="input-field w-28" value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" />
            </label>
            <label className="flex flex-col">
              صلاحية الكوبون (يوم)
              <input className="input-field w-24" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
            </label>
            <button className="btn-secondary" disabled={busy === 'credit'} onClick={() => void saveCredit()}>
              <Save size={16} /> احفظ
            </button>
          </div>
        ) : null}
      </Panel>

      {comp.coupons ? (
        <Panel>
          <h3 className="mb-2 font-black">الكوبونات ({comp.coupons.length})</h3>
          <p className="mb-2 text-sm opacity-70">
            الكوبون بيتعلّم «اتستخدم» لوحده لو العميل اشترى من نفس الفرع في الصلاحية وعلى الفاتورة خصم قد الكوبون أو أكتر.
            لو اشترى من غير الخصم ده بيطلع «راجعه».
          </p>
          {comp.coupons.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right opacity-70">
                    <th className="p-2">العميل</th>
                    <th className="p-2">الفرع</th>
                    <th className="p-2">الكوبون</th>
                    <th className="p-2">من</th>
                    <th className="p-2">لحد</th>
                    <th className="p-2">مين</th>
                    <th className="p-2">الحالة</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {comp.coupons.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--dawaa-theme-border)]">
                      <td className="p-2">
                        {c.customer_name} ({c.customer_code})
                      </td>
                      <td className="p-2">{c.branch.replace('فرع ', '')}</td>
                      <td className="p-2">{c.kind === 'free_delivery' ? 'توصيل مجاني' : egp(c.amount)}</td>
                      <td className="p-2">{c.issued_on}</td>
                      <td className="p-2">{c.expires_on}</td>
                      <td className="p-2">{c.issued_by_name}</td>
                      <td className="p-2">
                        {COUPON_STATUS[c.status]}
                        {c.used_on ? ` · ${c.used_on} خصم ${egp(c.used_discount ?? 0)} من ${egp(c.used_net ?? 0)}` : ''}
                      </td>
                      <td className="p-2">
                        {c.status === 'review' || c.status === 'active' ? (
                          <div className="flex gap-1">
                            <button className="btn-secondary" disabled={busy === c.id} onClick={() => void mark(c.id, 'used')}>
                              اتستخدم
                            </button>
                            <button className="btn-secondary" disabled={busy === c.id} onClick={() => void mark(c.id, 'not_used')}>
                              ماتستخدمش
                            </button>
                            <button className="btn-secondary" disabled={busy === c.id} onClick={() => void mark(c.id, 'cancelled')}>
                              الغيه
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm opacity-70">مفيش كوبونات في الدورة دي.</div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
