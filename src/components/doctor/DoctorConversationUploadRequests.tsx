import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { listMyUploadRequests, type UploadRequest } from '@/lib/evaluationLab/reviewSamples';

// v7.1: the conversations drawn for this doctor's weekly review. A chat not uploaded by its deadline counts as 0
// in the conversation part of the evaluation. Shows nothing when nothing is due.
export default function DoctorConversationUploadRequests() {
  const { checkPermission } = useAuth();
  const canUpload = checkPermission('manage_whatsapp_capture');
  const [rows, setRows] = useState<UploadRequest[]>([]);
  useEffect(() => { void listMyUploadRequests().then(setRows); }, []);
  const due = rows.filter((r) => !r.uploaded);
  if (!rows.length) return null;

  return <section className="rounded-3xl border p-4" style={{ background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' }}>
    <div className="flex items-center gap-2 text-sm font-black"><MessageCircle className="h-4 w-4 text-teal-700" /> محادثات مطلوب ترفعها للمراجعة</div>
    <p className="mt-1 text-xs font-bold text-slate-600">اتختارت عشوائي من أوردرات التوصيل بتاعتك. ارفع المحادثة كاملة على العقل المدبر (أو ابعتها للإدارة ترفعها) قبل آخر يوم، واللي مايترفعش بيتحسب صفر في تقييم المحادثات.</p>
    <div className="mt-2 space-y-1">
      {rows.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold" style={{ background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' }}>
        <span>{r.customerName || 'عميل'} · {r.customerPhone || '—'} · {new Date(r.invoiceAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'numeric' })}</span>
        {r.uploaded ? <span className="dawaa-status-success-text">اترفعت ✓</span>
          : <span className="dawaa-status-danger-text">آخر يوم {new Date(`${r.deadline}T12:00:00Z`).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'numeric' })}</span>}
      </div>)}
    </div>
    {due.length && canUpload ? <Link to="/whatsapp-smart-folder-watcher" className="btn-primary mt-3 inline-block text-xs">ارفع على العقل المدبر</Link> : null}
  </section>;
}
