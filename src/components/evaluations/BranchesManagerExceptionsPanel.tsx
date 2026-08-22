import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { fetchBranchesManagerExceptions, type ManagerException } from '@/lib/evaluations/branchesManagerExceptions';

const SEVERITY_BADGES: Record<string, string> = {
  حرجة: 'dawaa-badge--danger',
  مهمة: 'dawaa-badge--warning',
  عادية: 'dawaa-badge--info',
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
    <div className="dawaa-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="dawaa-icon-tile h-9 w-9"><ShieldAlert size={18} /></div>
          <div>
            <h2 className="dawaa-title text-lg">يحتاج تدخلك الآن</h2>
            <p className="dawaa-caption mt-1 text-xs">
              استثناءات فقط — مش تقرير شامل. لو الصفحة فاضية يبقى مفيش حاجة عاجلة النهاردة.
            </p>
          </div>
        </div>
        {!loading ? (
          <span className={`dawaa-badge ${critical.length ? 'dawaa-badge--danger' : sorted.length ? 'dawaa-badge--warning' : 'dawaa-badge--success'}`}>
            {sorted.length} استثناء
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="dawaa-caption mt-3 flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> جارٍ الفحص...
        </div>
      ) : error ? (
        <div className="dawaa-alert dawaa-alert--danger mt-3 text-sm">{error}</div>
      ) : !sorted.length ? (
        <div className="dawaa-alert dawaa-alert--success mt-3 text-sm">مفيش استثناءات مفتوحة دلوقتي 🎉</div>
      ) : (
        <div className="mt-3 space-y-2">
          {sorted.map((item) => (
            <div key={item.id} className="dawaa-card dawaa-card--soft flex items-start gap-3 p-3 text-sm">
              <AlertTriangle size={16} className="dawaa-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="dawaa-title text-sm">{item.title} — {item.branch}</span>
                  <span className={`dawaa-badge ${SEVERITY_BADGES[item.severity] || 'dawaa-badge--info'}`}>
                    {item.severity}
                  </span>
                </div>
                <div className="dawaa-caption mt-1 text-xs leading-5">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
