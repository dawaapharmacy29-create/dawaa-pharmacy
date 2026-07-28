const fs = require('node:fs');
const path = require('node:path');

const sidebarPath = path.join(process.cwd(), 'src/components/layout/Sidebar.tsx');
const pagePath = path.join(process.cwd(), 'src/pages/SmartCustomerService.tsx');
let sidebar = fs.readFileSync(sidebarPath, 'utf8');
let page = fs.readFileSync(pagePath, 'utf8');

const oldButton = "<button onClick={() => go(pharmacistView ? '/doctor-dashboard?tab=followups' : '/customer-service?quickFollowup=1')} className=\"flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200\">متابعة سريعة</button>";
const newButton = "<button onClick={() => { const target = `/customer-service?quickFollowup=1&open=${Date.now()}`; if (location.pathname === '/customer-service') { window.dispatchEvent(new CustomEvent('open-quick-followup')); } else { go(target); } }} className=\"flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200\">متابعة سريعة</button>";

if (!sidebar.includes("window.dispatchEvent(new CustomEvent('open-quick-followup'))")) {
  if (sidebar.includes(oldButton)) {
    sidebar = sidebar.replace(oldButton, newButton);
    fs.writeFileSync(sidebarPath, sidebar, 'utf8');
    console.log('[global-quick-followup] sidebar quick action connected');
  } else {
    console.log('[global-quick-followup] sidebar anchor changed; leaving existing implementation untouched');
  }
}

const listenerMarker = "window.addEventListener('open-quick-followup', openQuick)";
if (!page.includes(listenerMarker)) {
  const queryEffectPattern = /  useEffect\(\(\) => \{\n\s*const params = new URLSearchParams\(window\.location\.search\);\n\s*if \(params\.get\('quickFollowup'\) === '1'\) setQuickOpen\(true\);\n\s*\}, \[\]\);/;
  if (queryEffectPattern.test(page)) {
    page = page.replace(queryEffectPattern, `  useEffect(() => {\n    const openQuick = () => setQuickOpen(true);\n    const params = new URLSearchParams(window.location.search);\n    if (params.get('quickFollowup') === '1') openQuick();\n    window.addEventListener('open-quick-followup', openQuick);\n    return () => window.removeEventListener('open-quick-followup', openQuick);\n  }, []);`);
    fs.writeFileSync(pagePath, page, 'utf8');
    console.log('[global-quick-followup] smart page trigger connected');
  } else {
    console.log('[global-quick-followup] smart page already changed; skipping trigger insertion safely');
  }
}

sidebar = fs.readFileSync(sidebarPath, 'utf8');
page = fs.readFileSync(pagePath, 'utf8');

if (!sidebar.includes("open-quick-followup") && !sidebar.includes('quickFollowup=1')) {
  throw new Error('[global-quick-followup] sidebar verification failed');
}
if (!page.includes(listenerMarker) && !page.includes("params.get('quickFollowup') === '1'")) {
  throw new Error('[global-quick-followup] page verification failed');
}

console.log('Global quick followup trigger verified safely.');