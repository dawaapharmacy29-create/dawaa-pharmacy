import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Smartphone } from 'lucide-react';
import {
  Panel,
  SectionTitle,
  EmptyState,
  MiniBox,
} from '@/components/dashboard/DashboardPrimitives';
import {
  WALLET_LABELS,
  isLateTransfer,
  loadCollectionSettlement,
  type CollectionSettlement,
  type CollectionTransfer,
} from '@/lib/collectionSettlement';

const money = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
const dayLabel = (value?: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', {
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
      })
    : '-';
const timeLabel = (value?: string | null) =>
  value ? new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : 'لم تتم المزامنة';

function TransferRow({ t }: { t: CollectionTransfer }) {
  const late = t.days !== undefined && isLateTransfer(t);
  return (
    <tr>
      <td>{dayLabel(t.date)}</td>
      <td>{WALLET_LABELS[t.wallet] ?? t.wallet}</td>
      <td className="font-black">{money(t.amount)}</td>
      <td>{t.recipient || '-'}</td>
      <td>{t.notes || '-'}</td>
      <td>
        {t.confirmed_at ? (
          <span className="dawaa-badge dawaa-badge--success">
            {t.historical ? 'رصيد قديم · ' : ''}اتأكد {dayLabel(t.confirmed_at)}
            {t.confirmed_by ? ` · ${t.confirmed_by}` : ''}
          </span>
        ) : (
          <span className={`dawaa-badge ${late ? 'dawaa-badge--danger' : 'dawaa-badge--warning'}`}>
            {t.days ? `مستني من ${t.days} يوم` : 'مستني من النهارده'}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function CollectionSettlementPanel() {
  const [data, setData] = useState<CollectionSettlement | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await loadCollectionSettlement());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (error || !data)
    return <EmptyState label="تعذّر تحميل تسوية التحصيلات" error onRetry={() => void load()} />;

  const balance = data.wallets.reduce((a, w) => a + Number(w.balance || 0), 0);
  const pendingAmount = data.pending.reduce((a, t) => a + Number(t.amount || 0), 0);
  const late = data.pending.filter(isLateTransfer);
  const stale = !data.synced_at || Date.now() - new Date(data.synced_at).getTime() > 3600e3;

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title="تسوية التحصيلات — فروع دواء بيلز" icon={<Smartphone size={18} />} />
          <a
            href="https://dawaabill.base44.app/shift-handover"
            target="_blank"
            rel="noreferrer"
            className="dawaa-badge dawaa-badge--info inline-flex items-center gap-1 rounded-xl px-3 py-1 text-xs font-black"
          >
            <ExternalLink className="h-3 w-3" /> افتح دواء بيلز
          </a>
        </div>
        <p className="dawaa-caption text-xs">
          فلوس فودافون كاش وإنستا باي والفيزا اللي اتحصّلت في شيفتات زكريا وبسيسة والمنشية: اللي لسه
          عند الفروع، والتحويلات اللي المحاسب لسه ما أكدهاش. بداية التسوية{' '}
          {dayLabel(data.start_date)} · آخر مزامنة {timeLabel(data.synced_at)}
        </p>
        {stale ? (
          <p className="dawaa-alert dawaa-alert--warning mt-2 text-xs font-bold">
            المزامنة مع دواء بيلز متأخرة، الأرقام ممكن تكون قديمة.
          </p>
        ) : null}
        {data.unknown_events ? (
          <p className="dawaa-alert dawaa-alert--warning mt-2 text-xs font-bold">
            فيه {data.unknown_events} حركة من نوع جديد في دواء بيلز مش محسوبة هنا؛ راجع الرصيد هناك.
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniBox label="لسه ما اتحولش للمحاسب" value={money(balance)} tone="amber" />
        {data.wallets.map((w) => (
          <MiniBox
            key={w.wallet}
            label={WALLET_LABELS[w.wallet] ?? w.wallet}
            value={money(w.balance)}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniBox label="تحصيلات النهارده" value={money(data.collected.today)} tone="blue" />
        <MiniBox label="تحصيلات امبارح" value={money(data.collected.yesterday)} tone="blue" />
        <MiniBox label="تحصيلات الشهر" value={money(data.collected.month)} tone="green" />
      </div>

      <Panel className="p-4">
        <SectionTitle title="تحويلات مستنية تأكيد المحاسب" icon={<AlertTriangle size={18} />} />
        {data.pending.length ? (
          <>
            <p className="mb-2 text-sm font-bold">
              {data.pending.length} تحويل بإجمالي {money(pendingAmount)}
              {late.length ? ` · ${late.length} متأخر أكتر من يوم` : ''}
            </p>
            <div className="overflow-x-auto">
              <table className="dawaa-table w-full min-w-[600px] text-right text-sm">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>المحفظة</th>
                    <th>المبلغ</th>
                    <th>المستلم</th>
                    <th>ملاحظات</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pending.map((t) => (
                    <TransferRow key={t.id} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p
            className="inline-flex items-center gap-2 text-sm font-bold"
            style={{ color: 'var(--dawaa-status-success-text)' }}
          >
            <CheckCircle2 size={16} /> كل التحويلات اتأكدت
          </p>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionTitle title="الرصيد بالتفصيل" icon={<Smartphone size={18} />} />
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full text-right text-sm">
              <thead>
                <tr>
                  <th>المحفظة</th>
                  <th>افتتاحي</th>
                  <th>اتحصّل</th>
                  <th>اتحوّل</th>
                  <th>الباقي</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.map((w) => (
                  <tr key={w.wallet}>
                    <td className="font-bold">{WALLET_LABELS[w.wallet] ?? w.wallet}</td>
                    <td>{money(w.opening)}</td>
                    <td>{money(w.collected)}</td>
                    <td>{money(w.transferred)}</td>
                    <td className="font-black">{money(w.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="p-4">
          <SectionTitle title="تحصيلات الشهر حسب الفرع" icon={<Smartphone size={18} />} />
          {data.collected.by_branch.length ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {data.collected.by_branch.map((b) => (
                <MiniBox key={b.branch} label={b.branch} value={money(b.amount)} />
              ))}
            </div>
          ) : (
            <p className="dawaa-caption text-sm">مفيش تحصيلات الشهر ده لسه</p>
          )}
        </Panel>
      </div>

      {data.confirmed.length ? (
        <Panel className="p-4">
          <SectionTitle title="آخر التحويلات المؤكدة" icon={<CheckCircle2 size={18} />} />
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full min-w-[600px] text-right text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المحفظة</th>
                  <th>المبلغ</th>
                  <th>المستلم</th>
                  <th>ملاحظات</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.confirmed.map((t) => (
                  <TransferRow key={t.id} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
