const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');
let source = fs.readFileSync(file, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    console.warn(`[exceptional-history-v2] skipped ${label}: anchor not found`);
    return;
  }
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
  "type HistoryPeriod = 'all' | 'today' | '7d' | 'cycle';",
  "type HistoryPeriod = 'all' | 'today' | '7d' | 'cycle';\ntype RequestedHistoryKind = 'all' | 'doctor_request' | 'exceptional';",
  'history kind type'
);

replaceOnce(
  "function sourceFromRow(row: FollowupRow): QueueSource {",
  `function requestedHistoryKind(row: FollowupRow): 'doctor_request' | 'exceptional' | null {\n  const text = \`${'${row.request_type || \'\'} ${row.followup_type || \'\'} ${row.category || \'\'} ${row.notes || \'\'} ${row.followup_reason || \'\'} ${row.request_details || \'\'}'}\`.toLowerCase();\n  if (/exceptional_followup|متابعة استثنائية|متابعه استثنائيه|استثنائي/.test(text)) return 'exceptional';\n  if (/doctor_requested_followup|طلب متابعة من دكتور|طلب متابعه من دكتور|طلب دكتور|quick_followup|متابعة سريعة|متابعه سريعه/.test(text)) return 'doctor_request';\n  return null;\n}\n\nfunction sourceFromRow(row: FollowupRow): QueueSource {`,
  'legacy request classifier'
);

replaceOnce(
  "  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('cycle');\n  const [quickOpen, setQuickOpen] = useState(false);",
  "  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('cycle');\n  const [requestedHistoryKind, setRequestedHistoryKind] = useState<RequestedHistoryKind>('all');\n  const [quickOpen, setQuickOpen] = useState(false);\n  const [exceptionalOpen, setExceptionalOpen] = useState(false);",
  'history and modal state'
);

replaceOnce(
  "        if (historyResult !== 'all' && resultOf(row) !== historyResult) return false;",
  "        if (historyResult !== 'all' && resultOf(row) !== historyResult) return false;\n        if (requestedHistoryKind !== 'all' && requestedHistoryKind(row) !== requestedHistoryKind) return false;",
  'history kind filtering'
);

replaceOnce(
  "    [completedHistory, historyPeriod, historyResult, historySearch]",
  "    [completedHistory, historyPeriod, historyResult, historySearch, requestedHistoryKind]",
  'history dependencies'
);

replaceOnce(
  `            <button className="btn-primary" onClick={() => setQuickOpen(true)}>\n              إضافة متابعة\n            </button>`,
  `            <button className="btn-primary" onClick={() => setQuickOpen(true)}>\n              طلب متابعة من دكتور\n            </button>\n            <button\n              type="button"\n              className="btn-secondary border-amber-400/40 bg-amber-500/10 text-amber-100"\n              onClick={() => setExceptionalOpen(true)}\n            >\n              + إضافة متابعة استثنائية\n            </button>`,
  'visible header actions'
);

replaceOnce(
  `      <section className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#10243d] p-2">`,
  `      <section className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3">\n        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">\n          <div>\n            <div className="font-black text-amber-100">طلبات الدكاترة والمتابعات الاستثنائية القديمة</div>\n            <div className="mt-1 text-xs font-bold text-slate-400">يشمل السجلات المفتوحة والمكتملة القديمة حتى لو كانت مسجلة بالمسميات السابقة.</div>\n          </div>\n          <div className="flex flex-wrap gap-2">\n            <button type="button" className="btn-secondary" onClick={() => { setTab('doctor-requests'); setStatusFilter('all'); setSourceFilter('doctor_request'); }}>\n              المفتوحة الآن ({allFollowups.filter((row) => !isCompleted(row) && requestedHistoryKind(row)).length})\n            </button>\n            <button type="button" className="btn-secondary" onClick={() => { setTab('history'); setHistoryPeriod('all'); setRequestedHistoryKind('doctor_request'); }}>\n              سجل طلبات الدكاترة ({completedHistory.filter((row) => requestedHistoryKind(row) === 'doctor_request').length})\n            </button>\n            <button type="button" className="btn-secondary border-amber-400/30 text-amber-100" onClick={() => { setTab('history'); setHistoryPeriod('all'); setRequestedHistoryKind('exceptional'); }}>\n              سجل المتابعات الاستثنائية ({completedHistory.filter((row) => requestedHistoryKind(row) === 'exceptional').length})\n            </button>\n          </div>\n        </div>\n      </section>\n\n      <section className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#10243d] p-2">`,
  'legacy history launcher'
);

replaceOnce(
  `      <QuickFollowupModal\n        open={quickOpen}\n        onClose={() => setQuickOpen(false)}\n        onCreated={() => void loadWorkspace()}\n        defaultBranch={branch}\n      />`,
  `      <QuickFollowupModal\n        open={quickOpen}\n        mode="doctor_request"\n        onClose={() => setQuickOpen(false)}\n        onCreated={() => {\n          setTab('doctor-requests');\n          setSourceFilter('doctor_request');\n          void loadWorkspace();\n        }}\n        defaultBranch={branch}\n      />\n      <QuickFollowupModal\n        open={exceptionalOpen}\n        mode="exceptional"\n        onClose={() => setExceptionalOpen(false)}\n        onCreated={() => {\n          setTab('doctor-requests');\n          setSourceFilter('doctor_request');\n          void loadWorkspace();\n        }}\n        defaultBranch={branch}\n      />`,
  'separate followup modals'
);

if (changed) fs.writeFileSync(file, source, 'utf8');
console.log(`Exceptional followup button and legacy history checked/applied. changed=${changed}`);
