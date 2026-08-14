import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, History, Loader2, PackageSearch, RefreshCw, Send, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  exportWarehouseShortageWorkbook,
  getWarehouseShortageSnapshot,
  type WarehouseShortageSnapshot,
} from '@/lib/api/customerRequestWarehouseExport';
import {
  getWarehouseDispatchContext,
  recordWarehouseShortageDispatch,
  type WarehouseDispatchContext,
  type WarehouseGroupCycleMetric,
} from '@/lib/api/customerRequestWarehouseCycle';

export default function CustomerRequestWarehousePanel({ branch }: { branch: string }) {
  const [snapshot, setSnapshot] = useState<WarehouseShortageSnapshot | null>(null);
  const [cycle, setCycle] = useState<WarehouseDispatchContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const current = await getWarehouseShortageSnapshot(branch);
      setSnapshot(current);
      setCycle(await getWarehouseDispatchContext(current));
    } catch (error) {
      toast.error(`تعذر تجهيز طلب المخازن: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const exportFile = async () => {
    setExporting(true);
    try {
      const current = snapshot || await getWarehouseShortageSnapshot(branch);
      const context = cycle || await getWarehouseDispatchContext(current);
      await exportWarehouseShortageWorkbook(current, context.metricsByKey);
      toast.success(`تم تجهيز نسخة مراجعة: ${current.groups.length} صنف · ${current.totalQuantity} وحدة`);
    } catch (error) {
      toast.error(`تعذر تصدير ملف المخازن: ${(error as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const recordAndExport = async () => {
    if (!snapshot?.groups.length) return;
    if (cycle && !cycle.featureReady) {
      toast.error('سجل دورات المخازن غير مفعّل على قاعدة البيانات بعد.');
      return;
    }
    setRecording(true);
    try {
      const result = await recordWarehouseShortageDispatch(snapshot, notes);
      await exportWarehouseShortageWorkbook(snapshot, cycle?.metricsByKey || {});
      toast.success(`تم اعتماد دورة الإرسال${result?.dispatch_no ? ` رقم ${result.dispatch_no}` : ''} وتصدير Excel`);
      setNotes('');
      await load();
    } catch (error) {
      toast.error(`تعذر اعتماد إرسال المخازن: ${(error as Error).message}`);
    } finally {
      setRecording(false);
    }
  };

  const latestText = cycle?.latestDispatch
    ? `آخر إرسال #${cycle.latestDispatch.dispatch_no} · ${new Date(cycle.latestDispatch.sent_at).toLocaleString('ar-EG')}`
    : 'لم يتم تسجيل إرسال سابق';

  return (
    <section className="rounded-3xl border border-violet-400/20 bg-gradient-to-l from-violet-500/[0.08] via-[#102640] to-[#0a1a2d] p-4 shadow-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 font-black text-white"><FileSpreadsheet size={19} className="text-violet-300" /> دورة المخازن — الأصناف التي لم يتم توفيرها</div>
          <p className="mt-1 text-xs leading-6 text-slate-400">ملف موحد بالكود والاسم المعتمد، مع تاريخ الإرسال السابق والجديد والمتكرر وعمر النقص. نسخة المراجعة لا تُسجل كإرسال؛ التسجيل يتم فقط عند اعتماد الإرسال.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-300"><History size={12} className="ml-1 inline" />{latestText}</span>
            {cycle?.latestDispatch && <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-200">استجابة آخر دورة {cycle.latestResponseRate}% · تم حل {cycle.resolvedSinceLastGroups} صنف</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 text-xs">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button type="button" onClick={() => void exportFile()} disabled={loading || exporting || !snapshot?.groups.length} className="btn-secondary flex items-center gap-2 text-xs">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} تصدير للمراجعة
          </button>
          <button type="button" onClick={() => void recordAndExport()} disabled={loading || recording || !snapshot?.groups.length || cycle?.featureReady === false} className="btn-primary flex items-center gap-2 text-xs">
            {recording ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} اعتماد الإرسال + Excel
          </button>
        </div>
      </div>

      {cycle && !cycle.featureReady && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/[0.08] p-3 text-xs font-bold leading-6 text-amber-100">
          <AlertTriangle size={16} className="mt-1 shrink-0" />
          <span>واجهة الملف تعمل، لكن تسجيل دورات الإرسال يحتاج تطبيق Migration سجل المخازن على قاعدة البيانات. تم تعطيل زر «اعتماد الإرسال» حتى لا يعطي نتيجة وهمية.</span>
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex h-28 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/40"><Loader2 className="animate-spin text-violet-300" /></div>
      ) : snapshot ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <MiniStat label="أصناف مطلوبة" value={snapshot.groups.length} />
            <MiniStat label="إجمالي الكميات" value={snapshot.totalQuantity} />
            <MiniStat label="عاجل" value={snapshot.urgentRequests} warn={snapshot.urgentRequests > 0} />
            <MiniStat label="تحتاج ربط" value={snapshot.unlinkedGroups} warn={snapshot.unlinkedGroups > 0} />
            <MiniStat label="جديد منذ الإرسال" value={cycle?.newSinceLastGroups ?? snapshot.groups.length} accent />
            <MiniStat label="متكرر ≥ دورتين" value={cycle?.repeatedGroups ?? 0} warn={(cycle?.repeatedGroups || 0) > 0} />
            <MiniStat label="مزمن 3+ أيام" value={cycle?.staleGroups ?? 0} warn={(cycle?.staleGroups || 0) > 0} />
            <MiniStat label="تم حلها آخر دورة" value={cycle?.resolvedSinceLastGroups ?? 0} good />
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto]">
            <input className="input-dark" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظة على دورة الإرسال (اختياري): اسم المخزن، وقت التواصل، تعليمات خاصة..." />
            <div className="flex items-center rounded-xl border border-slate-700 bg-slate-950/45 px-3 text-[11px] font-bold text-slate-400">سيتم حفظ الملاحظة مع الدورة عند الاعتماد فقط</div>
          </div>

          {snapshot.groups.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/40">
              <table className="min-w-[1180px] w-full text-right text-xs">
                <thead className="bg-slate-900/80 text-slate-400"><tr><th className="px-3 py-3">الكود</th><th className="px-3 py-3">الصنف المعتمد</th><th className="px-3 py-3">الكمية</th><th className="px-3 py-3">الطلبات</th><th className="px-3 py-3">العاجل</th><th className="px-3 py-3">عمر النقص</th><th className="px-3 py-3">دورات سابقة</th><th className="px-3 py-3">من آخر إرسال</th><th className="px-3 py-3">الفروع</th><th className="px-3 py-3">الربط</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {snapshot.groups.slice(0, 15).map((group) => {
                    const metric = cycle?.metricsByKey[group.key];
                    return (
                      <tr key={group.key} className={metric?.stale ? 'bg-red-500/[0.035] hover:bg-red-500/[0.06]' : 'hover:bg-violet-500/[0.05]'}>
                        <td className="px-3 py-3 font-mono font-black text-violet-200">{group.productCode || '—'}</td>
                        <td className="px-3 py-3 font-black text-white">{group.canonicalName}{group.requestNames.length > 1 && <div className="mt-1 text-[10px] font-bold text-amber-300">{group.requestNames.length} طرق كتابة مسجلة</div>}</td>
                        <td className="px-3 py-3 num text-lg font-black text-emerald-300">{group.totalQuantity}</td>
                        <td className="px-3 py-3 num font-black text-slate-200">{group.requestCount}</td>
                        <td className="px-3 py-3 num font-black text-red-300">{group.urgentCount || '—'}</td>
                        <td className="px-3 py-3"><span className={`font-black ${(metric?.ageDays || 0) >= 3 ? 'text-red-300' : 'text-slate-300'}`}>{metric?.ageDays ?? '—'} يوم</span></td>
                        <td className="px-3 py-3 num font-black text-slate-200">{metric?.dispatchCount ?? 0}</td>
                        <td className="px-3 py-3"><CycleBadge metric={metric} /></td>
                        <td className="px-3 py-3 text-slate-300">{Object.entries(group.branches).map(([name, qty]) => `${name}: ${qty}`).join(' · ')}</td>
                        <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black ${group.linkQuality === 'unlinked' ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{group.linkQuality === 'unlinked' ? <PackageSearch size={11} /> : <ShieldCheck size={11} />}{group.linkQuality === 'linked_code' ? 'كود مؤكد' : group.linkQuality === 'linked_name' ? 'اسم مؤكد' : 'يحتاج مراجعة'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!!cycle?.dispatches.length && (
            <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/35 p-3">
              <div className="flex items-center gap-2 text-xs font-black text-white"><History size={15} className="text-violet-300" /> آخر دورات الإرسال لنفس نطاق الفرع</div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {cycle.dispatches.slice(0, 5).map((dispatch) => (
                  <div key={dispatch.id} className="rounded-xl border border-slate-800 bg-slate-950/55 p-3">
                    <div className="flex items-center justify-between gap-2"><span className="font-black text-violet-200">#{dispatch.dispatch_no}</span><span className="text-[10px] text-slate-500">{new Date(dispatch.sent_at).toLocaleDateString('ar-EG')}</span></div>
                    <div className="mt-2 text-[11px] font-bold text-slate-300">{dispatch.total_products} صنف · {dispatch.total_quantity} وحدة</div>
                    <div className="mt-1 text-[10px] text-slate-500">{dispatch.total_requests} طلب · {dispatch.urgent_requests} عاجل</div>
                    {dispatch.notes && <div className="mt-2 line-clamp-2 text-[10px] leading-5 text-slate-400">{dispatch.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function CycleBadge({ metric }: { metric?: WarehouseGroupCycleMetric }) {
  if (!metric || metric.state === 'never_sent') return <span className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/15 px-2 py-1 text-[10px] font-black text-cyan-200"><Send size={11} /> جديد</span>;
  if (metric.state === 'new_since_last') return <span className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/15 px-2 py-1 text-[10px] font-black text-cyan-200"><TrendingUp size={11} /> +{metric.newRequestCount} طلب جديد</span>;
  if (metric.state === 'quantity_increased') return <span className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[10px] font-black text-red-200"><TrendingUp size={11} /> الكمية +{metric.quantityDelta}</span>;
  if (metric.state === 'improving') return <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] font-black text-emerald-200"><TrendingDown size={11} /> تحسن {Math.abs(metric.quantityDelta)}</span>;
  return <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black ${metric.stale ? 'bg-red-500/15 text-red-200' : 'bg-amber-500/15 text-amber-200'}`}><AlertTriangle size={11} /> متكرر بدون تغير</span>;
}

function MiniStat({ label, value, warn = false, accent = false, good = false }: { label: string; value: number; warn?: boolean; accent?: boolean; good?: boolean }) {
  const tone = warn ? 'border-amber-400/25 bg-amber-500/[0.08]' : accent ? 'border-cyan-400/25 bg-cyan-500/[0.07]' : good ? 'border-emerald-400/25 bg-emerald-500/[0.07]' : 'border-slate-700 bg-slate-950/45';
  const text = warn ? 'text-amber-200' : accent ? 'text-cyan-200' : good ? 'text-emerald-200' : 'text-white';
  return <div className={`rounded-2xl border p-3 ${tone}`}><div className="text-[10px] font-black text-slate-500">{label}</div><div className={`num mt-1 text-xl font-black ${text}`}>{value.toLocaleString('ar-EG')}</div></div>;
}
