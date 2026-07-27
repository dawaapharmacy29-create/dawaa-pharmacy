const fs = require('node:fs');
const path = require('node:path');

function patchFile(file, transforms) {
  const target = path.join(process.cwd(), file);
  let source = fs.readFileSync(target, 'utf8');
  let changed = false;
  for (const { before, after, label } of transforms) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) {
      console.warn(`[exceptional-followup] skipped ${label}: anchor not found`);
      continue;
    }
    source = source.replace(before, after);
    changed = true;
  }
  if (changed) fs.writeFileSync(target, source, 'utf8');
  return changed;
}

const modalChanged = patchFile('src/components/common/QuickFollowupModal.tsx', [
  {
    label: 'mode prop',
    before: `  defaultBranch,\n}: {\n  open: boolean;\n  onClose: () => void;\n  onCreated?: () => void;\n  defaultBranch?: string;\n}) {`,
    after: `  defaultBranch,\n  mode = 'doctor_request',\n}: {\n  open: boolean;\n  onClose: () => void;\n  onCreated?: () => void;\n  defaultBranch?: string;\n  mode?: 'doctor_request' | 'exceptional';\n}) {`,
  },
  {
    label: 'exceptional mode flag',
    before: `  const { user } = useAuth();\n  const managerView = canViewAllBranches(user);`,
    after: `  const { user } = useAuth();\n  const managerView = canViewAllBranches(user);\n  const exceptionalMode = mode === 'exceptional';`,
  },
  {
    label: 'dynamic initial values',
    before: `  const [priority, setPriority] = useState('مهم');\n  const [assignedDoctor, setAssignedDoctor] = useState('');\n  const [due, setDue] = useState('');\n  const [reason, setReason] = useState('طلب متابعة');`,
    after: `  const [priority, setPriority] = useState(exceptionalMode ? 'عاجل' : 'مهم');\n  const [assignedDoctor, setAssignedDoctor] = useState('');\n  const [due, setDue] = useState('');\n  const [reason, setReason] = useState(exceptionalMode ? 'متابعة استثنائية' : 'طلب متابعة');`,
  },
  {
    label: 'reset values',
    before: `    setPriority('مهم');\n    setAssignedDoctor('');`,
    after: `    setPriority(exceptionalMode ? 'عاجل' : 'مهم');\n    setAssignedDoctor('');`,
  },
  {
    label: 'reset reason',
    before: `    setReason('طلب متابعة');`,
    after: `    setReason(exceptionalMode ? 'متابعة استثنائية' : 'طلب متابعة');`,
  },
  {
    label: 'request type',
    before: `        requestType: 'doctor_requested_followup',`,
    after: `        requestType: exceptionalMode ? 'exceptional_followup' : 'doctor_requested_followup',`,
  },
  {
    label: 'notes source',
    before: `        notes: \`${'${cleanNote}${phoneStatusNote}'}\\nالمصدر: quick_followup_modal\`,`,
    after: `        notes: \`${'${cleanNote}${phoneStatusNote}'}\\nالمصدر: ${'${exceptionalMode ? \'exceptional_followup_modal\' : \'doctor_requested_followup_modal\'}'}\`,`,
  },
  {
    label: 'source value',
    before: `        source: 'doctor_requested_followup',`,
    after: `        source: exceptionalMode ? 'exceptional_followup' : 'doctor_requested_followup',`,
  },
  {
    label: 'success label',
    before: `       notify('success', 'تم إنشاء طلب المتابعة بنجاح');`,
    after: `       notify('success', exceptionalMode ? 'تم إنشاء المتابعة الاستثنائية بنجاح' : 'تم إنشاء طلب المتابعة بنجاح');`,
  },
  {
    label: 'modal title',
    before: `<h3 className="text-xl font-black text-white">إنشاء متابعة سريعة</h3>`,
    after: `<h3 className="text-xl font-black text-white">{exceptionalMode ? 'إضافة متابعة استثنائية' : 'طلب متابعة من دكتور'}</h3>`,
  },
  {
    label: 'modal subtitle',
    before: `              ستُسجل المتابعة على staff_id الخاص بحسابك وتظهر في «متابعاتي المطلوبة».`,
    after: `              {exceptionalMode\n                ? 'ستظهر فورًا ضمن «طلبات واستثنائية» مع تسجيل اسم منشئ الطلب والموعد والأولوية.'\n                : 'ستُسجل المتابعة على staff_id الخاص بحسابك وتظهر في «متابعاتي المطلوبة».'}`,
  },
]);

const workspaceChanged = patchFile('src/components/customerService/UnifiedCustomerServiceWorkspace.tsx', [
  {
    label: 'exceptional state',
    before: `  const [quickOpen, setQuickOpen] = useState(false);\n  const [excelImportOpen, setExcelImportOpen] = useState(false);`,
    after: `  const [quickOpen, setQuickOpen] = useState(false);\n  const [exceptionalOpen, setExceptionalOpen] = useState(false);\n  const [excelImportOpen, setExcelImportOpen] = useState(false);`,
  },
  {
    label: 'header actions',
    before: `            <button className="btn-primary" onClick={() => setQuickOpen(true)}>\n              إضافة متابعة\n            </button>`,
    after: `            <button className="btn-primary" onClick={() => setQuickOpen(true)}>\n              طلب متابعة من دكتور\n            </button>\n            <button\n              className="btn-secondary border-amber-400/40 bg-amber-500/10 text-amber-100"\n              onClick={() => setExceptionalOpen(true)}\n            >\n              متابعة استثنائية\n            </button>`,
  },
  {
    label: 'doctor modal mode',
    before: `      <QuickFollowupModal\n        open={quickOpen}\n        onClose={() => setQuickOpen(false)}\n        onCreated={() => void loadWorkspace()}\n        defaultBranch={branch}\n      />`,
    after: `      <QuickFollowupModal\n        open={quickOpen}\n        mode="doctor_request"\n        onClose={() => setQuickOpen(false)}\n        onCreated={() => {\n          setTab('doctor-requests');\n          setSourceFilter('doctor_request');\n          void loadWorkspace();\n        }}\n        defaultBranch={branch}\n      />\n      <QuickFollowupModal\n        open={exceptionalOpen}\n        mode="exceptional"\n        onClose={() => setExceptionalOpen(false)}\n        onCreated={() => {\n          setTab('doctor-requests');\n          setSourceFilter('doctor_request');\n          void loadWorkspace();\n        }}\n        defaultBranch={branch}\n      />`,
  },
]);

console.log(`Unified exceptional followup action checked. modal=${modalChanged} workspace=${workspaceChanged}`);
