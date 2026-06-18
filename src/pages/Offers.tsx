import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PackageCheck, Pause, Play, RefreshCw, Search, Square, Tag } from 'lucide-react';
import { toast } from 'sonner';
import ImageUploadBox from '@/components/ImageUploadBox';
import { supabase } from '@/lib/supabase';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency } from '@/lib/utils';

type OfferRow = Record<string, unknown>;
type DispenseRow = Record<string, unknown>;

const ALL = 'الكل';
const statuses = [
  ['scheduled', 'مجدول'],
  ['active', 'نشط'],
  ['paused', 'متوقف مؤقتًا'],
  ['expired', 'منتهي'],
  ['stopped', 'متوقف'],
] as const;

function text(row: OfferRow, key: string, fallback = '') {
  return String(row[key] ?? fallback).trim();
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? '').trim()
  );
}

function safeUuid(value: unknown) {
  const textValue = String(value ?? '').trim();
  return isUuidLike(textValue) ? textValue : null;
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

async function insertResilient(table: string, payload: Record<string, unknown>) {
  let next = payload;
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(next).select('*').single();
    if (!error) return data as Record<string, unknown>;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);
    removed.add(column);
    next = { ...next };
    delete next[column];
  }
  throw new Error('تعذر الحفظ بسبب اختلاف أعمدة الجدول.');
}

