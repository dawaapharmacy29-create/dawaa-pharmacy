import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

function normalizePhone(value: string) {
  return value.replace(/\D/g, '').replace(/^20/, '0');
}

function isEgyptianMobile(value: string) {
  return /^01[0125]\d{8}$/.test(value);
}

export default function CustomerCodingRequestModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const fixedBranch = useMemo(() => normalizeBranchName(user?.branch || '') || user?.branch || '', [user?.branch]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [source, setSource] = useState('داخل الفرع');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, saving]);

  if (!open) return null;

  const reset = () => {
    setName('');
    setPhone('');
    setAddress('');
    setSource('داخل الفرع');
    setNotes('');
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPhone = normalizePhone(phone);
    if (!cleanName || !cleanPhone) {
      toast.error('اكتب اسم العميل ورقم الموبايل');
      return;
    }
    if (!isEgyptianMobile(cleanPhone)) {
      toast.error('رقم الموبايل غير صحيح');
      return;
    }

    setSaving(true);
    try {
      const [customerCheck, requestCheck] = await Promise.all([
        supabase.from('customers').select('id,name,customer_code,phone').eq('phone', cleanPhone).limit(1),
        supabase
          .from('customer_coding_requests')
          .select('id,status,created_by_name,created_at')
          .eq('phone', cleanPhone)
          .in('status', ['open', 'in_progress', 'blocked'])
          .limit(1),
      ]);

      if (customerCheck.error) throw customerCheck.error;
      if (requestCheck.error) throw requestCheck.error;

      const existingCustomer = customerCheck.data?.[0];
      if (existingCustomer) {
        toast.error(`العميل مسجل بالفعل${existingCustomer.customer_code ? ` — الكود ${existingCustomer.customer_code}` : ''}`);
        return;
      }

      const existingRequest = requestCheck.data?.[0];
      if (existingRequest) {
        toast.error(`يوجد طلب تكويد مفتوح بالفعل${existingRequest.created_by_name ? ` باسم ${existingRequest.created_by_name}` : ''}`);
        return;
      }

      const { error } = await supabase.from('customer_coding_requests').insert({
        customer_name: cleanName,
        phone: cleanPhone,
        address: address.trim() || null,
        branch: fixedBranch || null,
        source: source || 'داخل الفرع',
        notes: `${notes.trim()}${notes.trim() ? '\n' : ''}المصدر: doctor_quick_action`,
        status: 'open',
        created_by: user?.id || null,
        created_by_name: user?.name || user?.email || 'مستخدم النظام',
      });
      if (error) throw error;

      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'customer_coding_requests' } }));
      toast.success(`تم تسجيل طلب التكويد باسم ${user?.name || 'الدكتور'}`);
      reset();
      onCreated?.();
      onClose();
    } catch (error) {
      console.error('Failed to create customer coding request:', error);
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل طلب التكويد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" dir="rtl">
      <button type="button" aria-label="إغلاق" className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-sky-400/25 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">طلب تكويد عميل</h2>
            <p className="mt-1 text-sm text-slate-400">سيظهر الطلب مباشرة في سجل صفحة تكويد العملاء.</p>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="rounded-xl border border-slate-700 p-2 text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            <X size={17} />
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-sm font-bold text-teal-100">
          سيتم التسجيل باسم <span className="font-black">{user?.name || 'المستخدم الحالي'}</span> — {fixedBranch || 'الفرع المسجل بالحساب'}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input-dark" value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم العميل *" autoFocus />
          <input className="input-dark" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="رقم الموبايل *" />
          <input className="input-dark sm:col-span-2" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="العنوان أو المنطقة" />
          <select className="input-dark" value={source} onChange={(event) => setSource(event.target.value)}>
            <option>داخل الفرع</option>
            <option>واتساب</option>
            <option>دليفري</option>
            <option>روشتة</option>
            <option>عميل دائم غير مسجل</option>
            <option>أخرى</option>
          </select>
          <input className="input-dark" value={fixedBranch} readOnly aria-label="الفرع" />
          <textarea className="input-dark sm:col-span-2" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات إضافية" />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>إلغاء</button>
          <button type="button" className="btn-primary disabled:opacity-60" disabled={saving} onClick={() => void submit()}>
            {saving ? 'جارٍ التسجيل…' : 'تسجيل طلب التكويد'}
          </button>
        </div>
      </div>
    </div>
  );
}
