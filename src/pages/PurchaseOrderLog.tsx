import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';

const BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;

type Supplier = { id: string; name: string; active: boolean };

type OrderRow = {
  id: string;
  branch: string;
  supplier_id: string | null;
  supplier_name: string | null;
  order_date: string;
  cover_days: number | null;
  items: { name?: string; quantity?: number }[];
  items_count: number;
  gross_cost: number | null;
  total_cost: number | null;
  created_by_name: string | null;
  notes: string | null;
};

type ItemDraft = { name: string; quantity: string };

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function PurchaseOrderLog() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [ordersRes, suppliersRes] = await Promise.all([
      supabase.from('purchase_order_log').select('*').order('order_date', { ascending: false }).limit(200),
      supabase.rpc('list_purchase_suppliers_v1'),
    ]);
    if (ordersRes.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setOrders((ordersRes.data || []) as OrderRow[]);
    if (!suppliersRes.error) setSuppliers((suppliersRes.data || []) as Supplier[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      count: orders.length,
      totalCost: orders.reduce((a, o) => a + n(o.total_cost), 0),
    }),
    [orders]
  );

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-2xl">سجل الطلبيات</h1>
            <p className="dawaa-caption mt-1 font-bold">تتبع مين طلب إيه وإمتى، بشكل منفصل عن فواتير المشتريات الفعلية.</p>
          </div>
          <button type="button" onClick={() => setShowForm((v) => !v)} className="dawaa-button dawaa-button--primary">
            <Plus size={17} /> تسجيل طلبية جديدة
          </button>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <MiniBox label="عدد الطلبيات المسجلة" value={totals.count.toLocaleString('ar-EG')} />
        <MiniBox label="إجمالي تكلفة الطلبيات" value={formatCurrency(totals.totalCost)} />
      </div>

      {showForm ? (
        <NewOrderForm
          suppliers={suppliers}
          staffId={user?.staffId || user?.id || ''}
          staffName={user?.name || ''}
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <Panel className="p-4">
        <SectionTitle title="الطلبيات المسجلة" icon={<ClipboardList size={18} />} />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : orders.length === 0 ? (
          <EmptyState label="لا توجد طلبيات مسجلة" />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {order.supplier_name || 'مورد غير محدد'} — {order.branch}
                    </p>
                    <p className="dawaa-caption mt-0.5 text-xs font-bold">
                      {order.order_date} · بواسطة {order.created_by_name || '-'}
                      {order.cover_days ? ` · تغطية ${order.cover_days} يوم` : ''}
                    </p>
                  </div>
                  <span className="font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
                    {formatCurrency(n(order.total_cost))}
                  </span>
                </div>
                {order.items?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {order.items.slice(0, 8).map((it, idx) => (
                      <span key={idx} className="dawaa-badge dawaa-badge--info text-xs font-bold">
                        {it.name || '-'} × {it.quantity || 0}
                      </span>
                    ))}
                    {order.items.length > 8 ? (
                      <span className="dawaa-caption text-xs font-bold">+{order.items.length - 8} أصناف أخرى</span>
                    ) : null}
                  </div>
                ) : null}
                {order.notes ? <p className="dawaa-body mt-2 text-sm font-bold">{order.notes}</p> : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function NewOrderForm({
  suppliers,
  staffId,
  staffName,
  onCreated,
  onCancel,
}: {
  suppliers: Supplier[];
  staffId: string;
  staffName: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [branch, setBranch] = useState<(typeof BRANCHES)[number]>('فرع شكري');
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [coverDays, setCoverDays] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([{ name: '', quantity: '1' }]);
  const [submitting, setSubmitting] = useState(false);

  const activeSuppliers = suppliers.filter((s) => s.active);

  const updateItem = (idx: number, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleSubmit = async () => {
    const cleanItems = items.filter((it) => it.name.trim());
    if (!cleanItems.length) {
      toast.error('أضف صنف واحد على الأقل');
      return;
    }
    const supplier = suppliers.find((s) => s.id === supplierId);
    setSubmitting(true);
    try {
      const { error } = await supabase.from('purchase_order_log').insert({
        branch,
        supplier_id: supplierId || null,
        supplier_name: supplier?.name || null,
        order_date: orderDate,
        cover_days: coverDays ? n(coverDays) : null,
        items: cleanItems.map((it) => ({ name: it.name, quantity: n(it.quantity) })),
        items_count: cleanItems.length,
        created_by_staff_id: staffId || null,
        created_by_name: staffName || null,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success('تم تسجيل الطلبية');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تسجيل الطلبية');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel className="p-4">
      <SectionTitle title="تسجيل طلبية جديدة" />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">الفرع</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value as (typeof BRANCHES)[number])} className="dawaa-input py-2.5 text-sm font-bold">
            {BRANCHES.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">المورد</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold">
            <option value="">بدون مورد محدد</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">تاريخ الطلب</label>
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold" />
        </div>
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">أيام التغطية</label>
          <input type="number" value={coverDays} onChange={(e) => setCoverDays(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold" />
        </div>
      </div>

      <div className="mt-4">
        <label className="dawaa-caption mb-2 block text-xs font-bold">الأصناف المطلوبة</label>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[3fr_1fr]">
              <input
                value={it.name}
                onChange={(e) => updateItem(idx, { name: e.target.value })}
                placeholder="اسم الصنف"
                className="dawaa-input py-2 text-sm font-bold"
              />
              <input
                type="number"
                value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                placeholder="الكمية"
                className="dawaa-input py-2 text-sm font-bold"
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { name: '', quantity: '1' }])}
          className="dawaa-button dawaa-button--secondary mt-2 text-xs"
        >
          <Plus size={14} /> إضافة صنف
        </button>
      </div>

      <div className="mt-3">
        <label className="dawaa-caption mb-1 block text-xs font-bold">ملاحظات</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="dawaa-input py-2 text-sm font-bold" rows={2} />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="dawaa-button dawaa-button--secondary text-sm">إلغاء</button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleSubmit()}
          className="dawaa-button dawaa-button--primary text-sm disabled:opacity-50"
        >
          {submitting ? 'جاري الحفظ...' : 'حفظ الطلبية'}
        </button>
      </div>
    </Panel>
  );
}
