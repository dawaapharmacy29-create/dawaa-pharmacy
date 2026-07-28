import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES, CUSTOMER_SERVICE_DOCTORS } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { searchCustomerMetrics } from '@/lib/api/customerServiceCommandCenter';
import { createDoctorRequestedFollowup } from '@/lib/api/doctorRequestedFollowups';

type CustomerHit = { id: string; name: string; phone: string; code: string; branch: string };

const CATEGORIES = ['روشتة أو علاج جديد', 'مريض مزمن', 'عميل مهم للفرع', 'متابعة حالة مريض', 'احتمال شراء متكرر', 'شكوى أو احتياج خاص'];
const TRAITS = ['متعاون', 'يحتاج شرح', 'حساس للسعر', 'يفضل واتساب', 'يفضل مكالمة', 'يحتاج متابعة سريعة'];
const RATINGS = [
  { value: 1, label: 'عميل عادي', hint: 'متابعة طبيعية' },
  { value: 2, label: 'عميل متوسط', hint: 'فرصة جيدة' },
  { value: 3, label: 'عميل مهم', hint: 'أولوية مرتفعة' },
  { value: 4, label: 'عميل مهم جدًا', hint: 'أولوية قصوى' },
];

function localDateTime() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

export default function ExceptionalFollowupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [rating, setRating] = useState(3);
  const [traits, setTraits] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [assignedDoctor, setAssignedDoctor] = useState('');
  const [due, setDue] = useState(localDateTime());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBranch(normalizeBranchName(user?.branch || '') || '');
    setDue(localDateTime());
  }, [open, user?.branch]);

  useEffect(() => {
    if (!open || search.trim().length < 2 || !branch) { setHits([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await searchCustomerMetrics(search.trim(), branch);
        if (cancelled) return;
        setHits(rows.slice(0, 8).map((row) => ({ id: String(row.customer_id || row.id || ''), name: String(row.customer_name || row.name || ''), phone: String(row.displayPhone || row.customer_phone || row.phone || ''), code: String(row.customer_code || ''), branch: normalizeBranchName(row.branch || branch) })));
      } finally { if (!cancelled) setSearching(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [branch, open, search]);

  if (!open) return null;

  const toggleTrait = (trait: string) => setTraits((current) => current.includes(trait) ? current.filter((item) => item !== trait) : [...current, trait]);

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const targetBranch = normalizeBranchName(branch || user?.branch || '');
    if (!targetBranch) return toast.error('اختر الفرع');
    if (!cleanName && !cleanPhone && !code.trim()) return toast.error('أدخل اسم العميل أو الهاتف أو الكود');
    setSaving(true);
    try {
      const ratingLabel = RATINGS.find((item) => item.value === rating)?.label || '';
      const summary = [
        `customer_rating: ${rating}`,
        `request_category: ${category}`,
        `customer_level: ${ratingLabel}`,
        traits.length ? `customer_traits: ${traits.join('، ')}` : '',
        notes.trim() ? `doctor_notes: ${notes.trim()}` : '',
      ].filter(Boolean).join('\n');
      await createDoctorRequestedFollowup({
        customerName: cleanName || 'عميل بدون اسم',
        customerPhone: cleanPhone || null,
        customerCode: code.trim() || null,
        branch: targetBranch,
        priority: rating >= 4 ? 'عاجل جدًا' : rating === 3 ? 'عاجل' : 'مهم',
        requestType: 'exceptional_followup',
        followupReason: category,
        requestDetails: summary,
        notes: `${summary}\nالمصدر: exceptional_followup_modal`,
        assignedDoctor: assignedDoctor || undefined,
        followupDatetime: due ? new Date(due).toISOString() : undefined,
        createdBy: user?.id || null,
        createdByStaffId: user?.staffId || null,
        createdByName: user?.name?.trim() || 'مستخدم النظام',
        source: 'exceptional_followup',
      });
      toast.success('تم إرسال طلب المتابعة الاستثنائية لخدمة العملاء');
      window.dispatchEvent(new CustomEvent('customer-followup-updated'));
      onCreated?.();
      onClose();
    } catch (error) {
      toast.error(`تعذر إنشاء المتابعة: ${(error as Error).message}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-3" dir="rtl">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="إغلاق" />
      <section className="relative z-10 max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-amber-300/30 bg-[#071827] p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Sparkles className="text-amber-300" size={21}/><h2 className="text-xl font-black text-white">طلب متابعة استثنائية سريع</h2></div><p className="mt-1 text-sm font-bold text-slate-400">اختيارات سريعة تكفي لخدمة العملاء، مع إمكانية إضافة ملاحظة قصيرة.</p></div><button type="button" onClick={onClose} className="rounded-xl border border-white/10 p-2 text-slate-200"><X size={18}/></button></div>

        <div className="grid gap-3 md:grid-cols-2"><select className="input-dark" value={branch} onChange={(e)=>setBranch(e.target.value)} disabled={!managerView}><option value="">اختر الفرع</option>{BRANCHES.map((item)=><option key={item}>{item}</option>)}</select><input className="input-dark" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="ابحث بالاسم أو الهاتف أو كود العميل" /></div>
        {searching ? <p className="mt-2 text-xs text-slate-400">جارٍ البحث...</p> : null}
        {hits.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{hits.map((hit)=><button key={hit.id || `${hit.code}-${hit.phone}`} type="button" onClick={()=>{setName(hit.name);setPhone(hit.phone);setCode(hit.code);setBranch(hit.branch || branch);setHits([]);setSearch('');}} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-right hover:border-amber-300/40"><div className="font-black text-white">{hit.name || 'عميل بدون اسم'}</div><div className="mt-1 text-xs text-slate-400">{hit.code || 'بدون كود'} · {hit.phone || 'بدون هاتف'} · {hit.branch || 'غير محدد'}</div></button>)}</div> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3"><input className="input-dark" value={name} onChange={(e)=>setName(e.target.value)} placeholder="اسم العميل" /><input className="input-dark" value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="رقم الهاتف" /><input className="input-dark" value={code} onChange={(e)=>setCode(e.target.value)} placeholder="كود العميل (اختياري)" /></div>

        <div className="mt-4"><p className="mb-2 text-sm font-black text-white">تقييم أهمية العميل</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{RATINGS.map((item)=><button key={item.value} type="button" onClick={()=>setRating(item.value)} className={`rounded-2xl border p-3 text-right transition ${rating===item.value?'border-amber-300 bg-amber-400/15':'border-white/10 bg-white/[0.03]'}`}><div className="font-black text-white">{item.value} — {item.label}</div><div className="mt-1 text-xs font-bold text-slate-400">{item.hint}</div></button>)}</div></div>

        <div className="mt-4 grid gap-3 md:grid-cols-2"><select className="input-dark" value={category} onChange={(e)=>setCategory(e.target.value)}>{CATEGORIES.map((item)=><option key={item}>{item}</option>)}</select><select className="input-dark" value={assignedDoctor} onChange={(e)=>setAssignedDoctor(e.target.value)}><option value="">المسؤول حسب الفرع</option>{CUSTOMER_SERVICE_DOCTORS.map((doctor)=><option key={doctor}>{doctor}</option>)}</select><input className="input-dark" type="datetime-local" value={due} onChange={(e)=>setDue(e.target.value)} /></div>

        <div className="mt-4"><p className="mb-2 text-sm font-black text-white">صفات سريعة للعميل</p><div className="flex flex-wrap gap-2">{TRAITS.map((trait)=><button key={trait} type="button" onClick={()=>toggleTrait(trait)} className={`rounded-full border px-3 py-2 text-xs font-black ${traits.includes(trait)?'border-cyan-300 bg-cyan-400/15 text-cyan-100':'border-white/10 bg-white/[0.03] text-slate-300'}`}>{trait}</button>)}</div></div>

        <textarea className="input-dark mt-4 min-h-24" value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="ملاحظة قصيرة اختيارية: حالة العميل، المطلوب من خدمة العملاء، أو أي نقطة مهمة" />
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button><button type="button" className="rounded-xl bg-amber-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50" onClick={submit} disabled={saving}>{saving ? 'جارٍ الإرسال...' : 'إرسال الطلب الاستثنائي'}</button></div>
      </section>
    </div>
  );
}
