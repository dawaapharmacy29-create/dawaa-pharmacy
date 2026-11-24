import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ClipboardCheck, Loader2 } from 'lucide-react';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import type { DailyTask } from '@/lib/customerServiceTasks/api';
import {
  loadPurchaseDay,
  loadTransferDay,
  pairTransfers,
  transferProgress,
} from '@/lib/customerServiceTasks/morning';
import { freshness, loadMorningUploads } from '@/lib/customerServiceTasks/morningFiles';
import { cairoToday } from '@/lib/evaluationLab/reviewSamples';

// التشيك ليست بتاعة فريق خدمة العملاء أول ما يوصلوا، بالترتيب (صاحب الصيدلية 2026-11-24). كل بند بيتعلّم تلقائي من الشغل نفسه،
// مفيش علامة بالإيد: الفواتير اتراجعت، التحويلات اتأكدت، العملاء الجدد اتكلموا، والشيت خلص.

type Count = { done: number; total: number } | null;

const NEW_SOURCES = new Set(['new_customer', 'uncoded_note']);

function Item({
  n,
  title,
  hint,
  count,
  to,
}: {
  n: number;
  title: string;
  hint: string;
  count: Count;
  to?: string;
}) {
  const done = !!count && count.done >= count.total;
  const body = (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] p-3 transition hover:bg-[var(--dawaa-theme-soft)]">
      <span className={done ? 'text-[var(--dawaa-status-success-text)]' : 'opacity-50'}>
        {done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-black">
          {n}. {title}
        </div>
        <div className="text-xs opacity-70">{hint}</div>
      </div>
      <span className="whitespace-nowrap text-sm font-black">
        {count == null ? (
          <Loader2 size={16} className="animate-spin" />
        ) : count.total ? (
          `${count.done} / ${count.total}`
        ) : (
          'مفيش'
        )}
      </span>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function MorningChecklist({ tasks }: { tasks: DailyTask[] | null }) {
  const [purchases, setPurchases] = useState<Count>(null);
  const [transfers, setTransfers] = useState<Count>(null);
  const [files, setFiles] = useState<Count>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    // ملفات الصبح لوحدها، عشان لو فشلت ماتوقفش باقي البنود.
    loadMorningUploads()
      .then((u) => {
        const f = freshness(u, cairoToday());
        setFiles({ done: Object.values(f).filter(Boolean).length, total: 4 });
      })
      .catch(() => setFiles({ done: 0, total: 4 }));
    try {
      const [p, t] = await Promise.all([loadPurchaseDay(null), loadTransferDay(null)]);
      setPurchases({ done: p.invoices.filter((i) => i.check).length, total: p.invoices.length });
      setTransfers(transferProgress(pairTransfers(t.purchases, t.sales)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPurchases({ done: 0, total: 0 });
      setTransfers({ done: 0, total: 0 });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const newOnes = tasks ? tasks.filter((t) => NEW_SOURCES.has(t.source)) : null;
  const others = tasks ? tasks.filter((t) => !NEW_SOURCES.has(t.source)) : null;
  const count = (list: DailyTask[] | null): Count =>
    list ? { done: list.filter((t) => t.result).length, total: list.length } : null;

  return (
    <Panel>
      <SectionTitle
        icon={<ClipboardCheck size={18} />}
        title="التشيك ليست أول ما توصلي"
        subtitle="بالترتيب · كل بند بيتعلّم لوحده لما الشغل يخلص"
      />
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <Item
          n={0}
          title="ارفعي ملفات الصبح الأول"
          hint="المبيعات وأصنافها والعملاء والمشتريات. بعدها دوسي «جهّز مهام النهارده» عشان كل حاجة تظهر صح"
          count={files}
          to="/customer-service-tasks?tab=files"
        />
        <Item
          n={1}
          title="راجعي فواتير مشتريات امبارح"
          hint="من ٩ الصبح امبارح لـ ٩ الصبح النهارده لفرعك: اعتماد أو تعديل أو فيها مشكلة"
          count={purchases}
          to="/customer-service-tasks?tab=purchases"
        />
        <Item
          n={2}
          title="راجعي التحويلات بين الفرعين"
          hint="كل شراء من الفرع التاني قصاد فاتورة البيع بتاعته: الأصناف والكميات"
          count={transfers}
          to="/customer-service-tasks?tab=transfers"
        />
        <Item
          n={3}
          title="كوّدي العملاء الجدد وابعتيلهم الترحيب"
          hint="في الشيت الأول «العملاء الجداد»: كود بي كونكت ← التليفون ← رسالة الترحيب. اللي ناقصه خطوة بيرجع بكرة"
          count={count(newOnes)}
        />
        <Item
          n={4}
          title="كمّلي باقي مهام الشيت"
          hint="المتابعات والطلبات والمنتظمين واللي قلّلوا — وفي الآخر ارفعي الشيت وصدّري المحادثات"
          count={count(others)}
        />
      </div>
      {error ? (
        <p className="mt-2 text-xs text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
    </Panel>
  );
}
