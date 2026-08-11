import { useEffect, useState } from 'react';
import { AlertTriangle, Clock3, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { requestStatusLabel, type CustomerRequest } from '@/lib/api/customerRequests';
import {
  getCustomerRequestActionQueue,
  type CustomerRequestActionQueueItem,
} from '@/lib/api/customerRequestActionQueue';

function registrarName(request: CustomerRequestActionQueueItem) {
  return request.doctor_name?.trim()
    || request.created_by_name?.trim()
    || request.source_assigned_employee?.trim()
    || 'غير محدد';
}

function exactTime(request: CustomerRequestActionQueueItem) {
  const raw = request.requested_at || request.created_at;
  if (!raw) return 'وقت غير محدد';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'وقت غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function importance(request: CustomerRequestActionQueueItem) {
  const value = String(request.urgency || request.priority || '').toLowerCase();
  if (request.is_urgent || value === 'urgent' || value === 'عاجل') return 'عاجل';
  if (value === 'high' || value === 'مهم') return 'مهم';
  return 'عادي';
}

export default function CustomerRequestActionQueue({
  branch,
  onSelect,
  refreshKey = 0,
}: {
  branch: string;
  onSelect: (request: CustomerRequest) => void;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<CustomerRequestActionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await getCustomerRequestActionQueue(branch, 12));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [branch, refreshKey]);

  return (
    <section className="rounded-3xl border border-fuchsia-400/20 bg-gradient-to-l from-[#102640] via-[#102239] to-[#12152b] p-4 shadow-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-white">
            <Sparkles size={18} className="text-fuchsia-300" /> قائمة التدخل الذكية
          </div>
          <p className="mt-1 text-xs font-semibold text-slate-400">الأعلى أولوية حسب الأهمية، تجاوز وقت المتابعة، المرحلة ومدة الانتظار.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 px-3 py-2 text-xs">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} تحديث الأولويات
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs font-bold text-red-200">تعذر تحميل قائمة التدخل: {error}</div>
      ) : loading && items.length === 0 ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-800/70" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-200">لا توجد طلبات حرجة حاليًا.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={`rounded-2xl border p-3 text-right transition hover:-translate-y-0.5 hover:border-cyan-300 ${item.is_overdue ? 'border-amber-400/30 bg-amber-500/[0.07]' : 'border-slate-700 bg-slate-950/45'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-fuchsia-500/15 px-1.5 text-[11px] font-black text-fuchsia-200">{index + 1}</span>
                    <div className="truncate text-sm font-black text-white">{item.medicine_name}</div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400">
                    <span><Clock3 size={10} className="inline ms-1" />{exactTime(item)}</span>
                    <span>{importance(item)}</span>
                    <span>سجله: {registrarName(item)}</span>
                  </div>
                </div>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-black text-slate-200">{requestStatusLabel(item.status)}</span>
              </div>

              <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.07] px-3 py-2 text-[11px] font-black text-cyan-100">
                {item.reason}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-slate-400">
                <span>{item.customer_name || 'عميل غير محدد'} · {item.branch || 'بدون فرع'}</span>
                <span className={item.is_overdue ? 'text-amber-300' : 'text-slate-300'}>
                  {item.is_overdue && <AlertTriangle size={10} className="inline ms-1" />}
                  {item.stage_age_hours}س / SLA {item.sla_hours}س
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
