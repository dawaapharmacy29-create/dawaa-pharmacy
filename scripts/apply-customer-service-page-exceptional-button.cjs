const fs = require('node:fs');
const path = require('node:path');

const pageFile = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
const modalFile = path.join(process.cwd(), 'src/components/common/QuickFollowupModal.tsx');
let page = fs.readFileSync(pageFile, 'utf8');
let modal = fs.readFileSync(modalFile, 'utf8');
let pageChanged = false;
let modalChanged = false;

function replacePage(pattern, replacement, label) {
  const next = page.replace(pattern, replacement);
  if (next !== page) {
    page = next;
    pageChanged = true;
    console.log(`[customer-service-actions] applied ${label}`);
  }
}

function replaceModal(pattern, replacement, label) {
  const next = modal.replace(pattern, replacement);
  if (next !== modal) {
    modal = next;
    modalChanged = true;
    console.log(`[customer-service-actions] applied ${label}`);
  }
}

// 1) State for the exceptional modal on the real /customer-service page.
if (!page.includes('const [exceptionalFollowupOpen, setExceptionalFollowupOpen]')) {
  replacePage(
    /(const \[quickFollowupOpen, setQuickFollowupOpen\] = useState\(false\);)/,
    `$1\n  const [exceptionalFollowupOpen, setExceptionalFollowupOpen] = useState(false);`,
    'exceptional modal state'
  );
}

// 2) Always-visible actions inside the actual page body.
if (!page.includes('data-section="customer-service-followup-actions"')) {
  const actionBar = `      <section data-section="customer-service-followup-actions" className="rounded-2xl border border-cyan-400/25 bg-slate-900/80 p-4 shadow-lg">\n        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">\n          <div>\n            <h2 className="font-black text-white">إضافة متابعة جديدة</h2>\n            <p className="mt-1 text-xs font-bold text-slate-400">يمكن اختيار عميل من قاعدة العملاء أو كتابة بيانات عميل غير موجود في قائمة اليوم.</p>\n          </div>\n          <div className="flex flex-wrap gap-2">\n            <button\n              type="button"\n              data-action="open-quick-followup"\n              className="btn-primary"\n              onClick={() => setQuickFollowupOpen(true)}\n            >\n              <Plus className="ml-1 inline h-4 w-4" /> متابعة سريعة\n            </button>\n            <button\n              type="button"\n              data-action="open-exceptional-followup"\n              className="rounded-xl border-2 border-amber-200 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 shadow-lg transition hover:bg-amber-400"\n              onClick={() => setExceptionalFollowupOpen(true)}\n            >\n              <Sparkles className="ml-1 inline h-4 w-4" /> إضافة متابعة استثنائية\n            </button>\n          </div>\n        </div>\n      </section>\n\n`;
  replacePage(/(\s*\{error && \()/, `\n${actionBar}$1`, 'visible in-page action bar');
}

// 3) Render both modals directly in the real page. Replace the existing quick modal block once.
if (!page.includes('open={exceptionalFollowupOpen}')) {
  const quickModalPattern = /\s*<QuickFollowupModal\s+open=\{quickFollowupOpen\}[\s\S]*?\/\>/;
  const quickMatch = page.match(quickModalPattern);
  if (quickMatch) {
    const bothModals = `\n      <QuickFollowupModal\n        open={quickFollowupOpen}\n        mode="doctor_request"\n        onClose={closeQuickFollowup}\n        onCreated={() => {\n          setQuickFollowupOpen(false);\n          void load(true);\n          setActiveTab('requests');\n        }}\n        defaultBranch={branch === ALL_FILTER ? serviceBranchOverride || userBranch : branch}\n      />\n      <QuickFollowupModal\n        open={exceptionalFollowupOpen}\n        mode="exceptional"\n        onClose={() => setExceptionalFollowupOpen(false)}\n        onCreated={() => {\n          setExceptionalFollowupOpen(false);\n          void load(true);\n          setActiveTab('requests');\n        }}\n        defaultBranch={branch === ALL_FILTER ? serviceBranchOverride || userBranch : branch}\n      />`;
    replacePage(quickModalPattern, bothModals, 'working quick and exceptional modals');
  }
}

// 4) Make the shared modal explicitly support both modes.
if (!modal.includes("mode = 'doctor_request'")) {
  replaceModal(
    /export default function QuickFollowupModal\(\{\s*open,\s*onClose,\s*onCreated,\s*defaultBranch,\s*\}: \{\s*open: boolean;\s*onClose: \(\) => void;\s*onCreated\?: \(\) => void;\s*defaultBranch\?: string;\s*\}\)/,
    `export default function QuickFollowupModal({\n  open,\n  onClose,\n  onCreated,\n  defaultBranch,\n  mode = 'doctor_request',\n}: {\n  open: boolean;\n  onClose: () => void;\n  onCreated?: () => void;\n  defaultBranch?: string;\n  mode?: 'doctor_request' | 'exceptional';\n})`,
    'modal mode prop'
  );
}

if (!modal.includes('const isExceptional = mode ===')) {
  replaceModal(
    /(\s*const \{ user \} = useAuth\(\);)/,
    `$1\n  const isExceptional = mode === 'exceptional';`,
    'exceptional mode flag'
  );
}

// Reset mode-specific defaults every time the modal opens.
if (!modal.includes('setPriority(isExceptional')) {
  replaceModal(
    /(if \(!open\) return;\s*setBranch\([\s\S]*?\);\s*setDue\([\s\S]*?\);)/,
    `$1\n    setPriority(isExceptional ? 'عاجل' : 'مهم');\n    setReason(isExceptional ? 'متابعة استثنائية' : 'طلب متابعة');`,
    'mode-specific defaults'
  );
  replaceModal(/\}, \[defaultBranch, open, user\?\.branch\]\);/, `}, [defaultBranch, isExceptional, open, user?.branch]);`, 'mode dependency');
}

