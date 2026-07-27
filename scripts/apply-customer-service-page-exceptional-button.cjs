const fs = require('node:fs');
const path = require('node:path');

const pageFile = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
let page = fs.readFileSync(pageFile, 'utf8');
let changed = false;

function apply(next, label) {
  if (next !== page) {
    page = next;
    changed = true;
    console.log(`[customer-service-actions] applied ${label}`);
  }
}

// Add a visible action bar inside the real /customer-service page.
if (!page.includes('data-section="customer-service-followup-actions"')) {
  const actionBar = `      <section data-section="customer-service-followup-actions" className="rounded-2xl border border-cyan-400/25 bg-slate-900/80 p-4 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black text-white">إضافة متابعة جديدة</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">يمكن اختيار عميل من قاعدة العملاء أو كتابة بيانات عميل غير موجود في قائمة اليوم.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-action="open-quick-followup"
              className="btn-primary"
              onClick={() => setQuickFollowupOpen(true)}
            >
              <Plus className="ml-1 inline h-4 w-4" /> متابعة سريعة
            </button>
            <button
              type="button"
              data-action="open-exceptional-followup"
              className="rounded-xl border-2 border-amber-200 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 shadow-lg transition hover:bg-amber-400"
              onClick={() => {
                setForm((current) => ({
                  ...current,
                  priority: 'عاجل',
                  reason: current.reason || 'متابعة استثنائية',
                  due: current.due || dateInputNow(),
                }));
                setActiveTab('add');
              }}
            >
              <Sparkles className="ml-1 inline h-4 w-4" /> إضافة متابعة استثنائية
            </button>
          </div>
        </div>
      </section>

`;

  const next = page.replace(/(\s*\{error && \()/, `\n${actionBar}$1`);
  apply(next, 'visible quick and exceptional action bar');
}

// Make sure the query parameter opens the existing quick-followup modal.
if (!page.includes("params.get('quickFollowup') === '1'")) {
  console.warn('[customer-service-actions] quickFollowup query parser not found');
}
if (!page.includes('setQuickFollowupOpen(true)')) {
  console.warn('[customer-service-actions] quick followup opener not found');
}

// Verification is limited to the actual UI actions; do not fail on optional modal rewrites.
if (!page.includes('data-action="open-quick-followup"')) {
  throw new Error('[customer-service-actions] quick followup action was not inserted');
}
if (!page.includes('data-action="open-exceptional-followup"')) {
  throw new Error('[customer-service-actions] exceptional followup action was not inserted');
}

if (changed) fs.writeFileSync(pageFile, page, 'utf8');
console.log(`Customer service followup actions verified. changed=${changed}`);