export default function Offers() {
  const { user } = useAuth();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [dispenses, setDispenses] = useState<DispenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [image, setImage] = useState({ publicUrl: '', path: '' });
  const [form, setForm] = useState({
    title: '',
    item_name: '',
    item_code: '',
    branch: 'كل الفروع',
    current_qty: 0,
    original_price: 0,
    discount_type: 'fixed',
    discount_value: 0,
    final_price: 0,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    status: 'active',
    has_doctor_incentive: false,
    doctor_incentive_type: 'none',
    doctor_incentive_value: 0,
    description: '',
    incentive_notes: '',
    team_notes: '',
    whatsapp_script: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [offerResult, dispenseResult] = await Promise.all([
      supabase.from('offers').select('*').order('created_at', { ascending: false }).limit(500),
      supabase
        .from('offer_dispenses')
        .select('*')
        .order('dispensed_at', { ascending: false })
        .limit(500),
    ]);
    if (offerResult.error) toast.error(`تعذر تحميل العروض: ${offerResult.error.message}`);
    setOffers((offerResult.data || []) as OfferRow[]);
    setDispenses(dispenseResult.error ? [] : ((dispenseResult.data || []) as DispenseRow[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return offers.filter((offer) => {
      if (statusFilter !== ALL && text(offer, 'status') !== statusFilter) return false;
      if (branchFilter !== ALL && text(offer, 'branch') !== branchFilter) return false;
      if (!needle) return true;
      return ['title', 'item_name', 'item_code', 'branch', 'status'].some((key) =>
        text(offer, key).toLowerCase().includes(needle)
      );
    });
  }, [branchFilter, offers, query, statusFilter]);

  const stats = useMemo(() => {
    const active = offers.filter((offer) => text(offer, 'status') === 'active').length;
    const soon = offers.filter((offer) => {
      const end = new Date(text(offer, 'end_date'));
      if (Number.isNaN(end.getTime())) return false;
      const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 3;
    }).length;
    const withIncentive = offers.filter((offer) => Boolean(offer.has_doctor_incentive)).length;
    const sales = dispenses.reduce((sum, row) => sum + num(row.total_value || row.sale_price), 0);
    return { active, soon, withIncentive, sales };
  }, [dispenses, offers]);

  const updateField = (key: string, value: string | number | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return toast.error('اكتب عنوان العرض.');
    if (!form.item_name.trim()) return toast.error('اكتب اسم الصنف.');
    setSaving(true);
    try {
      const created = await insertResilient('offers', {
        ...form,
        image_url: image.publicUrl || null,
        image_path: image.path || null,
        created_by: safeUuid(user?.id),
        created_by_name: user?.name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setOffers((rows) => [created, ...rows]);
      setImage({ publicUrl: '', path: '' });
      toast.success('تم حفظ العرض بنجاح.');
    } catch (error) {
      toast.error(`تعذر حفظ العرض: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (offer: OfferRow, status: string) => {
    const { error } = await supabase
      .from('offers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', offer.id);
    if (error) return toast.error(`تعذر تحديث حالة العرض: ${error.message}`);
    toast.success('تم تحديث حالة العرض.');
    await load();
  };

  if (loading)
    return (
      <div className="stat-card py-16 text-center text-slate-300">
        <Loader2 className="mx-auto mb-3 animate-spin text-teal-300" /> جاري تحميل العروض...
      </div>
    );

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-teal-500/15 p-3 text-teal-300">
            <Tag size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">العروض</h1>
            <p className="mt-1 text-sm text-slate-400">
              إدارة العروض، الصور، الكميات، الخصومات وحوافز الدكاترة من مصدر واحد متصل.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="عروض نشطة" value={stats.active} />
        <Stat label="تنتهي قريبًا" value={stats.soon} danger={stats.soon > 0} />
        <Stat label="بحافز دكتور" value={stats.withIncentive} />
        <Stat label="مبيعات العروض" value={Math.round(stats.sales)} />
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-5">
        <div className="mb-4 text-lg font-black text-white">إضافة عرض جديد</div>
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ImageUploadBox
            bucket="offer-assets"
            folder="offers"
            label="رفع صورة العرض"
            valueUrl={image.publicUrl}
            valuePath={image.path}
            onUploaded={setImage}
            disabled={saving}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <Field
              label="عنوان العرض *"
              value={form.title}
              onChange={(v) => updateField('title', v)}
            />
            <Field
              label="اسم الصنف *"
              value={form.item_name}
              onChange={(v) => updateField('item_name', v)}
            />
            <Field
              label="كود الصنف"
              value={form.item_code}
              onChange={(v) => updateField('item_code', v)}
            />
            <Select
              label="الفرع"
              value={form.branch}
              options={['كل الفروع', ...BRANCHES]}
              onChange={(v) => updateField('branch', v)}
            />
            <Field
              label="الكمية المتاحة"
              type="number"
              value={form.current_qty}
              onChange={(v) => updateField('current_qty', Number(v))}
            />
            <Field
              label="السعر الأصلي"
              type="number"
              value={form.original_price}
              onChange={(v) => updateField('original_price', Number(v))}
            />
            <Select
              label="نوع الخصم"
              value={form.discount_type}
              options={['percentage', 'fixed', 'bundle', 'note']}
              onChange={(v) => updateField('discount_type', v)}
            />
            <Field
              label="قيمة الخصم"
              type="number"
              value={form.discount_value}
              onChange={(v) => updateField('discount_value', Number(v))}
            />
            <Field
              label="السعر النهائي"
              type="number"
              value={form.final_price}
              onChange={(v) => updateField('final_price', Number(v))}
            />
            <Field
              label="تاريخ البداية"
              type="date"
              value={form.start_date}
              onChange={(v) => updateField('start_date', v)}
            />
            <Field
              label="تاريخ النهاية"
              type="date"
              value={form.end_date}
              onChange={(v) => updateField('end_date', v)}
            />
            <Select
              label="الحالة"
              value={form.status}
              options={statuses.map(([value]) => value)}
              onChange={(v) => updateField('status', v)}
            />
            <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-3 text-sm font-bold text-slate-200">
              <input
                type="checkbox"
                checked={form.has_doctor_incentive}
                onChange={(e) => updateField('has_doctor_incentive', e.target.checked)}
              />
              يوجد حافز للدكتور
            </label>
            <Select
              label="نوع الحافز"
              value={form.doctor_incentive_type}
              options={['none', 'points', 'fixed_amount', 'percentage']}
              onChange={(v) => updateField('doctor_incentive_type', v)}
            />
            <Field
              label="قيمة الحافز"
              type="number"
              value={form.doctor_incentive_value}
              onChange={(v) => updateField('doctor_incentive_value', Number(v))}
            />
            <Textarea
              label="ملاحظات الفريق"
              value={form.team_notes}
              onChange={(v) => updateField('team_notes', v)}
            />
            <Textarea
              label="سكريبت واتساب"
              value={form.whatsapp_script}
              onChange={(v) => updateField('whatsapp_script', v)}
            />
            <Textarea
              label="الوصف"
              value={form.description}
              onChange={(v) => updateField('description', v)}
            />
          </div>
        </div>
        <button className="btn-primary mt-4 flex items-center gap-2 px-5 py-2" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
          حفظ العرض
        </button>
      </form>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <label className="relative">
            <Search
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              size={16}
            />
            <input
              className="input-dark pr-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث باسم العرض أو الصنف..."
            />
          </label>
          <select
            className="input-dark"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option>{ALL}</option>
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="input-dark"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option>{ALL}</option>
            {['كل الفروع', ...BRANCHES].map((branch) => (
              <option key={branch}>{branch}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="btn-secondary flex items-center gap-2 px-4"
          >
            <RefreshCw size={15} /> تحديث
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {filtered.map((offer) => (
          <div
            key={String(offer.id)}
            className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4"
          >
            <div className="flex gap-4">
              {offer.image_url ? (
                <img
                  src={String(offer.image_url)}
                  alt=""
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : (
                <div className="h-24 w-24 rounded-xl bg-white/5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-lg font-black text-white">
                    {text(offer, 'title', 'عرض بدون عنوان')}
                  </div>
                  <span className="badge-info">
                    {statuses.find(([value]) => value === text(offer, 'status'))?.[1] ||
                      text(offer, 'status')}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-300 md:grid-cols-4">
                  <Mini label="الصنف" value={text(offer, 'item_name', '-')} />
                  <Mini label="الكمية" value={num(offer.current_qty).toLocaleString('ar-EG')} />
                  <Mini label="السعر النهائي" value={formatCurrency(num(offer.final_price))} />
                  <Mini label="حافز" value={offer.has_doctor_incentive ? 'نعم' : 'لا'} />
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => changeStatus(offer, 'active')}
                className="btn-secondary flex items-center gap-2 text-xs"
              >
                <Play size={14} /> تفعيل
              </button>
              <button
                type="button"
                onClick={() => changeStatus(offer, 'paused')}
                className="btn-secondary flex items-center gap-2 text-xs"
              >
                <Pause size={14} /> إيقاف مؤقت
              </button>
              <button
                type="button"
                onClick={() => changeStatus(offer, 'stopped')}
                className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200"
              >
                <Square size={14} className="inline" /> إيقاف
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="stat-card py-12 text-center text-slate-400 xl:col-span-2">
            لا توجد عروض مطابقة حاليًا.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="stat-card text-center">
      <div className={`num text-2xl font-black ${danger ? 'text-red-300' : 'text-teal-300'}`}>
        {value.toLocaleString('ar-EG')}
      </div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 text-xs text-slate-300">
      <span>{label}</span>
      <input
        className="input-dark"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs text-slate-300">
      <span>{label}</span>
      <select className="input-dark" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs text-slate-300 md:col-span-3">
      <span>{label}</span>
      <textarea
        className="input-dark min-h-20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="truncate font-bold text-white">{value}</div>
    </div>
  );
}
