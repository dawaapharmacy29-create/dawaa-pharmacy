import { useCallback, useEffect, useState } from 'react';
import { Gift, Loader2, RefreshCw, Ticket, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import CustomerSmartSearch, { type CustomerSearchResult } from '@/components/CustomerSmartSearch';

type VoucherRow = {
  id: string;
  tier_value: number;
  status: 'available' | 'used';
  customer_name: string | null;
  customer_code: string | null;
  used_at: string | null;
};

function currentMonthCycle() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function DoctorVouchers() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeemFor, setRedeemFor] = useState<VoucherRow | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('doctor_voucher_allocations')
      .select('id,tier_value,status,customer_name,customer_code,used_at')
      .eq('doctor_id', staffId)
      .eq('month_cycle', currentMonthCycle())
      .order('tier_value', { ascending: true });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setVouchers((data || []) as VoucherRow[]);
    setLoading(false);
  }, [staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openRedeem = (voucher: VoucherRow) => {
    setRedeemFor(voucher);
    setSelectedCustomer(null);
    setInvoiceNumber('');
  };

  const confirmRedeem = async () => {
    if (!redeemFor || !selectedCustomer) {
      toast.error('اختار العميل الأول');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('redeem_doctor_voucher', {
      p_voucher_id: redeemFor.id,
      p_customer_id: selectedCustomer.id || '',
      p_customer_code: selectedCustomer.code || '',
      p_customer_name: selectedCustomer.name || '',
      p_invoice_number: invoiceNumber || null,
      p_used_by: staffId || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.success) {
      toast.error(row?.message || 'تعذر صرف الفاوتشر');
      return;
    }
    toast.success('تم صرف الفاوتشر بنجاح');
    setRedeemFor(null);
    void load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/50 p-8 text-slate-400">
        <Loader2 className="animate-spin" size={18} /> جارٍ تحميل الفاوتشرات...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gift className="text-amber-300" size={20} />
          <h2 className="text-lg font-black text-white">فاوتشراتي هذا الشهر</h2>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white">
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="text-xs text-slate-400">
        3 فاوتشرات شهريًا (100 / 150 / 200 ج) تقدر تديها لأي عميل تشوف إنه يستاهل تشجيع — بشرط العميل ميكونش أخد فاوتشر تاني الشهر ده من أي دكتور.
      </p>

      {!vouchers.length ? (
        <p className="rounded-2xl border border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
          لسه مفيش فاوتشرات مُجهّزة الشهر ده — كلم المدير لو الفاوتشرات مش ظاهرة.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {vouchers.map((voucher) => (
            <div
              key={voucher.id}
              className={`rounded-2xl border p-4 ${
                voucher.status === 'used'
                  ? 'border-slate-700 bg-slate-900/40 opacity-70'
                  : 'border-amber-400/30 bg-amber-500/5'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-lg font-black text-amber-200">
                  <Ticket size={18} /> {voucher.tier_value.toLocaleString('ar-EG')} ج
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${voucher.status === 'used' ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500/15 text-emerald-300'}`}>
                  {voucher.status === 'used' ? 'مُستخدم' : 'متاح'}
                </span>
              </div>
              {voucher.status === 'used' ? (
                <div className="mt-3 text-xs text-slate-400">
                  <p>اتدّى لـ: {voucher.customer_name || 'غير محدد'}</p>
                  <p className="mt-1">{formatDateTime(voucher.used_at)}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openRedeem(voucher)}
                  className="mt-3 w-full rounded-xl bg-amber-500/90 py-2 text-sm font-black text-slate-950 hover:bg-amber-400"
                >
                  اصرف الفاوتشر
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {redeemFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-white">صرف فاوتشر {redeemFor.tier_value} ج</h3>
              <button type="button" onClick={() => setRedeemFor(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <CustomerSmartSearch
                value={selectedCustomer}
                onSelect={setSelectedCustomer}
                placeholder="ابحث باسم العميل أو الكود أو الهاتف"
                disabled={saving}
              />
              <input
                className="input-dark w-full"
                placeholder="رقم فاتورة (اختياري)"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                onClick={() => void confirmRedeem()}
                disabled={saving || !selectedCustomer}
                className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-black text-slate-950 disabled:opacity-50"
              >
                {saving ? 'جارٍ الصرف...' : 'تأكيد الصرف'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
