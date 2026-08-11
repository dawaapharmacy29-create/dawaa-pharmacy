import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, MessageCircle, RefreshCw, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { requestStatusLabel, updateCustomerRequestStatus, type CustomerRequest } from '@/lib/api/customerRequests';
import {
  getCustomerRequestActionQueue,
  type CustomerRequestActionQueueItem,
} from '@/lib/api/customerRequestActionQueue';

const WORKFLOW = [
  { key: 'registered', label: 'تسجيل' },
  { key: 'search', label: 'بحث' },
  { key: 'available', label: 'توفير' },
  { key: 'contact', label: 'تواصل' },
  { key: 'delivered', label: 'تسليم' },
] as const;

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

function stageIndex(status?: string | null) {
  const value = String(status || 'new');
  if (['new', 'purchasing_review'].includes(value)) return 0;
  if (['searching_suppliers', 'needs_customer_confirmation', 'customer_confirmed', 'sourcing'].includes(value)) return 1;
  if (['available', 'arrived'].includes(value)) return 2;
  if (value === 'customer_contacted') return 3;
  if (['delivered', 'closed'].includes(value)) return 4;
  return 0;
}

function nextStatus(request: CustomerRequestActionQueueItem) {
  const status = String(request.status || 'new');
  if (['new', 'purchasing_review'].includes(status)) return { status: 'searching_suppliers', label: 'بدء البحث', icon: Search };
  if (['available', 'arrived'].includes(status)) return { status: 'customer_contacted', label: 'تم التواصل', icon: MessageCircle };
  if (status === 'customer_contacted') return { status: 'delivered', label: 'تم التسليم', icon: CheckCircle2 };
  return null;
}

export default function CustomerRequestActionQueue({
  branch,
  onSelect,
  refreshKey = 0,
}: {
  branch: string;
  onSelect?: (request: CustomerRequest) => void;
  refreshKey?: number;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<CustomerRequestActionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
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

  const advance = async (item: CustomerRequestActionQueueItem) => {
    const action = nextStatus(item);
    if (!action) return;
    setSavingId(item.id);
    try {
      await updateCustomerRequestStatus(item, {
        status: action.status,
        user_id: user?.id,
        user_name: user?.name,
      });
      toast.success(`تم: ${action.label}`);
      await load();
    } catch (err) {
      toast.error(`تعذر تحديث الطلب: ${(err as Error).message}`);
    } finally {
      setSavingId('');
    }
  };

  const whatsapp = (item: CustomerRequestActionQueueItem) => {
    if (!item.customer_phone) return toast.error('لا يوجد رقم هاتف صالح للعميل');
    const message = `أهلاً ${item.customer_name || 'حضرتك'}، مع حضرتك صيدليات دواء بخصوص طلب صنف ${item.medicine_name}.`;
    window.open(generateWhatsAppLink(item.customer_phone, message), '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="rounded-3xl border border-fuchsia-400/20 bg-gradient-to-l from-[#102640] via-[#102239] to-[#12152b] p-4 shadow-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><Sparkles size={18} className="text-fuchsia-300" /> قائمة التدخل الذكية</div>
          <p className="mt-1 text-xs font-semibold text-slate-400">الأعلى أولوية حسب الأهمية، تجاوز وقت المتابعة، المرحلة ومدة الانتظار.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 px-3 py-2 text-xs">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} تحديث الأولويات
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs font-bold text-red-200">تعذر تحميل قائمة التدخل: {error}</div>
      ) : loading && items.length === 0 ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl bg-slate-800/70" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-200">لا توجد طلبات حرجة حاليًا.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => {
            const action = nextStatus(item);
            const currentStage = stageIndex(item.status);
            const ActionIcon = action?.icon;
            return (
              <div key={item.id} className={`rounded-2xl border p-3 text-right ${item.is_overdue ? 'border-amber-400/30 bg-amber-500/[0.07]' : 'border-slate-700 bg-slate-950/45'}`}>
                <button type="button" onClick={() => onSelect?.(item)} className="w-full text-right">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-fuchsia-500/15 px-1.5 text-[11px] font-black text-fuchsia-200">{index + 1}</span><div className="truncate text-sm font-black text-white">{item.medicine_name}</div></div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400"><span><Clock3 size={10} className="inline ms-1" />{exactTime(item)}</span><span>{importance(item)}</span><span>سجله: {registrarName(item)}</span></div>
                    </div>
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-black text-slate-200">{requestStatusLabel(item.status)}</span>
                  </div>
                </button>

                <div className="mt-3 grid grid-cols-5 gap-1">
                  {WORKFLOW.map((step, stepIndex) => <div key={step.key} className="text-center"><div className={`mx-auto h-1.5 rounded-full ${stepIndex <= currentStage ? 'bg-cyan-400' : 'bg-slate-700'}`} /><div className={`mt-1 text-[9px] font-bold ${stepIndex === currentStage ? 'text-cyan-200' : 'text-slate-500'}`}>{step.label}</div></div>)}
                </div>

                <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.07] px-3 py-2 text-[11px] font-black text-cyan-100">{item.reason}</div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-slate-400"><span>{item.customer_name || 'عميل غير محدد'} · {item.branch || 'بدون فرع'}</span><span className={item.is_overdue ? 'text-amber-300' : 'text-slate-300'}>{item.is_overdue && <AlertTriangle size={10} className="inline ms-1" />}{item.stage_age_hours}س / SLA {item.sla_hours}س</span></div>

                <div className="mt-3 flex gap-2">
                  {action && ActionIcon && <button type="button" disabled={savingId === item.id} onClick={() => void advance(item)} className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[11px]">{savingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <ActionIcon size={13} />}{action.label}</button>}
                  <button type="button" onClick={() => whatsapp(item)} className="btn-secondary flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[11px]"><MessageCircle size={13} /> واتساب</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
