const fs = require('fs');

const file = 'src/pages/CustomerRequests.tsx';
let src = fs.readFileSync(file, 'utf8');

const originalHeader = "<CommandHeader summary={summary} onCreate={() => setShowCreate((value) => !value)} onRefresh={load} loading={loading} onKpi={(filter) => { setWorkspaceTab('requests'); setQuickFilter(filter); setStatusFilter('all'); }} />";
const nextHeader = "<CommandHeader summary={summary} onCreate={() => setShowCreate(true)} onRefresh={load} loading={loading} onKpi={(filter) => { setWorkspaceTab('requests'); setQuickFilter(filter); setStatusFilter('all'); }} />";
if (!src.includes(originalHeader)) throw new Error('CommandHeader create trigger not found');
src = src.replace(originalHeader, nextHeader);

const originalInline = "{showCreate && <CreateRequestPanel doctors={doctors} user={user} onCreated={async (request) => { setShowCreate(false); setSelected(request); setQuickFilter('today'); setPage(1); toast.success('تم تسجيل طلب العميل'); await load(); }} />}";
const modalInline = String.raw`{showCreate && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm md:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}>
          <section className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-cyan-400/30 bg-[#071526] shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-700 bg-[#0b1f36]/95 px-4 py-4 backdrop-blur md:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xl font-black text-white"><PackagePlus size={21} className="text-cyan-300" /> تسجيل طلب عميل جديد</div>
                <p className="mt-1 text-xs font-bold text-slate-400">سجّل العميل والصنف والأولوية والتفاصيل في خطوة واحدة، ثم يبدأ الطلب مباشرة في دورة المتابعة.</p>
              </div>
              <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-600 bg-slate-900 text-slate-300 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200" onClick={() => setShowCreate(false)} aria-label="إغلاق نافذة تسجيل الطلب"><X size={19} /></button>
            </header>
            <div className="overflow-y-auto p-3 md:p-5">
              <CreateRequestPanel doctors={doctors} user={user} onCancel={() => setShowCreate(false)} onCreated={async (request) => { setShowCreate(false); setSelected(request); setWorkspaceTab('requests'); setQuickFilter('today'); setStatusFilter('all'); setPage(1); setShowDetails(true); toast.success('تم تسجيل طلب العميل وفتح تفاصيله'); await load(); }} />
            </div>
          </section>
        </div>
      )}`;
if (!src.includes(originalInline)) throw new Error('Inline create panel not found');
src = src.replace(originalInline, modalInline);

const start = src.indexOf('function CreateRequestPanel(');
const end = src.indexOf('\nfunction InfoCard(', start);
if (start < 0 || end < 0) throw new Error('CreateRequestPanel block not found');

