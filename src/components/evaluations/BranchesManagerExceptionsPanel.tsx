import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { fetchBranchesManagerExceptions, type ManagerException } from '@/lib/evaluations/branchesManagerExceptions';

const SEVERITY_STYLES: Record<string, string> = {
  حرجة: 'border-red-500/40 bg-red-500/10 text-red-200',
  مهمة: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  عادية: 'border-slate-500/40 bg-slate-500/10 text-slate-200',
};

export function BranchesManagerExceptionsPanel({ branchScope }: { branchScope: string | null }) {
  const [items, setItems] = useState<ManagerException>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBranchesManagerExceptions(branchScope)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'تعذّر تحميل الاستثناءات');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchScope]);

  const critical = items.filter((i) => i.severity === 'حرجة');
  const important = items.filter((i) => i.severity !== 'حرجة');
  const sorted = [...critical, ...important];

  return (
    <div className="rounded-2xl border border-red-500/25 bg-gradient-to-br from-red-950/30 to-slate-900/40 p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert size={18} className="text-red-300" />
        <h2 className="text-lg font-black text-white">يحتاج تدخلك الآن</h2>
        {!loading && <span className="text-xs text-slate-400">({sorted.length})</span>}
      </div>
      <p className="mt-1 text-xs text-slate-400">استثناءات فقط — مش تقرير شامل. لو الصفحة فاضية يبقى مفيش حاجة عاجلة النهاردة.</p>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> جارٍ الفحص...
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red-400">{error}</p>
      ) : !sorted.length ? (
        <p className="mt-3 text-sm text-emerald-300">مفيش استثناءات مفتوحة دلوقتي 🎉</p>
      ) : (
        <div className="mt-3 space-y-2">
          {sorted.map((item) => (
            <div key={item.id} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${SEVERITY_STYLES[item.severity]}`}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-black">
                  {item.title} — {item.branch}
                </div>
                <div className="mt-0.5 text-xs opacity-90">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
