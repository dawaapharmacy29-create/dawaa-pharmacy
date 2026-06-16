import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Bike, CheckCircle2, Gift, LogOut, Package, RefreshCw, Search, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import RiderDeviceStatusTable, { type RiderDeviceStatusRow } from '../../components/RiderDeviceStatusTable'
import { getCurrentSession, getUserProfile, logout } from '../../lib/auth'
import { getOperationalPeriod, wildcardMatchText } from '../../lib/helpers'
import type { DeliveryOrder, InternalTrip, Rider } from '../../lib/types'

type Profile = { id: string; display_name: string; role: string; branch_id: string | null }
type ReviewModal = { type: 'reassign' | 'delete' | 'penalty' | 'reward' | 'order_to_trip' | 'trip_to_order' | 'edit_invoice'; row: any } | null

function isFailed(o: any) { return String(o?.status || '').toLowerCase().includes('fail') || !!o?.failed_at || !!o?.failed_reason }
function isDelivered(o: any) { return String(o?.status || '').toLowerCase() === 'delivered' || !!o?.delivered_at }
function isMultiplier(o: any) { return Number(o?.order_multiplier ?? (o?.is_multiplier_order ? 1.5 : 1)) >= 1.5 }
function isDuplicate(o: any) { return !!(o?.is_duplicate_invoice || o?.duplicate_warning) }

