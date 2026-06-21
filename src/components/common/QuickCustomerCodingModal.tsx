import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';

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
      notify('success', existingId ? 'تم تحديث بيانات العميل بنجاح' : 'تم حفظ العميل بنجاح');
      onClose();
    } catch (error) {
      console.error('Failed to save customer:', error);
      notify('error', 'تعذر حفظ بيانات العميل');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-bold text-white">تكويد عميل سريع</h3>
        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="اسم العميل *"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="رقم الهاتف *"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="كود العميل (اختياري)"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="العنوان (اختياري)"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <textarea
          className="mb-3 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="ملاحظات (اختياري)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button className="rounded bg-white/5 px-3 py-1 text-sm text-white" onClick={onClose}>
            إلغاء
          </button>
          <button
            className="rounded bg-teal-500 px-3 py-1 text-sm text-black disabled:opacity-60"
            onClick={() => void submit()}
            disabled={loading}
          >
            {loading ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
