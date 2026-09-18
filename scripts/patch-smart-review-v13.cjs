const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v13] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v13] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v13] ${label}: applied`);
}

patch(
  'customer search loading state',
  `  const [smartManualCustomer, setSmartManualCustomer] = useState(false);`,
  `  const [smartManualCustomer, setSmartManualCustomer] = useState(false);\n  const [smartCustomerSearching, setSmartCustomerSearching] = useState(false);`
);

patch(
  'live customer search effect',
  `  const countPreviousReviewErrors = async () => {`,
  `  useEffect(() => {\n    if (!smartReviewEnabled || smartManualCustomer) return;\n    const q = custSearch.trim();\n    if (q.length < 2) {\n      setCustHits([]);\n      setCustSearched(false);\n      setSmartCustomerSearching(false);\n      return;\n    }\n    if (form.customerName && q === form.customerName.trim()) {\n      setCustHits([]);\n      setCustSearched(false);\n      setSmartCustomerSearching(false);\n      return;\n    }\n    const timer = window.setTimeout(async () => {\n      setSmartCustomerSearching(true);\n      try {\n        const res = await getCustomers({ search: q, limit: 8, offset: 0 });\n        setCustHits(res.customers);\n        setCustSearched(true);\n      } catch {\n        setCustHits([]);\n        setCustSearched(true);\n      } finally {\n        setSmartCustomerSearching(false);\n      }\n    }, 260);\n    return () => window.clearTimeout(timer);\n  }, [custSearch, form.customerName, smartManualCustomer, smartReviewEnabled]);\n\n  const countPreviousReviewErrors = async () => {`
);

patch(
  'search field visual polish and reset stale selection',
  `                        className="input-dark min-h-12 w-full pr-3 pl-16 text-sm"\n                        value={custSearch}\n                        onChange={(e) => {\n                          setCustSearch(e.target.value);\n                          setCustSearched(false);\n                          if (e.target.value.trim().length < 2) setCustHits([]);\n                        }}\n                        onKeyDown={(e) => {\n                          if (e.key === 'Enter') {\n                            e.preventDefault();\n                            void loadCustomersHits();\n                          }\n                        }}\n                        placeholder="اسم / كود / موبايل"`,
  `                        className="input-dark min-h-14 w-full rounded-xl pr-11 pl-12 text-sm font-bold"\n                        value={custSearch}\n                        onChange={(e) => {\n                          const value = e.target.value;\n                          setCustSearch(value);\n                          setCustSearched(false);\n                          if (form.customerName && value !== form.customerName) {\n                            setForm((f) => ({ ...f, customerId: '', customerCode: '', customerName: '', customerPhone: '', customerType: '' }));\n                          }\n                          if (value.trim().length < 2) setCustHits([]);\n                        }}\n                        placeholder="ابحث بالاسم أو الكود أو رقم الموبايل"`
);

patch(
  'replace tiny search button with icons and live state',
  `                      <button\n                        type="button"\n                        onClick={() => void loadCustomersHits()}\n                        className="absolute left-1 top-1/2 -translate-y-1/2 rounded-lg border border-slate-600 px-2 py-1 text-[10px] font-black text-slate-200 hover:bg-slate-800"\n                      >\n                        بحث\n                      </button>`,
  `                      <Search className="pointer-events-none absolute right-3 top-7 h-4 w-4 -translate-y-1/2 text-cyan-300" />\n                      {custSearch ? (\n                        <button\n                          type="button"\n                          title="مسح البحث"\n                          onClick={() => {\n                            setCustSearch('');\n                            setCustHits([]);\n                            setCustSearched(false);\n                            setForm((f) => ({ ...f, customerId: '', customerCode: '', customerName: '', customerPhone: '', customerType: '' }));\n                          }}\n                          className="absolute left-3 top-7 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"\n                        >\n                          <X size={15} />\n                        </button>\n                      ) : null}\n                      {smartCustomerSearching ? (\n                        <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-cyan-300">\n                          <RefreshCw size={11} className="animate-spin" /> جاري البحث...\n                        </div>\n                      ) : null}`
);

patch(
  'selected customer card polish',
  `                        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-2 py-1 text-[10px]">`,
  `                        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-[11px] shadow-sm">`
);

patch(
  'selected customer change button polish',
  `                            className="text-slate-400 hover:text-white"\n                          >\n                            تغيير\n                          </button>`,
  `                            className="shrink-0 rounded-lg border border-slate-600 bg-slate-900/70 px-2.5 py-1.5 text-[10px] font-black text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-200"\n                          >\n                            تغيير العميل\n                          </button>`
);

patch(
  'customer dropdown polish',
  `                        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-600 bg-[#0b1728] p-1 shadow-2xl">`,
  `                        <div className="absolute z-40 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-cyan-400/20 bg-[#091522] p-1.5 shadow-2xl shadow-black/40">`
);

patch(
  'customer result row polish',
  `                              className="block w-full rounded-lg px-2 py-2 text-right hover:bg-slate-800"`,
  `                              className="block w-full rounded-xl border border-transparent px-3 py-2.5 text-right transition hover:border-cyan-400/20 hover:bg-cyan-500/10"`
);

patch(
  'new customer action prominence',
  `                      className="text-[10px] font-black text-cyan-300 hover:text-cyan-200"`,
  `                      className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-black text-cyan-200 transition hover:bg-cyan-500/20"`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v13] polished live customer lookup applied successfully');
require('./patch-whatsapp-conversation-analyzer-v1.cjs');