replaceModal(
  /requestType: 'doctor_requested_followup',/g,
  `requestType: isExceptional ? 'exceptional_followup' : 'doctor_requested_followup',`,
  'request type by mode'
);
replaceModal(
  /notes: `\$\{cleanNote\}\$\{phoneStatusNote\}\\nالمصدر: quick_followup_modal`,/g,
  `notes: \`${'${cleanNote}${phoneStatusNote}'}\\nالمصدر: ${'${isExceptional ? \'exceptional_followup_modal\' : \'quick_followup_modal\'}'}\`,`,
  'source note by mode'
);
replaceModal(
  /source: 'doctor_requested_followup',/g,
  `source: isExceptional ? 'exceptional_followup' : 'doctor_requested_followup',`,
  'source by mode'
);
replaceModal(
  /notify\('success', 'تم إنشاء طلب المتابعة بنجاح'\);/g,
  `notify('success', isExceptional ? 'تم إنشاء المتابعة الاستثنائية بنجاح' : 'تم إنشاء طلب المتابعة بنجاح');`,
  'success message by mode'
);
replaceModal(
  /<h3 className="text-xl font-black text-white">إنشاء متابعة سريعة<\/h3>/g,
  `<h3 className="text-xl font-black text-white">{isExceptional ? 'إضافة متابعة استثنائية' : 'إنشاء متابعة سريعة'}</h3>`,
  'dynamic modal title'
);
replaceModal(
  /ستُسجل المتابعة على staff_id الخاص بحسابك وتظهر في «متابعاتي المطلوبة»\./g,
  `{isExceptional\n                ? 'تُضاف للعميل حتى لو لم يكن موجودًا في قائمة اليوم، وتظهر ضمن طلبات المتابعة الاستثنائية.'\n                : 'ستُسجل المتابعة باسم حسابك وتظهر في «متابعاتي المطلوبة».'}`,
  'dynamic modal subtitle'
);

// Hard verification: do not deploy another version where either action is missing.
const checks = [
  ['quick action', page.includes('data-action="open-quick-followup"')],
  ['exceptional action', page.includes('data-action="open-exceptional-followup"')],
  ['quick modal', page.includes('open={quickFollowupOpen}')],
  ['exceptional modal', page.includes('open={exceptionalFollowupOpen}')],
  ['modal mode support', modal.includes("mode?: 'doctor_request' | 'exceptional'")],
];
for (const [label, ok] of checks) {
  if (!ok) throw new Error(`[customer-service-actions] verification failed: ${label}`);
}

if (pageChanged) fs.writeFileSync(pageFile, page, 'utf8');
if (modalChanged) fs.writeFileSync(modalFile, modal, 'utf8');
console.log(`Customer service quick/exceptional actions verified. pageChanged=${pageChanged} modalChanged=${modalChanged}`);
