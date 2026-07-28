const fs = require('node:fs');
const path = require('node:path');

const sidebarPath = path.join(process.cwd(), 'src/components/layout/Sidebar.tsx');
const pagePath = path.join(process.cwd(), 'src/pages/SmartCustomerService.tsx');
let sidebar = fs.readFileSync(sidebarPath, 'utf8');
let page = fs.readFileSync(pagePath, 'utf8');

const oldButton = "<button onClick={() => go(pharmacistView ? '/doctor-dashboard?tab=followups' : '/customer-service?quickFollowup=1')} className=\"flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200\">متابعة سريعة</button>";
const newButton = "<button onClick={() => { const target = `/customer-service?quickFollowup=1&open=${Date.now()}`; if (location.pathname === '/customer-service') { window.dispatchEvent(new CustomEvent('open-quick-followup')); } else { go(target); } }} className=\"flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200\">متابعة سريعة</button>";

if (!sidebar.includes(newButton)) {
  if (!sidebar.includes(oldButton)) throw new Error('[global-quick-followup] sidebar button anchor not found');
  sidebar = sidebar.replace(oldButton, newButton);
  fs.writeFileSync(sidebarPath, sidebar, 'utf8');
  console.log('[global-quick-followup] sidebar quick action connected');
}

const oldEffect = `  useEffect(() => {\n    const params = new URLSearchParams(window.location.search);\n    if (params.get('quickFollowup') === '1') setQuickOpen(true);\n  }, []);`;
const newEffect = `  useEffect(() => {\n    const openQuick = () => setQuickOpen(true);\n    const params = new URLSearchParams(window.location.search);\n    if (params.get('quickFollowup') === '1') openQuick();\n    window.addEventListener('open-quick-followup', openQuick);\n    return () => window.removeEventListener('open-quick-followup', openQuick);\n  }, [window.location.search]);`;

if (!page.includes(newEffect)) {
  if (!page.includes(oldEffect)) throw new Error('[global-quick-followup] smart page query effect anchor not found');
  page = page.replace(oldEffect, newEffect);
  fs.writeFileSync(pagePath, page, 'utf8');
  console.log('[global-quick-followup] smart page trigger connected');
}

if (!sidebar.includes("window.dispatchEvent(new CustomEvent('open-quick-followup'))")) throw new Error('[global-quick-followup] sidebar verification failed');
if (!page.includes("window.addEventListener('open-quick-followup', openQuick)")) throw new Error('[global-quick-followup] page verification failed');
console.log('Global quick followup trigger verified.');
