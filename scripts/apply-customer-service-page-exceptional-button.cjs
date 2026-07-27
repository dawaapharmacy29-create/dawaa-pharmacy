const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
let source = fs.readFileSync(file, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`[customer-service-exceptional] anchor not found: ${label}`);
  source = source.replace(before, after);
  changed = true;
  console.log(`[customer-service-exceptional] applied ${label}`);
}

if (!source.includes('const [exceptionalFollowupOpen, setExceptionalFollowupOpen]')) {
  const statePattern = /(const \[quickFollowupOpen, setQuickFollowupOpen\] = useState\(false\);)/;
  if (!statePattern.test(source)) throw new Error('[customer-service-exceptional] quickFollowupOpen state not found');
  source = source.replace(
    statePattern,
    `$1\n  const [exceptionalFollowupOpen, setExceptionalFollowupOpen] = useState(false);`
  );
  changed = true;
}

const oldModal = `      <QuickFollowupModal
        open={quickFollowupOpen}
        onClose={closeQuickFollowup}
        onCreated={() => {
          void load(true);
          setActiveTab('requests');
        }}
      />`;

const newModal = `      <button
        type="button"
        data-action="customer-service-exceptional-followup"
        onClick={() => setExceptionalFollowupOpen(true)}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-2xl border-2 border-amber-200 bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-amber-950/40 transition hover:scale-105 hover:bg-amber-400"
      >
        <Plus className="h-5 w-5" />
        إضافة متابعة استثنائية
      </button>
      <QuickFollowupModal
        open={quickFollowupOpen}
        mode="doctor_request"
        onClose={closeQuickFollowup}
        onCreated={() => {
          void load(true);
          setActiveTab('requests');
        }}
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
      />`;

replaceOnce(oldModal, newModal, 'active page floating button and modal');

if (!source.includes('data-action="customer-service-exceptional-followup"')) {
  throw new Error('[customer-service-exceptional] visible button verification failed');
}
if (!source.includes('open={exceptionalFollowupOpen}')) {
  throw new Error('[customer-service-exceptional] modal verification failed');
}

if (changed) fs.writeFileSync(file, source, 'utf8');
console.log(`Active customer service exceptional followup verified. changed=${changed}`);
