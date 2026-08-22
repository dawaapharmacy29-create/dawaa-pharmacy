import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { notifyCustomerServiceResponsible } from '@/lib/notificationService';

type CustomerPayload = {
  name: string;
  phone: string;
  customer_code?: string;
  address?: string;
  notes?: string;
};

function notify(type: 'success' | 'error', message: string) {
  window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
}

function isMissingOptionalColumn(
  error: { code?: string; message?: string } | null,
  column: 'address' | 'notes'
) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === 'PGRST204' ||
    (message.includes(column) && (message.includes('column') || message.includes('schema cache')))
  );
}

export default function QuickCustomerCodingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const reset = () => {
    setName('');
    setPhone('');
    setCode('');
    setAddress('');
    setNotes('');
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName || !cleanPhone) {
      notify('error', 'اسم العميل ورقم الهاتف مطلوبان');
      return;
    }

    setLoading(true);
    try {
      const { data: existingRows, error: lookupError } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', cleanPhone)
        .limit(1);
      if (lookupError) throw lookupError;

      const existingId = existingRows?.[0]?.id;
      const basePayload: CustomerPayload = { name: cleanName, phone: cleanPhone };
      if (code.trim()) basePayload.customer_code = code.trim();

      let customerId = existingId;
      if (existingId) {
        const { error } = await supabase.from('customers').update(basePayload).eq('id', existingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('customers')
          .insert([basePayload])
          .select('id')
          .single();
        if (error) throw error;
        customerId = data?.id;
      }

      const optionalValues: Array<['address' | 'notes', string]> = [
        ['address', address.trim()],
        ['notes', notes.trim()],
      ];
      for (const [column, value] of optionalValues) {
        if (!customerId || !value) continue;
        const { error } = await supabase
          .from('customers')
          .update({ [column]: value })
          .eq('id', customerId);
        if (error && !isMissingOptionalColumn(error, column)) throw error;
      }

      reset();
      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'customers' } }));
      void notifyCustomerServiceResponsible({
        title: 'طلب تكويد عميل',
        message: `تم تسجيل ${cleanName} ويحتاج مراجعة/ترحيب من خدمة العملاء.`,
        type: 'customer_alert',
        priority: 'normal',
        target_type: 'customer',
        target_id: customerId ? String(customerId) : cleanPhone,
        target_route: `/customer-coding?phone=${encodeURIComponent(cleanPhone)}`,
        metadata: { customer_name: cleanName, customer_phone: cleanPhone },
      });
      notify('success', existingId ? 'تم تحديث بيانات العميل بنجاح' : 'تم حفظ العميل بنجاح');
      onClose();
      navigate(`/customer-coding?phone=${encodeURIComponent(cleanPhone)}`);
    } catch (error) {
      console.error('Failed to save customer:', error);
      notify('error', 'تعذر حفظ بيانات العميل');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop items-center" dir="rtl" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal-panel max-w-md p-5">
        <h3 className="dawaa-title mb-1 text-lg">تكويد عميل سريع</h3>
        <p className="dawaa-caption mb-4 text-xs font-bold">أدخل البيانات الأساسية، ويمكن استكمال باقي بيانات العميل لاحقًا.</p>
        <div className="space-y-2.5">
          <input className="dawaa-input text-sm" placeholder="اسم العميل *" value={name} onChange={(event) => setName(event.target.value)} required />
          <input className="dawaa-input text-sm" placeholder="رقم الهاتف *" value={phone} onChange={(event) => setPhone(event.target.value)} required />
          <input className="dawaa-input text-sm" placeholder="كود العميل (اختياري)" value={code} onChange={(event) => setCode(event.target.value)} />
          <input className="dawaa-input text-sm" placeholder="العنوان (اختياري)" value={address} onChange={(event) => setAddress(event.target.value)} />
          <textarea className="dawaa-textarea min-h-24 text-sm" placeholder="ملاحظات (اختياري)" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="dawaa-button dawaa-button--secondary" onClick={onClose}>إلغاء</button>
          <button className="dawaa-button dawaa-button--primary disabled:opacity-60" onClick={() => void submit()} disabled={loading}>
            {loading ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
