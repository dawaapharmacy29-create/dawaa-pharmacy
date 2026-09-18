const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-device-setup-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-device-setup-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-device-setup-v4] ${label}: applied`);
}

const branchPicker = `\n                <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-black text-slate-200">\n                  <span className="whitespace-nowrap">فرع هذا الجهاز</span>\n                  <select\n                    value={importBranch}\n                    onChange={(event) => {\n                      const value = event.target.value;\n                      setImportBranch(value);\n                      setQueueResult(null);\n                      if (value) localStorage.setItem('dawaa.whatsappReview.branch', value);\n                      else localStorage.removeItem('dawaa.whatsappReview.branch');\n                    }}\n                    className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs font-black text-white"\n                  >\n                    <option value="">اختار الفرع</option>\n                    <option value="فرع الشامي">فرع الشامي</option>\n                    <option value="فرع شكري">فرع شكري</option>\n                  </select>\n                </label>\n`;

patch(
  'persistent device branch picker',
  `            {supportsLocalWhatsAppInbox() ? (\n              <>\n                <button`,
  `            {supportsLocalWhatsAppInbox() ? (\n              <>` + branchPicker + `                <button`
);

patch(
  'setup readiness status',
  `<span className={localInboxConnected ? 'font-black text-emerald-200' : 'font-black text-amber-200'}>{localInboxConnected ? 'Local Inbox متصل' : 'Local Inbox يحتاج سماح'}</span>`,
  `<span className={localInboxConnected && importBranch ? 'font-black text-emerald-200' : 'font-black text-amber-200'}>{localInboxConnected && importBranch ? 'Local Inbox جاهز للعمل التلقائي' : localInboxConnected ? 'Local Inbox متصل • حدد الفرع' : 'Local Inbox يحتاج سماح'}</span>`
);

patch(
  'setup helper copy',
  `التقاط تلقائي كل 5 ثوانٍ`,
  `التقاط وتحليل تلقائي كل 5 ثوانٍ`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-device-setup-v4] one-time pharmacy computer setup UI applied successfully');
