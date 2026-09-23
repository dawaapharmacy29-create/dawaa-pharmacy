import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { advanceCandidate, candidateHistory, createCandidate, listCandidates, type Candidate, type CandidateEvent } from '@/lib/hr/recruitmentService';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

const stages: Record<string,string> = { applied: 'تقديم', screening: 'فرز', interview: 'مقابلة', offer: 'عرض عمل', hired: 'تم التعيين', rejected: 'مرفوض', withdrawn: 'انسحب' };
const next: Record<string,string[]> = { applied: ['screening','rejected','withdrawn'], screening: ['interview','rejected','withdrawn'], interview: ['offer','rejected','withdrawn'], offer: ['hired','rejected','withdrawn'] };

export default function RecruitmentPipeline({ staff }: { staff: StaffDirectoryIdentity[] }) {
  const [rows,setRows] = useState<Candidate[]>([]);
  const [history,setHistory] = useState<CandidateEvent[]>([]);
  const [selected,setSelected] = useState('');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [name,setName] = useState(''); const [phone,setPhone] = useState('');
  const [position,setPosition] = useState(''); const [branch,setBranch] = useState('');
  const [stage,setStage] = useState(''); const [note,setNote] = useState(''); const [staffId,setStaffId] = useState('');
  async function refresh() { setRows(await listCandidates()); setError(''); }
  useEffect(() => { let active=true; listCandidates().then(r=>{if(active)setRows(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)}); return ()=>{active=false}; },[]);
  useEffect(() => { let active=true; setHistory([]); if(selected) candidateHistory(selected).then(r=>{if(active)setHistory(r)}).catch(e=>{if(active)setError(e.message)}); return ()=>{active=false}; },[selected]);
  const current=rows.find(r=>r.id===selected);
  async function create() { if(name.trim().length<2||position.trim().length<2||branch.trim().length<2) {toast.warning('اكتب الاسم والوظيفة والفرع.');return} setSaving(true); try {await createCandidate({name:name.trim(),phone:phone.trim(),position_title:position.trim(),target_branch:branch.trim()}); await refresh();setName('');setPhone('');setPosition('');setBranch('');toast.success('تم تسجيل المتقدم')}catch(e){toast.error(e instanceof Error?e.message:'تعذر التسجيل')}finally{setSaving(false)} }
  async function advance() {if(!current||!stage||stage==='hired'&&!staffId){toast.warning('اختر المرحلة والموظف عند التعيين.');return}setSaving(true);try{await advanceCandidate(current.id,stage,note.trim(),staffId||undefined);await refresh();setHistory(await candidateHistory(current.id));setStage('');setNote('');setStaffId('');toast.success('تم تحديث المرحلة')}catch(e){toast.error(e instanceof Error?e.message:'تعذر التحديث')}finally{setSaving(false)}}
  return <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
    <h2 className="font-black">التوظيف · من التقديم للتعيين</h2>
    <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">التعيين يربط المتقدم بسجل موظف موجود بعد إنشاء الموظف ومراجعته؛ لا ينشئ حساب دخول أو راتبًا تلقائيًا. تظهر أحدث ١٠٠ حالة.</p>
    {error&&<p role="alert" className="mt-2 text-red-500">{error}</p>}
    <div className="mt-3 grid gap-2 md:grid-cols-4">
      <input className="input-dark" placeholder="اسم المتقدم" maxLength={160} value={name} onChange={e=>setName(e.target.value)}/>
      <input className="input-dark" placeholder="هاتف اختياري" maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)}/>
      <input className="input-dark" placeholder="الوظيفة" maxLength={120} value={position} onChange={e=>setPosition(e.target.value)}/>
      <input className="input-dark" placeholder="الفرع المطلوب" maxLength={120} value={branch} onChange={e=>setBranch(e.target.value)}/>
    </div><button className="btn-primary mt-2" disabled={saving} onClick={()=>void create()}>تسجيل المتقدم</button>
    <label className="mt-4 block">الحالات {loading?'· جارٍ التحميل':`· ${rows.length}`}<select className="input-dark mt-1 w-full" value={selected} onChange={e=>{setSelected(e.target.value);setStage('');setStaffId('')}}><option value="">اختر متقدمًا</option>{rows.map(r=><option key={r.id} value={r.id}>{r.name} · {r.position_title} · {r.target_branch} · {stages[r.stage]}</option>)}</select></label>
    {current&&<div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3"><strong>{current.name} · {stages[current.stage]}</strong><p className="text-sm">{current.position_title} · {current.target_branch} · {current.phone||'بلا هاتف'}</p>
      {!!next[current.stage]?.length&&<div className="mt-3 grid gap-2 md:grid-cols-2"><label>المرحلة التالية<select className="input-dark mt-1 w-full" value={stage} onChange={e=>setStage(e.target.value)}><option value="">اختر</option>{next[current.stage].map(s=><option key={s} value={s}>{stages[s]}</option>)}</select></label>
      {stage==='hired'&&<label>ربط بسجل الموظف المعتمد<select className="input-dark mt-1 w-full" value={staffId} onChange={e=>setStaffId(e.target.value)}><option value="">اختر موظفًا</option>{staff.filter(s=>s.id).map(s=><option key={s.id} value={s.id||''}>{s.name} · {s.branch}</option>)}</select></label>}
      <label className="md:col-span-2">ملاحظة اختيارية<input className="input-dark mt-1 w-full" maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="btn-primary" disabled={saving} onClick={()=>void advance()}>حفظ المرحلة</button></div>}
      <h3 className="mt-3 font-bold">تاريخ المراحل</h3>{history.map(event=><p key={event.id} className="text-sm">{stages[event.from_stage||'']||'بداية'} ← {stages[event.to_stage]} · {new Date(event.created_at).toLocaleString('ar-EG')} {event.note&&`· ${event.note}`}</p>)}
    </div>}
  </section>;
}
