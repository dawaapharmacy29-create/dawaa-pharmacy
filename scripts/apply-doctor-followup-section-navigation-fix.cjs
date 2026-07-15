const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorDashboard.tsx');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`doctor-followup-section-navigation: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
  `import { toast } from 'sonner';`,
  `import { toast } from 'sonner';\nimport { useLocation } from 'react-router-dom';`,
  'location import'
);

replaceOnce(
  `export default function DoctorDashboard() {\n  const { user } = useAuth();`,
  `export default function DoctorDashboard() {\n  const { user } = useAuth();\n  const location = useLocation();`,
  'location hook'
);

replaceOnce(
  `  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);`,
  `  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);\n\n  useEffect(() => {\n    const section = new URLSearchParams(location.search).get('section');\n    if (!section) return;\n    const targetId = section === 'followups' ? 'my-followups' : section;\n    let attempts = 0;\n    const scrollToSection = () => {\n      const target = document.getElementById(targetId);\n      if (target) {\n        target.scrollIntoView({ behavior: 'smooth', block: 'start' });\n        target.focus({ preventScroll: true });\n        return;\n      }\n      attempts += 1;\n      if (attempts < 12) window.setTimeout(scrollToSection, 120);\n    };\n    window.setTimeout(scrollToSection, 50);\n  }, [location.search]);`,
  'section scroll effect'
);

replaceOnce(
  `<section id="my-followups" className="rounded-3xl border border-teal-400/20 bg-slate-900/65 p-5">`,
  `<section id="my-followups" tabIndex={-1} className="scroll-mt-24 rounded-3xl border border-teal-400/20 bg-slate-900/65 p-5 outline-none">`,
  'followup target focus and offset'
);

fs.writeFileSync(filePath, source);
require('./apply-doctor-service-discipline-rules.cjs');
console.log('[doctor-followup-section-navigation-fix] applied');
