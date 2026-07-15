const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/components/layout/Sidebar.tsx');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`doctor-quick-action-modals: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
  `import { isDoctorRole } from '@/lib/security/userDataScope';`,
  `import { isDoctorRole } from '@/lib/security/userDataScope';\nimport QuickFollowupModal from '@/components/common/QuickFollowupModal';\nimport CustomerCodingRequestModal from '@/components/common/CustomerCodingRequestModal';`,
  'modal imports'
);

replaceOnce(
  `  const pendingShiftNotes = usePendingShiftNotesCount();`,
  `  const pendingShiftNotes = usePendingShiftNotesCount();\n  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);\n  const [customerCodingOpen, setCustomerCodingOpen] = useState(false);`,
  'modal state'
);

replaceOnce(
  `    <div className="flex h-full flex-col">`,
  `    <>\n      <QuickFollowupModal open={quickFollowupOpen} onClose={() => setQuickFollowupOpen(false)} />\n      <CustomerCodingRequestModal open={customerCodingOpen} onClose={() => setCustomerCodingOpen(false)} />\n      <div className="flex h-full flex-col">`,
  'modal render start'
);

replaceOnce(
  `      </div>\n  );\n}`,
  `      </div>\n    </>\n  );\n}`,
  'modal render end'
);

source = source.replace(
  `onClick={() => goTo('/customer-service?quickFollowup=1')}`,
  `onClick={() => setQuickFollowupOpen(true)}`
);
source = source.replace(
  `onClick={() => goTo('/customer-coding')}`,
  `onClick={() => setCustomerCodingOpen(true)}`
);

fs.writeFileSync(filePath, source);
console.log('[doctor-quick-action-modals] applied');
