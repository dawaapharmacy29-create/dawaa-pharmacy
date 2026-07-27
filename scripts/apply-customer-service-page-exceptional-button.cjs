const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
let source = fs.readFileSync(file, 'utf8');
let changed = false;

function apply(next, label) {
  if (next !== source) {
    source = next;
    changed = true;
    console.log(`[customer-service-exceptional] applied ${label}`);
  }
}

// Ensure state exists on the actual /customer-service page.
if (!source.includes('const [exceptionalFollowupOpen, setExceptionalFollowupOpen]')) {
  const next = source.replace(
    /(const \[quickFollowupOpen, setQuickFollowupOpen\] = useState\(false\);)/,
    `$1\n  const [exceptionalFollowupOpen, setExceptionalFollowupOpen] = useState(false);`
  );
  apply(next, 'exceptional modal state');
}

// Add a fixed, highly visible action directly in CustomerService.tsx.
if (!source.includes('data-action="customer-service-exceptional-followup"')) {
  const button = `      <button
        type="button"
        data-action="customer-service-exceptional-followup"
        onClick={() => setExceptionalFollowupOpen(true)}
        className="fixed bottom-6 left-6 z-[70] flex items-center gap-2 rounded-2xl border-2 border-amber-200 bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-amber-950/40 transition hover:scale-105 hover:bg-amber-400"
      >
        <Plus className="h-5 w-5" />
        إضافة متابعة استثنائية
      </button>\n`;

  // Prefer inserting immediately before the quick-followup modal.
  let next = source.replace(
    /(\s*<QuickFollowupModal\s+[\s\S]*?open=\{quickFollowupOpen\})/,
    `\n${button}$1`
  );

  // Fallback: insert before the final wrapper closing tag in the page component.
  if (next === source) {
    const marker = '\n    </div>\n  );\n}\n\nfunction QuickReplyPickerModal';
    if (source.includes(marker)) next = source.replace(marker, `\n${button}    </div>\n  );\n}\n\nfunction QuickReplyPickerModal`);
  }
  apply(next, 'visible exceptional button');
}

// Render a separate exceptional modal if no earlier patch already added one.
if (!source.includes('open={exceptionalFollowupOpen}')) {
  const modal = `      <QuickFollowupModal
        open={exceptionalFollowupOpen}
        mode="exceptional"
        onClose={() => setExceptionalFollowupOpen(false)}
        onCreated={() => {
          setExceptionalFollowupOpen(false);
          void load(true);
          setActiveTab('requests');
        }}
      />\n`;

  let next = source.replace(
    /(\s*<QuickFollowupModal\s+[\s\S]*?open=\{quickFollowupOpen\}[\s\S]*?\/\>)/,
    `$1\n${modal}`
  );

  if (next === source) {
    const marker = '\n    </div>\n  );\n}\n\nfunction QuickReplyPickerModal';
    if (source.includes(marker)) next = source.replace(marker, `\n${modal}    </div>\n  );\n}\n\nfunction QuickReplyPickerModal`);
  }
  apply(next, 'exceptional modal render');
}

// Fail only when the actual page still cannot contain the requested feature.
if (!source.includes('const [exceptionalFollowupOpen, setExceptionalFollowupOpen]')) {
  throw new Error('[customer-service-exceptional] state insertion failed');
}
if (!source.includes('data-action="customer-service-exceptional-followup"')) {
  throw new Error('[customer-service-exceptional] visible button insertion failed');
}
if (!source.includes('open={exceptionalFollowupOpen}')) {
  throw new Error('[customer-service-exceptional] modal insertion failed');
}

if (changed) fs.writeFileSync(file, source, 'utf8');
console.log(`Active customer service exceptional followup verified. changed=${changed}`);
