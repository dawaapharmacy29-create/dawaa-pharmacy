const fs = require('node:fs');
const path = require('node:path');

const pageFile = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
const modalFile = path.join(process.cwd(), 'src/components/common/QuickFollowupModal.tsx');
let page = fs.readFileSync(pageFile, 'utf8');
let modal = fs.readFileSync(modalFile, 'utf8');
let pageChanged = false;
let modalChanged = false;

function pageReplace(before, after, label) {
  if (page.includes(after)) return;
  if (!page.includes(before)) {
    console.warn(`[customer-service-actions] page anchor skipped: ${label}`);
    return;
  }
  page = page.replace(before, after);
  pageChanged = true;
  console.log(`[customer-service-actions] applied ${label}`);
}

function modalReplace(before, after, label) {
  if (modal.includes(after)) return;
  if (!modal.includes(before)) {
    console.warn(`[customer-service-actions] modal anchor skipped: ${label}`);
    return;
  }
  modal = modal.replace(before, after);
  modalChanged = true;
  console.log(`[customer-service-actions] applied ${label}`);
}

pageReplace(
  "  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);",
  "  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);\n  const [exceptionalFollowupOpen, setExceptionalFollowupOpen] = useState(false);",
  'exceptional modal state'
);

if (!page.includes('data-section="customer-service-followup-actions"')) {
  const anchor = "      {error && (";
  const actionBar = `      <section data-section="customer-service-followup-actions" className="rounded-2xl border border-cyan-400/25 bg-slate-900/80 p-4 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black text-white">إضافة متابعة جديدة</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">يمكن اختيار عميل من قاعدة العملاء أو كتابة بيانات عميل غير موجود في قائمة اليوم.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-action="open-quick-followup" className="btn-primary" onClick={() => setQuickFollowupOpen(true)}>
              <Plus className="ml-1 inline h-4 w-4" /> متابعة سريعة
            </button>
            <button type="button" data-action="open-exceptional-followup" className="rounded-xl border-2 border-amber-200 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 shadow-lg transition hover:bg-amber-400" onClick={() => setExceptionalFollowupOpen(true)}>
              <Sparkles className="ml-1 inline h-4 w-4" /> إضافة متابعة استثنائية
            </button>
          </div>
        </div>
      </section>

`;
  pageReplace(anchor, `${actionBar}${anchor}`, 'visible action bar');
}

if (!page.includes('open={exceptionalFollowupOpen}')) {
  const oldQuickModal = `      <QuickFollowupModal
        open={quickFollowupOpen}
        onClose={closeQuickFollowup}
        onCreated={() => {
          void load(true);
          setActiveTab('requests');
        }}
      />`;
  const bothModals = `      <QuickFollowupModal
        open={quickFollowupOpen}
        mode="doctor_request"
        onClose={closeQuickFollowup}
        onCreated={() => {
          setQuickFollowupOpen(false);
          void load(true);
          setActiveTab('requests');
        }}
        defaultBranch={branch === ALL_FILTER ? serviceBranchOverride || userBranch : branch}
      />
      <QuickFollowupModal
        open={exceptionalFollowupOpen}
        mode="exceptional"
        onClose={() => setExceptionalFollowupOpen(false)}
        onCreated={() => {
          setExceptionalFollowupOpen(false);
          void load(true);
          setActiveTab('requests');
        }}
        defaultBranch={branch === ALL_FILTER ? serviceBranchOverride || userBranch : branch}
      />`;
  pageReplace(oldQuickModal, bothModals, 'both followup modals');
}

const oldSignature = `export default function QuickFollowupModal({
  open,
  onClose,
  onCreated,
  defaultBranch,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  defaultBranch?: string;
})`;
const newSignature = `export default function QuickFollowupModal({
  open,
  onClose,
  onCreated,
  defaultBranch,
  mode = 'doctor_request',
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  defaultBranch?: string;
  mode?: 'doctor_request' | 'exceptional';
})`;
modalReplace(oldSignature, newSignature, 'modal mode prop');

modalReplace(
  "  const { user } = useAuth();",
  "  const { user } = useAuth();\n  const isExceptional = mode === 'exceptional';",
  'exceptional mode flag'
);

modalReplace(
  "  }, [defaultBranch, open, user?.branch]);",
  "    setPriority(isExceptional ? 'عاجل' : 'مهم');\n    setReason(isExceptional ? 'متابعة استثنائية' : 'طلب متابعة');\n  }, [defaultBranch, isExceptional, open, user?.branch]);",
  'mode defaults'
);

modalReplace(
  "        requestType: 'doctor_requested_followup',",
  "        requestType: isExceptional ? 'exceptional_followup' : 'doctor_requested_followup',",
  'request type'
);
modalReplace(
  "        notes: `${cleanNote}${phoneStatusNote}\\nالمصدر: quick_followup_modal`,",
  "        notes: `${cleanNote}${phoneStatusNote}\\nالمصدر: ${isExceptional ? 'exceptional_followup_modal' : 'quick_followup_modal'}`,",
  'source note'
);
modalReplace(
  "        source: 'doctor_requested_followup',",
  "        source: isExceptional ? 'exceptional_followup' : 'doctor_requested_followup',",
  'source value'
);
modalReplace(
  "      notify('success', 'تم إنشاء طلب المتابعة بنجاح');",
  "      notify('success', isExceptional ? 'تم إنشاء المتابعة الاستثنائية بنجاح' : 'تم إنشاء طلب المتابعة بنجاح');",
  'success message'
);
modalReplace(
  "            <h3 className=\"text-xl font-black text-white\">إنشاء متابعة سريعة</h3>",
  "            <h3 className=\"text-xl font-black text-white\">{isExceptional ? 'إضافة متابعة استثنائية' : 'إنشاء متابعة سريعة'}</h3>",
  'modal title'
);
modalReplace(
  "              ستُسجل المتابعة على staff_id الخاص بحسابك وتظهر في «متابعاتي المطلوبة».",
  "              {isExceptional ? 'تُضاف للعميل حتى لو لم يكن موجودًا في قائمة اليوم، وتظهر ضمن المتابعات الاستثنائية.' : 'ستُسجل المتابعة باسم حسابك وتظهر في «متابعاتي المطلوبة».'}",
  'modal subtitle'
);

const checks = [
  ['page state', page.includes('exceptionalFollowupOpen')],
  ['quick action', page.includes('data-action="open-quick-followup"')],
  ['exceptional action', page.includes('data-action="open-exceptional-followup"')],
  ['exceptional modal', page.includes('open={exceptionalFollowupOpen}')],
  ['mode prop', modal.includes("mode?: 'doctor_request' | 'exceptional';")],
  ['mode flag', modal.includes("const isExceptional = mode === 'exceptional';")],
];
for (const [label, ok] of checks) {
  if (!ok) throw new Error(`[customer-service-actions] verification failed: ${label}`);
}

if (pageChanged) fs.writeFileSync(pageFile, page, 'utf8');
if (modalChanged) fs.writeFileSync(modalFile, modal, 'utf8');
console.log(`Customer service actions verified. pageChanged=${pageChanged} modalChanged=${modalChanged}`);
