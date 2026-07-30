import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Row = Record<string, any>;

export default function ContinueFollowupModal({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: (updated: Row) => void }) {
  const { user } = useAuth();
  const [contactMethod, setContactMethod] = useState('واتساب');
  const [result, setResult] = useState('تم الرد والعميل راضي');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [purchase, setPurchase] = useState(false);
  const [amount, setAmount] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setContactMethod(String(row.contact_method || 'واتساب'));
    setResult('تم الرد والعميل راضي');
    setSummary('');
    setNotes('');
    setPurchase(false);
    setAmount('');
    setNextDate('');
  }, [row]);

  if (!row) return null;

  const save = async () => {
    if (!summary.trim()) {
      toast.error('اكتب ما تم مع العميل');
      return;
    }
    const now = new Date().toISOString();
    const isPending = result === 'لم يرد' || result === 'طلب التواصل لاحقًا';
    const status = result === 'لم يرد' ? 'لم يرد' : result === 'طلب التواصل لاحقًا' ? 'مؤجل' : result === 'يحتاج متابعة مدير' ? 'يحتاج مدير' : 'تم';
    const payload: Row = {
      contact_method: contactMethod,
      contact_result: result,
      followup_result: result,
      followup_summary: summary.trim(),
      followup_notes: notes.trim() || null,
      followup_status: status,
      status,
      purchase_after_followup: purchase,
      purchase_amount: purchase ? Number(amount || 0) || null : null,
      next_followup_date: nextDate || null,
      contacted_at: now,
      completed_at: isPending ? null : now,
      updated_at: now,
      updated_by: user?.id || null,
      updated_by_name: user?.name || null,
      contact_attempts: Number(row.contact_attempts || row.attempts_count || 0) + 1,
    };
    setSaving(true);
    try {
      const { data, error } = await supabase.from('daily_followups').update(payload).eq('id', row.id).select('*').single();
      if (error) throw error;
      toast.success('تم استكمال المتابعة وتحديث نفس سجل العميل');
      onSaved(data || { ...row, ...payload });
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(`تعذر حفظ استكمال المتابعة: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/80 p-3" dir="rtl">
    <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-emerald-300/25 bg-[#071827] p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-white">استكمال متابعة {row.customer_name || row.name || 'العميل'}</h2><p className="mt-1 text-xs font-bold text-slate-400">يتم تحديث نفس المتابعة الحالية بدون إنشاء سجل مكرر.</p></div><button className="btn-secondary" onClick={onClose}><X size={18}/></button></div>
      <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-bold text-slate-200 md:grid-cols-2"><div>الكود: {row.customer_code || 'غير مسجل'}</div><div>الهاتف: {row.customer_phone || row.phone || 'غير مسجل'}</div><div>الفرع: {row.branch || 'غير محدد'}</div><div>الحالة السابقة: {row.followup_status || row.status || 'غير محددة'}</div></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <select className="input-dark" value={contactMethod} onChange={(e)=>setContactMethod(e.target.value)}><option>واتساب</option><option>اتصال</option><option>رسالة</option><option>زيارة</option></select>
        <select className="input-dark" value={result} onChange={(e)=>setResult(e.target.value)}><option>تم الرد والعميل راضي</option><option>تم الرد ولا يحتاج الآن</option><option>تم الشراء بعد المتابعة</option><option>تم تنفيذ الطلب والتأكد من العميل</option><option>تم حل الشكوى</option><option>لم يرد</option><option>طلب التواصل لاحقًا</option><option>يحتاج متابعة مدير</option></select>
        <textarea className="input-dark md:col-span-2" rows={4} placeholder="ما تم مع العميل *" value={summary} onChange={(e)=>setSummary(e.target.value)} />
        <textarea className="input-dark md:col-span-2" rows={3} placeholder="ملاحظات إضافية" value={notes} onChange={(e)=>setNotes(e.target.value)} />
        <label className="flex items-center gap-2 rounded-xl border border-white/10 p-3 text-sm font-bold text-white"><input type="checkbox" checked={purchase} onChange={(e)=>setPurchase(e.target.checked)} /> تمت عملية شراء</label>
        <input className="input-dark" type="number" min="0" placeholder="قيمة عملية الشراء" disabled={!purchase} value={amount} onChange={(e)=>setAmount(e.target.value)} />
        <label className="text-xs font-bold text-slate-400">موعد المتابعة القادمة<input className="input-dark mt-1 w-full" type="datetime-local" value={nextDate} onChange={(e)=>setNextDate(e.target.value)} /></label>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={saving} onClick={()=>void save()}>{saving ? 'جارٍ الحفظ...' : 'حفظ واستكمال المتابعة'}</button></div>
    </section>
  </div>;
}
