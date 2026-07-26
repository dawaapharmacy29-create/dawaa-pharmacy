const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/pages/CustomerPointsLedger.tsx');
let source = fs.readFileSync(target, 'utf8');

const replaceOnce = (before, after) => {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing customer-points snippet: ${before}`);
  source = source.replace(before, after);
};

replaceOnce(
  "  const [customer, setCustomer] = useState<CustomerIdentity>(initialCustomer);",
  "  const [customer, setCustomer] = useState<CustomerIdentity>(initialCustomer);\n  const [customerConfirmed, setCustomerConfirmed] = useState(Boolean(initialCustomer.customer_id || initialCustomer.customer_code || initialCustomer.customer_phone));",
);

replaceOnce(
  "  const [adjustment, setAdjustment] = useState({ points_amount: '', transaction_type: 'credit' as 'credit' | 'debit' | 'correction', points_reason: '', notes: '' });",
  `  const [adjustment, setAdjustment] = useState({ points_amount: '', transaction_type: 'credit' as 'credit' | 'debit' | 'correction', points_reason: '', notes: '' });

  const normalizedCustomerPhone = String(customer.customer_phone || '').replace(/\\D/g, '');
  const validNewCustomerPhone = /^(?:01\\d{9}|1\\d{9}|201\\d{9})$/.test(normalizedCustomerPhone);
  const newCustomerReady = Boolean(customer.customer_name?.trim() && validNewCustomerPhone);
  const canUseCustomer = customerConfirmed || newCustomerReady;`,
);

replaceOnce(
  "        setCustomer(found[0]);\n        await loadCustomerData(found[0]);",
  "        setCustomer(found[0]);\n        setCustomerConfirmed(true);\n        await loadCustomerData(found[0]);",
);

replaceOnce(
  "        setCustomer((current) => ({ ...current, customer_phone: /^\\d/.test(query) ? query : current.customer_phone, customer_name: /^\\d/.test(query) ? current.customer_name : query }));\n        setRows([]); setSetting(null); setPreview(null);\n        toast.info('لم يتم العثور على العميل. يمكن تسجيله برقم الهاتف ثم إعداد نظام النقاط.');",
  `        const trimmed = query.trim();
        const digits = trimmed.replace(/\\D/g, '');
        const fullPhone = /^(?:01\\d{9}|1\\d{9}|201\\d{9})$/.test(digits);
        setCustomer({
          customer_id: null,
          customer_code: null,
          customer_phone: fullPhone ? trimmed : null,
          customer_name: fullPhone ? null : (/^\\D/.test(trimmed) ? trimmed : null),
          branch: user?.branch || BRANCHES[0],
        });
        setCustomerConfirmed(false);
        setRows([]); setSetting(null); setPreview(null);
        toast.info(fullPhone
          ? 'لم يتم العثور على العميل. اكتب اسمه ثم يمكن تسجيله كعميل جديد بهذا الهاتف.'
          : 'لم يتم العثور على العميل. لم يتم الاحتفاظ ببيانات العميل السابق؛ ابحث بكود أو هاتف صحيح.');`,
);

replaceOnce(
  "  const previewPeriod = async () => {\n    if (!periodStart || !periodEnd) return toast.error('حدد بداية ونهاية الفترة');",
  "  const previewPeriod = async () => {\n    if (!canUseCustomer) return toast.error('اختر عميلًا موجودًا أو اكتب اسمًا ورقم هاتف مصريًا صحيحًا أولًا.');\n    if (!periodStart || !periodEnd) return toast.error('حدد بداية ونهاية الفترة');",
);

replaceOnce(
  "  const saveSetting = async () => {\n    setSaving(true);",
  "  const saveSetting = async () => {\n    if (!canUseCustomer) return toast.error('لا يمكن حفظ إعداد النقاط قبل تأكيد العميل أو إدخال اسم ورقم هاتف صحيحين.');\n    setSaving(true);",
);

replaceOnce(
  "  const saveAdjustment = async () => {\n    setSaving(true);",
  "  const saveAdjustment = async () => {\n    if (!canUseCustomer) return toast.error('اختر العميل الصحيح قبل تعديل رصيد النقاط.');\n    setSaving(true);",
);

replaceOnce(
  "{matches.map((item) => <button key={`${item.customer_code || item.customer_phone}-${item.customer_name}`} className=\"btn-secondary text-xs\" onClick={() => { setCustomer(item); void loadCustomerData(item); }}>{item.customer_name || 'عميل'} - {item.customer_code || item.customer_phone}</button>)}",
  "{matches.map((item) => <button key={`${item.customer_code || item.customer_phone}-${item.customer_name}`} className=\"btn-secondary text-xs\" onClick={() => { setCustomer(item); setCustomerConfirmed(true); void loadCustomerData(item); }}>{item.customer_name || 'عميل'} - {item.customer_code || item.customer_phone}</button>)}",
);

replaceOnce(
  "      <input className=\"input-dark\" placeholder=\"اسم العميل\" value={customer.customer_name || ''} onChange={(e) => setCustomer((c) => ({...c,customer_name:e.target.value}))}/>\n      <input className=\"input-dark\" placeholder=\"الهاتف\" value={customer.customer_phone || ''} onChange={(e) => setCustomer((c) => ({...c,customer_phone:e.target.value}))}/>\n      <input className=\"input-dark\" placeholder=\"الكود\" value={customer.customer_code || ''} onChange={(e) => setCustomer((c) => ({...c,customer_code:e.target.value}))}/>",
  `      <input className="input-dark" placeholder="اسم العميل" value={customer.customer_name || ''} onChange={(e) => { setCustomerConfirmed(false); setCustomer((c) => ({...c,customer_name:e.target.value})); }}/>
      <input className="input-dark" placeholder="الهاتف" value={customer.customer_phone || ''} onChange={(e) => { setCustomerConfirmed(false); setCustomer((c) => ({...c,customer_phone:e.target.value})); }}/>
      <input className="input-dark" placeholder="الكود" value={customer.customer_code || ''} onChange={(e) => { setCustomerConfirmed(false); setCustomer((c) => ({...c,customer_code:e.target.value})); }}/>` ,
);

replaceOnce(
  "    </section>\n\n    <section className=\"grid gap-3 md:grid-cols-2 xl:grid-cols-4\">",
  `      {!canUseCustomer ? <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm font-bold text-amber-100 lg:col-span-4">لم يتم تأكيد هوية العميل. اختر نتيجة بحث صحيحة، أو أدخل اسم العميل مع رقم هاتف مصري صحيح لتسجيل عميل جديد. لن يتم حفظ أي نقاط قبل التأكيد.</div> : null}
    </section>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">`,
);

fs.writeFileSync(target, source, 'utf8');
console.log('Customer points search safety applied: stale identities cleared and unconfirmed saves blocked.');