const panel = String.raw`function CreateRequestPanel({ doctors, user, onCreated, onCancel }: { doctors: StaffOption[]; user: { id?: string; name?: string } | null; onCreated: (request: CustomerRequest) => void | Promise<void>; onCancel: () => void }) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [image, setImage] = useState({ publicUrl: '', path: '' });
  const [quantity, setQuantity] = useState(1);
  const [urgency, setUrgency] = useState('normal');
  const [requestType, setRequestType] = useState('missing_medicine');
  const [requestChannel, setRequestChannel] = useState('داخل الصيدلية');
  const [doctorId, setDoctorId] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [supplierHint, setSupplierHint] = useState('');
  const [neededByDate, setNeededByDate] = useState('');
  const [expectedDays, setExpectedDays] = useState(1);
  const [saving, setSaving] = useState(false);
  const selectedDoctor = doctors.find((item) => item.id === doctorId);
  const resolvedBranch = selectedCustomer?.branch || selectedDoctor?.branch || '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer?.name) return toast.error('اختر العميل أولًا');
    if (!selectedProduct?.id) return toast.error('اختر الصنف بالكود أو أضف صنفًا جديدًا');
    setSaving(true);
    try {
      const created = await createCustomerRequest({ customer_id: selectedCustomer.id, customer_code: selectedCustomer.code, customer_name: selectedCustomer.name, customer_phone: selectedCustomer.phone, branch: selectedCustomer.branch || selectedDoctor?.branch || null, medicine_name: selectedProduct.name, medicine_image_url: image.publicUrl || null, item_image_url: image.publicUrl || null, item_image_path: image.path || null, quantity, urgency, request_type: requestType, source_request_channel: requestChannel, doctor_id: selectedDoctor?.id || null, doctor_name: selectedDoctor?.name || null, doctor_notes: doctorNotes || null, supplier_hint: supplierHint || null, needed_by_date: neededByDate || null, expected_fulfillment_days: expectedDays, created_by: user?.id, created_by_name: user?.name });
      await linkCustomerRequestProduct(created.id, selectedProduct.id);
      await onCreated(created);
    } catch (error) {
      toast.error(` + "`" + `تعذر تسجيل الطلب: ${'${'}(error as Error).message}` + "`" + `);
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-cyan-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">1. العميل</h3><p className="mt-1 text-[11px] font-bold text-slate-500">ابحث بالاسم أو كود العميل أو الهاتف، ويمكن إنشاء عميل جديد عند الحاجة.</p></div><UsersRound size={19} className="text-cyan-300" /></div>
          <CustomerSmartSearch value={selectedCustomer} onSelect={setSelectedCustomer} placeholder="ابحث باسم العميل أو الكود أو الهاتف" disabled={saving} allowCreate />
          {selectedCustomer && <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4"><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">العميل</span><strong className="mt-1 block truncate text-white">{selectedCustomer.name}</strong></div><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">الكود</span><strong className="mt-1 block text-white">{selectedCustomer.code || '—'}</strong></div><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">الهاتف</span><strong className="mt-1 block text-white">{displayEgyptianPhone(selectedCustomer.phone || '') || '—'}</strong></div><div className="rounded-xl bg-slate-950/55 p-2"><span className="block text-slate-500">الفرع</span><strong className="mt-1 block text-cyan-200">{selectedCustomer.branch || 'يُحدد من المسجل'}</strong></div></div>}
        </section>

        <section className="rounded-2xl border border-emerald-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">2. الصنف والكمية</h3><p className="mt-1 text-[11px] font-bold text-slate-500">اختيار الصنف من الكتالوج يضمن الربط الصحيح ويمنع اختلاف الأسماء.</p></div><PackageSearch size={19} className="text-emerald-300" /></div>
          <ProductSmartSearch value={selectedProduct} onSelect={setSelectedProduct} disabled={saving} />
          <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs font-black text-slate-300">الكمية<input className="input-dark mt-1" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 1))} /></label><label className="text-xs font-black text-slate-300">أولوية الطلب<select className="input-dark mt-1" value={urgency} onChange={(e) => setUrgency(e.target.value)}><option value="normal">عادي</option><option value="high">مهم</option><option value="urgent">عاجل</option></select></label><label className="text-xs font-black text-slate-300">نوع الطلب<select className="input-dark mt-1" value={requestType} onChange={(e) => setRequestType(e.target.value)}><option value="missing_medicine">صنف ناقص</option><option value="normal_request">طلب عادي</option><option value="urgent_request">طلب عاجل</option><option value="inquiry">استفسار</option></select></label></div>
        </section>

        <section className="rounded-2xl border border-violet-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">3. طريقة الطلب والمسئول</h3><p className="mt-1 text-[11px] font-bold text-slate-500">سجل قناة التواصل ومن سجّل الطلب وأي مصدر محتمل للتوفير.</p></div><UserRound size={19} className="text-violet-300" /></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><label className="text-xs font-black text-slate-300">قناة الطلب<select className="input-dark mt-1" value={requestChannel} onChange={(e) => setRequestChannel(e.target.value)}><option value="داخل الصيدلية">داخل الصيدلية</option><option value="واتساب">واتساب</option><option value="مكالمة هاتفية">مكالمة هاتفية</option></select></label><label className="text-xs font-black text-slate-300">الدكتور/الموظف المسجل<select className="input-dark mt-1" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">اختر المسجل</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} - {doctor.branch || ''}</option>)}</select></label><label className="text-xs font-black text-slate-300">مورد أو مصدر محتمل<input className="input-dark mt-1" value={supplierHint} onChange={(e) => setSupplierHint(e.target.value)} placeholder="اختياري" /></label><label className="text-xs font-black text-slate-300">مطلوب قبل<input type="date" className="input-dark mt-1" value={neededByDate} onChange={(e) => setNeededByDate(e.target.value)} /></label><label className="text-xs font-black text-slate-300">مدة التوفير المتوقعة بالأيام<input type="number" min={0} className="input-dark mt-1" value={expectedDays} onChange={(e) => setExpectedDays(Number(e.target.value || 0))} /></label><div className="rounded-xl border border-slate-700 bg-slate-950/45 p-3"><span className="block text-[10px] font-bold text-slate-500">الفرع المتوقع</span><strong className="mt-1 block text-sm text-cyan-200">{resolvedBranch || 'سيُحدد حسب العميل/المسجل'}</strong></div></div>
        </section>

        <section className="rounded-2xl border border-amber-400/20 bg-[#102640] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">4. الملاحظات والصورة</h3><p className="mt-1 text-[11px] font-bold text-slate-500">اكتب أي تفاصيل تساعد المشتريات أو خدمة العملاء على تنفيذ الطلب بدون رجوع إضافي.</p></div><MessageCircle size={19} className="text-amber-300" /></div>
          <textarea className="input-dark min-h-24" value={doctorNotes} onChange={(e) => setDoctorNotes(e.target.value)} placeholder="مثال: العميل يحتاج نفس الشركة / يقبل بديل / موعد مهم / ملاحظة عن التركيز أو الشكل..." />
          <div className="mt-3"><ImageUploadBox bucket="customer-request-images" folder="customer-requests" label="صورة الصنف أو الروشتة (اختياري)" valueUrl={image.publicUrl} valuePath={image.path} onUploaded={setImage} disabled={saving} /></div>
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-cyan-500/[0.10] to-slate-950/50 p-4 xl:sticky xl:top-0">
        <div className="flex items-center gap-2 text-sm font-black text-white"><CheckCircle2 size={18} className="text-cyan-300" /> مراجعة سريعة قبل الحفظ</div>
        <div className="mt-4 space-y-2 text-xs"><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">العميل</span><strong className="truncate text-white">{selectedCustomer?.name || 'لم يتم الاختيار'}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الصنف</span><strong className="truncate text-white">{selectedProduct?.name || 'لم يتم الاختيار'}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الكمية</span><strong className="num text-white">{quantity}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الأولوية</span><strong className={urgency === 'urgent' ? 'text-red-300' : urgency === 'high' ? 'text-amber-300' : 'text-emerald-300'}>{urgency === 'urgent' ? 'عاجل' : urgency === 'high' ? 'مهم' : 'عادي'}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">القناة</span><strong className="text-white">{requestChannel}</strong></div><div className="flex justify-between gap-3 rounded-xl bg-slate-950/45 p-2"><span className="text-slate-500">الفرع</span><strong className="text-cyan-200">{resolvedBranch || '—'}</strong></div></div>
        <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.07] p-3 text-[11px] font-bold leading-6 text-cyan-100">بعد الحفظ هيتفتح الطلب الجديد مباشرة في شاشة التفاصيل، ويبدأ بحالة تسجيل جديدة داخل دورة المتابعة.</div>
      </aside>
    </div>

    <footer className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 rounded-2xl border border-slate-700 bg-[#0b1f36]/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <button type="button" className="btn-secondary min-w-28" onClick={onCancel} disabled={saving}>إلغاء</button>
      <div className="flex flex-col gap-2 sm:flex-row"><span className="self-center text-[11px] font-bold text-slate-500">يلزم اختيار العميل والصنف قبل الحفظ</span><button className="btn-primary flex min-w-44 items-center justify-center gap-2" disabled={saving || !selectedCustomer?.name || !selectedProduct?.id}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ وفتح الطلب</button></div>
    </footer>
  </form>;
}
`;

src = src.slice(0, start) + panel + src.slice(end);
fs.writeFileSync(file, src);
console.log('Applied customer request create modal V9');
