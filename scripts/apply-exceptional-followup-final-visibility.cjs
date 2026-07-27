const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');
let source = fs.readFileSync(file, 'utf8');
let changed = false;

function writeChange(next, label) {
  if (next !== source) {
    source = next;
    changed = true;
    console.log(`[exceptional-final] applied ${label}`);
  }
}

// Ensure the exceptional modal state exists, regardless of spacing or nearby states.
if (!source.includes('const [exceptionalOpen, setExceptionalOpen]')) {
  writeChange(
    source.replace(
      /(const \[quickOpen, setQuickOpen\] = useState\(false\);)/,
      `$1\n  const [exceptionalOpen, setExceptionalOpen] = useState(false);`
    ),
    'exceptional modal state'
  );
}

// Force a visible action beside the normal follow-up button.
if (!source.includes('data-action="exceptional-followup"')) {
  const buttonPattern = /(\s*<button[^>]*onClick=\{\(\) => setQuickOpen\(true\)\}[^>]*>[\s\S]*?<\/button>)/;
  const match = source.match(buttonPattern);
  if (match) {
    const exceptionalButton = `\n            <button\n              type="button"\n              data-action="exceptional-followup"\n              className="btn-primary border-amber-300 bg-amber-500 text-slate-950 shadow-lg shadow-amber-950/30"\n              onClick={() => setExceptionalOpen(true)}\n            >\n              + إضافة متابعة استثنائية\n            </button>`;
    writeChange(source.replace(buttonPattern, `${match[1]}${exceptionalButton}`), 'visible exceptional button');
  } else {
    console.warn('[exceptional-final] quick followup button anchor not found');
  }
}

// Ensure the exceptional modal is rendered even if older exact-anchor patches were skipped.
if (!source.includes('open={exceptionalOpen}')) {
  const modalPattern = /(\s*<QuickFollowupModal\s+[\s\S]*?open=\{quickOpen\}[\s\S]*?\/\>)/;
  const match = source.match(modalPattern);
  if (match) {
    const modal = `\n      <QuickFollowupModal\n        open={exceptionalOpen}\n        mode="exceptional"\n        onClose={() => setExceptionalOpen(false)}\n        onCreated={() => {\n          setTab('doctor-requests');\n          setStatusFilter('all');\n          void loadWorkspace();\n        }}\n        defaultBranch={branch}\n      />`;
    writeChange(source.replace(modalPattern, `${match[1]}${modal}`), 'exceptional modal render');
  } else {
    console.warn('[exceptional-final] quick modal render anchor not found');
  }
}

// The history area must show completed records only. Remove any launcher for open records.
writeChange(
  source.replace(
    /\s*<button\s+type="button"\s+className="btn-secondary"\s+onClick=\{\(\) => \{\s*setTab\('doctor-requests'\);[\s\S]*?المفتوحة الآن \([^\n]*\)[\s\S]*?<\/button>/g,
    ''
  ),
  'remove open records from history launcher'
);

writeChange(
  source
    .replace(
      'يشمل السجلات المفتوحة والمكتملة القديمة حتى لو كانت مسجلة بالمسميات السابقة.',
      'يعرض المتابعات المكتملة فقط، بما فيها السجلات القديمة المسجلة بالمسميات السابقة.'
    )
    .replace(
      'طلبات الدكاترة والمتابعات الاستثنائية القديمة',
      'سجل طلبات الدكاترة والمتابعات الاستثنائية المكتملة'
    ),
  'completed-only history labels'
);

if (!source.includes('data-action="exceptional-followup"')) {
  throw new Error('Exceptional followup button could not be inserted');
}
if (!source.includes('open={exceptionalOpen}')) {
  throw new Error('Exceptional followup modal could not be inserted');
}

if (changed) fs.writeFileSync(file, source, 'utf8');
console.log(`Exceptional followup final visibility verified. changed=${changed}`);
