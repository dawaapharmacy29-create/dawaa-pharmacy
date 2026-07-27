const fs = require('node:fs');
const path = require('node:path');

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return { source, changed: false };
  if (!source.includes(before)) {
    console.warn(`[exceptional-followups] skipped ${label}: anchor not found`);
    return { source, changed: false };
  }
  return { source: source.replace(before, after), changed: true };
};

let changed = false;

const modalPath = path.join(process.cwd(), 'src/components/common/QuickFollowupModal.tsx');
let modal = fs.readFileSync(modalPath, 'utf8');

let result = replaceOnce(
  modal,
  "  defaultBranch,\n}: {\n  open: boolean;\n  onClose: () => void;\n  onCreated?: () => void;\n  defaultBranch?: string;\n}) {",
  "  defaultBranch,\n  mode = 'doctor_request',\n}: {\n  open: boolean;\n  onClose: () => void;\n  onCreated?: () => void;\n  defaultBranch?: string;\n  mode?: 'doctor_request' | 'exceptional';\n}) {",
  'modal mode prop'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "  const [reason, setReason] = useState('طلب متابعة');",
  "  const [reason, setReason] = useState(mode === 'exceptional' ? 'متابعة استثنائية' : 'طلب متابعة');",
  'mode default reason'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "  useEffect(() => {\n    if (!open) return;\n    setBranch(",
  "  useEffect(() => {\n    if (!open) return;\n    setReason(mode === 'exceptional' ? 'متابعة استثنائية' : 'طلب متابعة');\n    setPriority(mode === 'exceptional' ? 'عاجل' : 'مهم');\n    setBranch(",
  'mode reset on open'
);
modal = result.source; changed ||= result.changed;

modal = modal.replace(
  "  }, [defaultBranch, open, user?.branch]);",
  "  }, [defaultBranch, mode, open, user?.branch]);"
);

result = replaceOnce(
  modal,
  "    setPriority('مهم');\n    setAssignedDoctor('');",
  "    setPriority(mode === 'exceptional' ? 'عاجل' : 'مهم');\n    setAssignedDoctor('');",
  'mode reset priority'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "    setReason('طلب متابعة');",
  "    setReason(mode === 'exceptional' ? 'متابعة استثنائية' : 'طلب متابعة');",
  'mode reset reason'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "        requestType: 'doctor_requested_followup',\n        followupReason: reason || cleanNote,",
  "        requestType: mode === 'exceptional' ? 'exceptional_followup' : 'doctor_requested_followup',\n        followupReason: reason || (mode === 'exceptional' ? 'متابعة استثنائية' : cleanNote),",
  'request type'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "        notes: `${cleanNote}${phoneStatusNote}\\nالمصدر: quick_followup_modal`,",
  "        notes: `${cleanNote}${phoneStatusNote}\\nالمصدر: ${mode === 'exceptional' ? 'customer_service_exceptional_followup' : 'doctor_requested_followup'}`,",
  'request source note'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "        source: 'doctor_requested_followup',",
  "        source: mode === 'exceptional' ? 'customer_service_exceptional_followup' : 'doctor_requested_followup',",
  'request source'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "      notify('success', 'تم إنشاء طلب المتابعة بنجاح');",
  "      notify('success', mode === 'exceptional' ? 'تم إنشاء المتابعة الاستثنائية بنجاح' : 'تم إنشاء طلب المتابعة بنجاح');",
  'success message'
);
modal = result.source; changed ||= result.changed;

result = replaceOnce(
  modal,
  "            <h3 className=\"text-xl font-black text-white\">إنشاء متابعة سريعة</h3>\n            <p className=\"mt-1 text-sm text-slate-400\">\n              ستُسجل المتابعة على staff_id الخاص بحسابك وتظهر في «متابعاتي المطلوبة».\n            </p>",
  "            <h3 className=\"text-xl font-black text-white\">{mode === 'exceptional' ? 'إضافة متابعة استثنائية' : 'إنشاء طلب متابعة من دكتور'}</h3>\n            <p className=\"mt-1 text-sm text-slate-400\">\n              {mode === 'exceptional'\n                ? 'تُرسل فورًا لمسؤول خدمة العملاء بالفرع مع السبب والأولوية والموعد، وتظهر في المتابعات الاستثنائية.'\n                : 'ستُسجل المتابعة باسم حساب الدكتور وتظهر في «طلبات المتابعة» و«متابعاتي المطلوبة».'}\n            </p>",
  'modal heading'
);
modal = result.source; changed ||= result.changed;

if (changed) fs.writeFileSync(modalPath, modal, 'utf8');

const pagePath = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
let page = fs.readFileSync(pagePath, 'utf8');
let pageChanged = false;

result = replaceOnce(
  page,
  "  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);",
  "  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);\n  const [quickFollowupMode, setQuickFollowupMode] = useState<'doctor_request' | 'exceptional'>('doctor_request');",
  'page mode state'
);
page = result.source; pageChanged ||= result.changed;

result = replaceOnce(
  page,
  "    setQuickFollowupOpen(true);\n    setActiveTabState('requests');",
  "    setQuickFollowupMode('doctor_request');\n    setQuickFollowupOpen(true);\n    setActiveTabState('requests');",
  'url requested mode'
);
page = result.source; pageChanged ||= result.changed;

result = replaceOnce(
  page,
  "      <QuickFollowupModal\n        open={quickFollowupOpen}",
  "      <div className=\"fixed bottom-5 left-5 z-40 flex flex-col gap-2 sm:flex-row\" dir=\"rtl\">\n        <button\n          type=\"button\"\n          className=\"rounded-2xl border border-amber-300/40 bg-amber-500 px-4 py-3 text-sm font-black text-slate-950 shadow-2xl hover:bg-amber-400\"\n          onClick={() => { setQuickFollowupMode('exceptional'); setQuickFollowupOpen(true); }}\n        >\n          <Plus className=\"ml-1 inline h-4 w-4\" /> متابعة استثنائية\n        </button>\n        <button\n          type=\"button\"\n          className=\"rounded-2xl border border-cyan-300/40 bg-cyan-600 px-4 py-3 text-sm font-black text-white shadow-2xl hover:bg-cyan-500\"\n          onClick={() => { setQuickFollowupMode('doctor_request'); setQuickFollowupOpen(true); }}\n        >\n          <UserCheck className=\"ml-1 inline h-4 w-4\" /> طلب متابعة من دكتور\n        </button>\n      </div>\n      <QuickFollowupModal\n        mode={quickFollowupMode}\n        open={quickFollowupOpen}",
  'visible action buttons'
);
page = result.source; pageChanged ||= result.changed;

if (pageChanged) fs.writeFileSync(pagePath, page, 'utf8');

console.log(changed || pageChanged
  ? 'Customer service exceptional followups and doctor requests applied.'
  : 'Customer service exceptional followups already applied; no changes needed.');