function Card({ title, value, icon, tone='emerald', onClick }: { title: string; value: number | string; icon: React.ReactNode; tone?: 'emerald'|'sky'|'amber'|'rose'|'purple'; onClick?: () => void }) {
  const cls: any = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100', sky: 'bg-sky-50 text-sky-700 border-sky-100', amber: 'bg-amber-50 text-amber-700 border-amber-100', rose: 'bg-rose-50 text-rose-700 border-rose-100', purple: 'bg-purple-50 text-purple-700 border-purple-100'
  }
  return <button onClick={onClick} className="rounded-3xl border bg-white p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
    <div className="flex items-center justify-between gap-3"><span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${cls[tone]}`}>{icon}</span><div><p className="text-sm font-black text-slate-500">{title}</p><p className="mt-1 text-3xl font-black text-[#061827]">{value}</p></div></div>
  </button>
}

function ActionButton({ label, tone='green', onClick }: { label: string; tone?: 'green'|'red'|'blue'|'orange'; onClick: () => void }) {
  const cls: any = { green:'border-emerald-200 bg-emerald-50 text-emerald-700', red:'border-rose-200 bg-rose-50 text-rose-700', blue:'border-sky-200 bg-sky-50 text-sky-700', orange:'border-amber-200 bg-amber-50 text-amber-700' }
  return <button onClick={onClick} className={`rounded-xl border px-3 py-2 text-xs font-black ${cls[tone]}`}>{label}</button>
}

export default function BranchManagerDashboard() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [branchId, setBranchId] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('الفرع')
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [trips, setTrips] = useState<InternalTrip[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [deviceRows, setDeviceRows] = useState<RiderDeviceStatusRow[]>([])
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ReviewModal>(null)
  const [reason, setReason] = useState('')
  const [targetRiderId, setTargetRiderId] = useState('')
  const [newInvoiceNumber, setNewInvoiceNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const period = getOperationalPeriod()

  async function load() {
    setLoading(true)
    try {
      const session = await getCurrentSession()
      const prof = session?.user?.id ? await getUserProfile(session.user.id) : null
      setProfile(prof as any)
      const bId = (prof as any)?.branch_id || branchId
      setBranchId(bId)
      if (bId) {
        const { data: b } = await supabase.from('branches').select('*').eq('id', bId).maybeSingle()
        setBranchName((b as any)?.display_name || (b as any)?.name || 'الفرع')
      }
      let oq = supabase.from('delivery_orders').select('*').gte('delivery_date', period.start).lte('delivery_date', period.end).order('created_at', { ascending: false })
      let tq = supabase.from('internal_trips').select('*').gte('trip_date', period.start).lte('trip_date', period.end).order('created_at', { ascending: false })
      let rq = supabase.from('riders').select('*').order('name', { ascending: true })
      if (bId) { oq = oq.eq('branch_id', bId); tq = tq.eq('branch_id', bId); rq = rq.eq('branch_id', bId) }
      const [or, tr, rr, dr] = await Promise.all([oq, tq, rq, supabase.from('rider_device_status').select('*').order('last_seen_at', { ascending: false })])
      if (or.error) throw or.error
      if (tr.error) throw tr.error
      if (rr.error) throw rr.error
      setOrders((or.data || []) as any)
      setTrips((tr.data || []) as any)
      setRiders((rr.data || []) as any)
      const branchDeviceRows = ((dr as any).data || []).filter((x: any) => !bId || x.branch_id === bId)
      setDeviceRows(branchDeviceRows as any)
    } catch (e: any) {
      toast.error(e?.message || 'تعذر تحميل بيانات الفرع')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const filteredOrders = useMemo(() => {
    if (!query.trim()) return orders
    return orders.filter(o => wildcardMatchText([o.invoice_number, (o as any).invoice_no, o.customer_name_snapshot, (o as any).customer_name, (o as any).rider_name, (o as any).driver_name].join(' '), query))
  }, [orders, query])

  const kpi = useMemo(() => ({
    orders: orders.length,
    delivered: orders.filter(isDelivered).length,
    failed: orders.filter(isFailed).length,
    mult: orders.filter(isMultiplier).length,
    dup: orders.filter(isDuplicate).length,
    trips: trips.length,
    pendingTrips: trips.filter(x => x.status === 'pending_approval').length,
  }), [orders, trips])

  async function applyAction() {
    if (!modal || !profile) return
    if (!reason.trim()) { toast.error('يجب كتابة سبب واضح للإجراء'); return }
    setSaving(true)
    try {
      const actor = profile.display_name || 'مدير الفرع'
      if (modal.type === 'reassign') {
        if (!targetRiderId) throw new Error('اختر المندوب الجديد')
        const target = riders.find(r => r.id === targetRiderId)
        const { error } = await supabase.from('delivery_orders').update({
          rider_id: targetRiderId,
          rider_name: target?.name || null,
          reassigned_from_rider_id: modal.row.rider_id || null,
          reassigned_to_rider_id: targetRiderId,
          reassignment_reason: reason,
          reassigned_by_name: actor,
          reassigned_at: new Date().toISOString(),
          needs_review: true,
          review_status: 'branch_manager_reassigned',
          updated_at: new Date().toISOString()
        }).eq('id', modal.row.id)
        if (error) throw error
      }
      if (modal.type === 'delete') {
        const { error } = await supabase.from('delivery_orders').update({
          deleted_at: new Date().toISOString(), deleted_by_name: actor, deletion_reason: reason, is_countable: false,
          final_count_status: 'excluded_by_branch_manager', review_status: 'deleted_by_branch_manager', updated_at: new Date().toISOString()
        }).eq('id', modal.row.id)
        if (error) throw error
      }
      if (modal.type === 'penalty' || modal.type === 'reward') {
        const { error } = await supabase.from('rider_shift_actions').insert({
          rider_id: modal.row.rider_id, rider_name: modal.row.rider_name || modal.row.driver_name, branch_id: branchId,
          branch_name: branchName, action_type: modal.type === 'penalty' ? 'deduction_request' : 'bonus_request',
          severity: 'medium', incident_at: new Date().toISOString(), summary: reason,
          created_by_name: actor, review_status: 'pending_general_manager_review'
        })
        if (error) throw error
      }
      if (modal.type === 'order_to_trip') {
        const { error } = await supabase.from('delivery_orders').update({
          review_status: 'converted_to_trip_request', approval_status: 'pending', review_reason: reason, is_countable: false, updated_at: new Date().toISOString()
        }).eq('id', modal.row.id)
        if (error) throw error
      }
      if (modal.type === 'edit_invoice') {
        if (!newInvoiceNumber.trim()) throw new Error('اكتب رقم الفاتورة الصحيح')
        const { data, error } = await supabase.rpc('branch_manager_update_order_invoice', {
          p_order_id: modal.row.id,
          p_new_invoice_number: newInvoiceNumber.trim(),
          p_reason: reason,
          p_actor_name: actor
        })
        if (error) throw error
        const result: any = Array.isArray(data) ? data[0] : data
        if (result?.success === false) throw new Error(result?.message || 'تعذر تعديل رقم الفاتورة')
      }
      toast.success('تم تنفيذ الإجراء وتسجيل اسم منفذه')
      setModal(null); setReason(''); setTargetRiderId(''); setNewInvoiceNumber('')
      await load()
    } catch (e: any) { toast.error(e?.message || 'تعذر تنفيذ الإجراء') }
    finally { setSaving(false) }
  }

  return <div dir="rtl" className="min-h-screen bg-[#F3F7F8] text-[#061827]">
    <header className="sticky top-0 z-20 bg-gradient-to-l from-[#061827] to-[#008E92] px-4 py-4 text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div><p className="text-xs font-bold text-teal-100">لوحة مدير الفرع</p><h1 className="text-2xl font-black">{branchName}</h1><p className="text-sm text-teal-100">الدورة: {period.start} إلى {period.end}</p></div>
        <div className="flex gap-2"><button onClick={() => void load()} className="rounded-2xl bg-white/10 p-3"><RefreshCw size={18}/></button><button onClick={async()=>{ await logout(); navigate('/login')}} className="rounded-2xl bg-white/10 p-3"><LogOut size={18}/></button></div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Card title="أوردرات الدورة" value={kpi.orders} icon={<Package/>}/>
        <Card title="تم التسليم" value={kpi.delivered} icon={<CheckCircle2/>} tone="emerald"/>
        <Card title="فاشلة" value={kpi.failed} icon={<XCircle/>} tone="rose"/>
        <Card title="×1.5" value={kpi.mult} icon={<Gift/>} tone="amber"/>
        <Card title="مكررة" value={kpi.dup} icon={<AlertTriangle/>} tone="rose"/>
        <Card title="مشاوير" value={kpi.trips} icon={<Bike/>} tone="sky"/>
        <Card title="مشاوير معلقة" value={kpi.pendingTrips} icon={<Bell/>} tone="purple"/>
      </section>
      <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="text-xl font-black">مركز تحكم الفرع</h2><p className="text-sm font-bold text-slate-500">كل إجراء يتم باسم مدير الفرع ويظل ظاهرًا في سجل المراجعة.</p></div>
          <div className="relative w-full lg:w-96"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث باستخدام * في العميل أو الفاتورة أو المندوب" className="w-full rounded-2xl border border-slate-200 px-10 py-3 text-right font-bold outline-none focus:border-[#008E92]"/></div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm">
            <thead><tr className="border-b bg-slate-50 text-slate-500"><th className="p-3">الفاتورة</th><th className="p-3">العميل</th><th className="p-3">المندوب</th><th className="p-3">الحالة</th><th className="p-3">إجراءات مدير الفرع</th></tr></thead>
            <tbody>{filteredOrders.slice(0,30).map((o:any)=><tr key={o.id} className="border-b last:border-0"><td className="p-3 font-black">{o.invoice_number || o.invoice_no || o.order_no || '—'}</td><td className="p-3"><p className="font-black">{o.customer_name_snapshot || o.customer_name || '—'}</p><p className="text-xs text-slate-400">{o.customer_phone_snapshot || o.customer_phone || ''}</p></td><td className="p-3 font-bold">{o.rider_name || o.driver_name || 'غير محدد'}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{isFailed(o)?'فاشل':isDelivered(o)?'تم التسليم':isMultiplier(o)?'×1.5':isDuplicate(o)?'مكرر':'مراجعة'}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><ActionButton label="تعديل رقم الفاتورة" tone="orange" onClick={()=>{ setNewInvoiceNumber(String(o.invoice_number || o.invoice_no || '')); setModal({type:'edit_invoice',row:o}) }}/><ActionButton label="تحويل لمندوب" tone="blue" onClick={()=>setModal({type:'reassign',row:o})}/><ActionButton label="تحويل لمشوار" tone="orange" onClick={()=>setModal({type:'order_to_trip',row:o})}/><ActionButton label="خصم" tone="red" onClick={()=>setModal({type:'penalty',row:o})}/><ActionButton label="مكافأة" tone="green" onClick={()=>setModal({type:'reward',row:o})}/><ActionButton label="حذف حفظي" tone="red" onClick={()=>setModal({type:'delete',row:o})}/></div></td></tr>)}{!filteredOrders.length&&<tr><td colSpan={5} className="p-8 text-center font-black text-slate-400">لا توجد بيانات مطابقة</td></tr>}</tbody>
          </table>
        </div>
      </section>
      <RiderDeviceStatusTable rows={deviceRows} loading={loading} onRefresh={() => void load()} title="شحن بطاريات دليفري الفرع" />
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm"><h3 className="mb-4 font-black">ضوابط مدير الفرع</h3><ul className="space-y-2 text-sm font-bold text-slate-600"><li>✓ التحويل بين المندوبين بسبب واضح.</li><li>✓ حذف حفظي لا يمسح البيانات نهائيًا.</li><li>✓ طلب الخصم أو المكافأة يذهب للمدير العام.</li><li>✓ أوردر ×1.5 لا يحتسب إلا بعد الموافقة.</li></ul></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><h3 className="mb-4 font-black">تنبيهات الفرع</h3><p className="text-sm font-bold text-slate-500">مكررات: {kpi.dup} · فاشلة: {kpi.failed} · مشاوير معلقة: {kpi.pendingTrips}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><h3 className="mb-4 font-black">إجراءات سريعة</h3><button onClick={()=>navigate('/admin/reconciliation')} className="w-full rounded-2xl bg-[#008E92] py-3 font-black text-white">فتح المطابقة</button></div>
      </section>
    </main>
    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-xl font-black">تأكيد الإجراء</h3><button onClick={()=>setModal(null)} className="rounded-full bg-slate-100 p-2">✕</button></div>{modal.type==='reassign'&&<select value={targetRiderId} onChange={e=>setTargetRiderId(e.target.value)} className="mb-3 w-full rounded-2xl border p-3 font-bold"><option value="">اختر المندوب الجديد</option>{riders.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>}{modal.type==='edit_invoice'&&<div className="mb-3 rounded-2xl border border-amber-100 bg-amber-50 p-3"><p className="mb-2 text-sm font-black text-amber-800">تعديل رقم الفاتورة — متاح لمدير الفرع فقط</p><input value={newInvoiceNumber} onChange={e=>setNewInvoiceNumber(e.target.value)} className="w-full rounded-2xl border border-amber-200 p-3 text-right font-black outline-none focus:border-[#008E92]" placeholder="اكتب رقم الفاتورة الصحيح" /><p className="mt-2 text-xs font-bold text-amber-700">سيتم حفظ الرقم القديم والجديد واسم المدير وسبب التعديل في سجل المراجعة.</p></div>}<textarea value={reason} onChange={e=>setReason(e.target.value)} rows={4} placeholder="اكتب السبب بوضوح؛ سيتم حفظ اسم منفذ الإجراء ووقته." className="w-full rounded-2xl border p-3 font-bold outline-none focus:border-[#008E92]"/><button disabled={saving} onClick={applyAction} className="mt-4 w-full rounded-2xl bg-[#008E92] py-3 font-black text-white disabled:opacity-50">{saving?'جاري الحفظ...':'اعتماد الإجراء'}</button></div></div>}
  </div>
}
