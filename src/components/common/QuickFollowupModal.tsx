import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { createExceptionalFollowup } from '@/lib/api/customerServiceCommandCenter';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';

type CustomerSearchResult = {
  id: string;
  name: string | null;
  phone: string | null;
  customer_code: string | null;
};

function notify(type: 'success' | 'error', message: string) {
  window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
}

function normalizePhoneInput(value: string) {
  return value.replace(/[^\d+]/g, '').trim();
}

export default function QuickFollowupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const term = search.trim().replace(/[,%_()]/g, ' ');
      const { data, error } = await supabase
        .from('customers')
        .select('id,name,phone,customer_code')
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`)
        .limit(8);

      if (cancelled) return;
      setSearching(false);
      if (error) {
        console.error('Failed to search customers:', error);
        setResults([]);
        return;
      }
      setResults((data || []) as CustomerSearchResult[]);
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  if (!open) return null;

  const selectCustomer = (customer: CustomerSearchResult) => {
    setName(customer.name || '');
    setPhone(customer.phone || '');
    setCode(customer.customer_code || '');
    setSearch('');
    setResults([]);
  };

  const reset = () => {
    setSearch('');
    setResults([]);
    setName('');
    setPhone('');
    setCode('');
    setNote('');
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPhone = normalizePhoneInput(phone);
    const cleanNote = note.trim();
    if ((!cleanName && !cleanPhone) || !cleanNote) {
      notify('error', 'أدخل اسم العميل أو رقم الهاتف، وملاحظة المتابعة');
      return;
    }

    const validPhone = cleanPhone && isValidEgyptPhone(cleanPhone, code || undefined);
    const phoneStatusNote = validPhone ? '' : '\n[بدون رقم صحيح]';

    setLoading(true);
    try {
      await createExceptionalFollowup({
        customerName: cleanName || 'عميل بدون اسم',
        customerPhone: cleanPhone || null,
        branch: user?.branch || null,
        priority: 'مهم',
        requestType: 'طلب متابعة',
        followupReason: cleanNote,
        requestDetails: `${cleanNote}${phoneStatusNote}`,
        notes: `${cleanNote}${phoneStatusNote}\nالمصدر: sidebar_quick_followup`,
        createdBy: user?.id || null,
        createdByName: user?.name?.trim() || 'مستخدم النظام',
        source: 'sidebar_quick_followup',
        customerCode: code.trim() || null,
        contactStatus: validPhone ? undefined : 'بدون رقم صحيح',
      });

      reset();
      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
      notify('success', 'تم إنشاء طلب المتابعة بنجاح');
      onCreated?.();
      onClose();
    } catch (error) {
      console.error('Failed to create followup:', error);
      notify('error', 'تعذر إنشاء المتابعة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-bold text-white">إنشاء متابعة سريعة</h3>

        <div className="relative mb-3">
          <input
            className="w-full rounded bg-slate-800 p-2 text-sm text-white"
            placeholder="ابحث بالاسم أو الهاتف أو كود العميل"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {searching && <div className="mt-1 text-xs text-slate-400">جارٍ البحث...</div>}
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded border border-slate-700 bg-slate-800 shadow-xl">
              {results.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="block w-full border-b border-slate-700 px-3 py-2 text-right text-sm text-white last:border-0 hover:bg-slate-700"
                  onClick={() => selectCustomer(customer)}
                >
                  <span className="block font-semibold">{customer.name || 'بدون اسم'}</span>
                  <span className="text-xs text-slate-400">
                    {[customer.phone, customer.customer_code].filter(Boolean).join(' — ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="اسم العميل"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="رقم الهاتف"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <input
          className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="كود العميل (اختياري)"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <textarea
          className="mb-3 w-full rounded bg-slate-800 p-2 text-sm text-white"
          placeholder="ملاحظة المتابعة *"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          required
        />
        <p className="mb-3 text-xs text-slate-400">يجب إدخال اسم العميل أو رقم الهاتف على الأقل، وملاحظة المتابعة مطلوبة.</p>
        <div className="flex justify-end gap-2">
          <button className="rounded bg-white/5 px-3 py-1 text-sm text-white" onClick={onClose}>
            إلغاء
          </button>
          <button
            className="rounded bg-teal-500 px-3 py-1 text-sm text-black disabled:opacity-60"
            onClick={() => void submit()}
            disabled={loading}
          >
            {loading ? 'جارٍ الإنشاء...' : 'إنشاء'}
          </button>
        </div>
      </div>
    </div>
  );
}
