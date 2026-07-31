const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');
if (!fs.existsSync(file)) throw new Error('[followup-results-import] workspace not found');
let source = fs.readFileSync(file, 'utf8');
const before = source;

const importLine = "import FollowupResultsExcelImportModal from '@/components/customerService/FollowupResultsExcelImportModal';";
if (!source.includes(importLine)) {
  source = source.replace(
    "import FollowupExcelImportModal from '@/components/customerService/FollowupExcelImportModal';",
    "import FollowupExcelImportModal from '@/components/customerService/FollowupExcelImportModal';\n" + importLine
  );
}

if (!source.includes('const [resultsExcelImportOpen, setResultsExcelImportOpen]')) {
  source = source.replace(
    '  const [excelImportOpen, setExcelImportOpen] = useState(false);',
    "  const [excelImportOpen, setExcelImportOpen] = useState(false);\n  const [resultsExcelImportOpen, setResultsExcelImportOpen] = useState(false);"
  );
}

const existingButton = `            <button className="btn-secondary" onClick={() => setExcelImportOpen(true)}>
              أمر متابعة Excel
            </button>`;
const resultsButton = `            <button className="btn-secondary" onClick={() => setResultsExcelImportOpen(true)}>
              رفع نتائج متابعة 500+
            </button>`;
if (!source.includes('رفع نتائج متابعة 500+')) {
  if (!source.includes(existingButton)) throw new Error('[followup-results-import] button anchor not found');
  source = source.replace(existingButton, `${existingButton}\n${resultsButton}`);
}

const existingModal = `      <FollowupExcelImportModal
        open={excelImportOpen}
        onClose={() => setExcelImportOpen(false)}
        onImported={() => void loadWorkspace({ silent: true })}
        defaultBranch={branch}
        allowAllBranches={managerView}
      />`;
const resultsModal = `      <FollowupResultsExcelImportModal
        open={resultsExcelImportOpen}
        onClose={() => setResultsExcelImportOpen(false)}
        onImported={() => void loadWorkspace({ silent: true })}
        branch={branch}
      />`;
if (!source.includes('<FollowupResultsExcelImportModal')) {
  if (!source.includes(existingModal)) throw new Error('[followup-results-import] modal anchor not found');
  source = source.replace(existingModal, `${existingModal}\n${resultsModal}`);
}

for (const required of [importLine, 'resultsExcelImportOpen', 'رفع نتائج متابعة 500+', '<FollowupResultsExcelImportModal']) {
  if (!source.includes(required)) throw new Error(`[followup-results-import] missing ${required}`);
}

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('[followup-results-import] UI applied');
} else {
  console.log('[followup-results-import] already applied');
}
