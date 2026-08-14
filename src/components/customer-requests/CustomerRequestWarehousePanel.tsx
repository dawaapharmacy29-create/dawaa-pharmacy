import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, PackageSearch, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  exportWarehouseShortageWorkbook,
  getWarehouseShortageSnapshot,
  type WarehouseShortageSnapshot,
} from '@/lib/api/customerRequestWarehouseExport';

export default function CustomerRequestWarehousePanel({ branch }: { branch: string }) {
  const [snapshot, setSnapshot] = useState<WarehouseShortageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setSnapshot(await getWarehouseShortageSnapshot(branch));
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
      await exportWarehouseShortageWorkbook(current);
      toast.success(`تم تجهيز ملف المخازن: ${current.groups.length} صنف · ${current.totalQuantity} وحدة`);
    } catch (error) {
      toast.error(`تعذر تصدير ملف المخازن: ${(error as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="rounded-3xl border border-violet-400/20 bg-gradient-to-l from-violet-500/[0.08] via-[#102640] to-[#0a1a2d] p-4 shadow-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><FileSpreadsheet size={19} className="text-violet-300" /> ملف دوري للمخازن — الأصناف التي لم يتم توفيرها</div>
          <p className="mt-1 text-xs leading-6 text-slate-400">يجمع نفس الصنف مرة واحدة بالكود المعتمد، ويجمع الكميات من كل الطلبات والفروع بدون إرسال بيانات العميل الشخصية للمخزن.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 text-xs">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث التجميع
          </button>
          <button type="button" onClick={() => void exportFile()} disabled={loading || exporting || !snapshot?.groups.length} className="btn-primary flex items-center gap-2 text-xs">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} تصدير Excel للمخازن
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex h-28 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/40"><Loader2 className="animate-spin text-violet-300" /></div>
      ) : snapshot ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <MiniStat label="أصناف مطلوبة" value={snapshot.groups.length} />
            <MiniStat label="إجمالي الكميات" value={snapshot.totalQuantity} />
            <MiniStat label="طلبات غير مكتملة" value={snapshot.totalRequests} />
            <MiniStat label="طلبات عاجلة" value={snapshot.urgentRequests} />
            <MiniStat label="أصناف تحتاج ربط" value={snapshot.unlinkedGroups} warn={snapshot.unlinkedGroups > 0} />
          </div>

          {snapshot.groups.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/40">
              <table className="min-w-[900px] w-full text-right text-xs">
                <thead className="bg-slate-900/80 text-slate-400"><tr><th className="px-3 py-3">الكود</th><th className="px-3 py-3">الصنف المعتمد</th><th className="px-3 py-3">الكمية</th><th className="px-3 py-3">الطلبات</th><th className="px-3 py-3">العاجل</th><th className="px-3 py-3">الفروع</th><th className="px-3 py-3">الربط</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {snapshot.groups.slice(0, 10).map((group) => (
                    <tr key={group.key} className="hover:bg-violet-500/[0.05]">
                      <td className="px-3 py-3 font-mono font-black text-violet-200">{group.productCode || '—'}</td>
                      <td className="px-3 py-3 font-black text-white">{group.canonicalName}{group.requestNames.length > 1 && <div className="mt-1 text-[10px] font-bold text-amber-300">{group.requestNames.length} طرق كتابة مسجلة</div>}</td>
                      <td className="px-3 py-3 num text-lg font-black text-emerald-300">{group.totalQuantity}</td>
                      <td className="px-3 py-3 num font-black text-slate-200">{group.requestCount}</td>
                      <td className="px-3 py-3 num font-black text-red-300">{group.urgentCount || '—'}</td>
                      <td className="px-3 py-3 text-slate-300">{Object.entries(group.branches).map(([name, qty]) => `${name}: ${qty}`).join(' · ')}</td>
                      <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black ${group.linkQuality === 'unlinked' ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{group.linkQuality === 'unlinked' ? <PackageSearch size={11} /> : <ShieldCheck size={11} />}{group.linkQuality === 'linked_code' ? 'كود مؤكد' : group.linkQuality === 'linked_name' ? 'اسم مؤكد' : 'يحتاج مراجعة'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function MiniStat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return <div className={`rounded-2xl border p-3 ${warn ? 'border-amber-400/25 bg-amber-500/[0.08]' : 'border-slate-700 bg-slate-950/45'}`}><div className="text-[10px] font-black text-slate-500">{label}</div><div className={`num mt-1 text-xl font-black ${warn ? 'text-amber-200' : 'text-white'}`}>{value.toLocaleString('ar-EG')}</div></div>;
}
