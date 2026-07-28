const fs = require('node:fs');
const path = require('node:path');

const sidebarPath = path.join(process.cwd(), 'src/components/layout/Sidebar.tsx');
const pagePath = path.join(process.cwd(), 'src/pages/SmartCustomerService.tsx');
const appPath = path.join(process.cwd(), 'src/App.tsx');
const evaluationPagePath = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
let sidebar = fs.readFileSync(sidebarPath, 'utf8');
let page = fs.readFileSync(pagePath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');
let evaluationPage = fs.readFileSync(evaluationPagePath, 'utf8');

const oldButton = "<button onClick={() => go(pharmacistView ? '/doctor-dashboard?tab=followups' : '/customer-service?quickFollowup=1')} className=\"flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200\">متابعة سريعة</button>";
const newButton = "<button onClick={() => { const target = `/customer-service?quickFollowup=1&open=${Date.now()}`; if (location.pathname === '/customer-service') { window.dispatchEvent(new CustomEvent('open-quick-followup')); } else { go(target); } }} className=\"flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200\">متابعة سريعة</button>";

if (!sidebar.includes("window.dispatchEvent(new CustomEvent('open-quick-followup'))")) {
  if (sidebar.includes(oldButton)) {
    sidebar = sidebar.replace(oldButton, newButton);
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
    console.log('[global-quick-followup] smart page trigger connected');
  } else {
    console.log('[global-quick-followup] smart page already changed; skipping trigger insertion safely');
  }
}

const evaluationImport = "const StaffMonthlyEvaluation = lazy(() => import('@/pages/StaffMonthlyEvaluation'));";
if (!app.includes(evaluationImport)) {
  const anchor = "const StaffDetail = lazy(() => import('@/pages/StaffDetail'));";
  if (!app.includes(anchor)) throw new Error('[staff-evaluation] app import anchor not found');
  app = app.replace(anchor, `${anchor}\n${evaluationImport}`);
}

const evaluationRoute = '<Route path="/staff-monthly-evaluation" element={<ProtectedRoute>{routeSuspense(<StaffMonthlyEvaluation />, \'تقييم الدكاترة الشهري\')}</ProtectedRoute>} />';
if (!app.includes('/staff-monthly-evaluation')) {
  const routeAnchor = '<Route path="/shift-performance" element={<ProtectedRoute>{routeSuspense(<ShiftPerformance />, \'تقييم الشيفت\')}</ProtectedRoute>} />';
  if (!app.includes(routeAnchor)) throw new Error('[staff-evaluation] app route anchor not found');
  app = app.replace(routeAnchor, `${routeAnchor}\n    ${evaluationRoute}`);
}

const managerNav = "{ path: '/staff-monthly-evaluation', icon: Star, label: 'تقييم الدكاترة الشهري', permission: 'view_shift_performance' },";
if (!sidebar.includes("label: 'تقييم الدكاترة الشهري'")) {
  const managerAnchor = "{ path: '/shift-performance', icon: ClipboardList, label: 'تقييمات الشيفتات', permission: 'view_shift_performance' },";
  if (!sidebar.includes(managerAnchor)) throw new Error('[staff-evaluation] manager sidebar anchor not found');
  sidebar = sidebar.replace(managerAnchor, `${managerAnchor}\n    ${managerNav}`);
}

const doctorNav = "{ path: '/staff-monthly-evaluation', icon: Star, label: 'تقييمي الشهري', permission: 'view_doctor_dashboard' },";
if (!sidebar.includes("label: 'تقييمي الشهري'")) {
  const doctorAnchor = "{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_doctor_dashboard' },";
  if (!sidebar.includes(doctorAnchor)) throw new Error('[staff-evaluation] doctor sidebar anchor not found');
  sidebar = sidebar.replace(doctorAnchor, `${doctorAnchor}\n    ${doctorNav}`);
}

// Clean up any previous build-time insertion that referenced Award without importing it.
sidebar = sidebar.replaceAll('icon: Award', 'icon: Star');

if (!evaluationPage.includes('type Dispatch')) {
  evaluationPage = evaluationPage.replace("import { useEffect, useMemo, useRef, useState } from 'react';", "import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';");
}
if (!evaluationPage.includes('function nextMonthStart')) {
  evaluationPage = evaluationPage.replace("function monthStart(value: string) { return `${value}-01`; }", "function monthStart(value: string) { return `${value}-01`; }\nfunction nextMonthStart(value: string) { const [year, month] = value.split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); }");
}
evaluationPage = evaluationPage.replaceAll("`${month}-32`", 'nextMonthStart(month)');
evaluationPage = evaluationPage.replace("row.id === user?.staff_id", "row.id === (user as any)?.staff_id");
evaluationPage = evaluationPage.replace('React.Dispatch<React.SetStateAction<string[]>>', 'Dispatch<SetStateAction<string[]>>');

fs.writeFileSync(sidebarPath, sidebar, 'utf8');
fs.writeFileSync(pagePath, page, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(evaluationPagePath, evaluationPage, 'utf8');

sidebar = fs.readFileSync(sidebarPath, 'utf8');
page = fs.readFileSync(pagePath, 'utf8');
app = fs.readFileSync(appPath, 'utf8');
evaluationPage = fs.readFileSync(evaluationPagePath, 'utf8');

if (!sidebar.includes("open-quick-followup") && !sidebar.includes('quickFollowup=1')) throw new Error('[global-quick-followup] sidebar verification failed');
if (!page.includes(listenerMarker) && !page.includes("params.get('quickFollowup') === '1'")) throw new Error('[global-quick-followup] page verification failed');
if (!app.includes('/staff-monthly-evaluation') || !sidebar.includes("label: 'تقييم الدكاترة الشهري'")) throw new Error('[staff-evaluation] route or manager navigation verification failed');
if (!sidebar.includes("label: 'تقييمي الشهري'")) throw new Error('[staff-evaluation] doctor navigation verification failed');
if (sidebar.includes('icon: Award')) throw new Error('[staff-evaluation] unsafe Award reference still exists');
if (evaluationPage.includes('`${month}-32`') || evaluationPage.includes('React.Dispatch')) throw new Error('[staff-evaluation] page hardening verification failed');

console.log('Global quick followup and monthly staff evaluation navigation verified safely.');