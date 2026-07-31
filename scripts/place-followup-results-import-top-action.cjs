const fs = require('fs');
const path = require('path');

const pageFile = path.join(process.cwd(), 'src/pages/CustomerService.tsx');
const workspaceFile = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');

if (!fs.existsSync(pageFile)) throw new Error('[followup-results-top-action] CustomerService page not found');
if (!fs.existsSync(workspaceFile)) throw new Error('[followup-results-top-action] workspace not found');

let page = fs.readFileSync(pageFile, 'utf8');
let workspace = fs.readFileSync(workspaceFile, 'utf8');
const pageBefore = page;
const workspaceBefore = workspace;

const EVENT_NAME = 'open-followup-results-import';

// Put the new action directly beside the visible exceptional-followup action.
if (!page.includes('data-followup-results-import-top')) {
  const exceptionalButtonPattern = /(<button\b[^>]*>[\s\S]{0,500}?إضافة متابعة استثنائية[\s\S]{0,200}?<\/button>)/;
  const match = page.match(exceptionalButtonPattern);
  if (!match) throw new Error('[followup-results-top-action] exceptional action button anchor not found');

  const newButton = `\n            <button\n              type="button"\n              data-followup-results-import-top\n              onClick={() => window.dispatchEvent(new CustomEvent('${EVENT_NAME}'))}\n              className="btn-secondary flex items-center gap-2"\n              title="رفع ملف خدمة العملاء وتسجيل نتائج متابعات فواتير 500 جنيه فأكثر"\n            >\n              <Download size={16} />\n              رفع نتائج متابعة 500+\n            </button>`;

  page = page.replace(match[1], `${match[1]}${newButton}`);
}

// The actual import modal lives in the unified workspace. Listen to the top-page action.
if (!workspace.includes(`window.addEventListener('${EVENT_NAME}'`)) {
  const stateAnchor = '  const [resultsExcelImportOpen, setResultsExcelImportOpen] = useState(false);';
  if (!workspace.includes(stateAnchor)) {
    throw new Error('[followup-results-top-action] results import modal state not found; run base import patch first');
  }
  const listener = `${stateAnchor}\n\n  useEffect(() => {\n    const openResultsImport = () => setResultsExcelImportOpen(true);\n    window.addEventListener('${EVENT_NAME}', openResultsImport);\n    return () => window.removeEventListener('${EVENT_NAME}', openResultsImport);\n  }, []);`;
  workspace = workspace.replace(stateAnchor, listener);
}

// Remove the duplicate lower toolbar button. The requested and canonical location is the top action row.
workspace = workspace.replace(
  /\n\s*<button className="btn-secondary" onClick=\{\(\) => setResultsExcelImportOpen\(true\)\}>\s*رفع نتائج متابعة 500\+\s*<\/button>/,
  ''
);

const checks = [
  [page.includes('data-followup-results-import-top'), 'top action marker'],
  [page.includes('رفع نتائج متابعة 500+'), 'top action label'],
  [page.includes(`new CustomEvent('${EVENT_NAME}')`), 'top action event'],
  [workspace.includes(`window.addEventListener('${EVENT_NAME}'`), 'workspace event listener'],
  [workspace.includes('<FollowupResultsExcelImportModal'), 'results import modal'],
  [workspace.includes('open={resultsExcelImportOpen}'), 'results import open state'],
];
for (const [ok, label] of checks) {
  if (!ok) throw new Error(`[followup-results-top-action] missing ${label}`);
}

if (page !== pageBefore) fs.writeFileSync(pageFile, page);
if (workspace !== workspaceBefore) fs.writeFileSync(workspaceFile, workspace);

console.log(`[followup-results-top-action] verified top button and modal link. pageChanged=${page !== pageBefore} workspaceChanged=${workspace !== workspaceBefore}`);
