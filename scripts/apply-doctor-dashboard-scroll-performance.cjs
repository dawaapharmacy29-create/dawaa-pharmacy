const fs = require('fs');
const path = require('path');

function patch(relativePath, transform) {
  const filePath = path.join(process.cwd(), relativePath);
  const current = fs.readFileSync(filePath, 'utf8');
  const next = transform(current);
  if (next !== current) fs.writeFileSync(filePath, next);
}

patch('src/pages/DoctorDashboard.tsx', (source) => {
  source = source.replace(
    `  const [serviceRulesOpen, setServiceRulesOpen] = useState(true);`,
    `  const [serviceRulesOpen, setServiceRulesOpen] = useState(false);`
  );
  source = source.replace(
    `<div className="space-y-6" dir="rtl">`,
    `<div className="doctor-dashboard-page space-y-6" dir="rtl">`
  );
  source = source.replace(
    `target.scrollIntoView({ behavior: 'smooth', block: 'start' });`,
    `target.scrollIntoView({ behavior: 'auto', block: 'start' });`
  );
  return source;
});

patch('src/index.css', (source) => {
  const marker = `/* Doctor dashboard scroll performance */`;
  if (source.includes(marker)) return source;
  return `${source}\n\n${marker}\n.doctor-dashboard-page > section {\n  content-visibility: auto;\n  contain: layout paint style;\n  contain-intrinsic-size: auto 520px;\n}\n\n.doctor-dashboard-page > section:first-of-type,\n.doctor-dashboard-page > section:nth-of-type(2) {\n  content-visibility: visible;\n  contain: none;\n}\n\n.doctor-dashboard-page img,\n.doctor-dashboard-page svg {\n  content-visibility: auto;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .doctor-dashboard-page *,\n  .doctor-dashboard-page *::before,\n  .doctor-dashboard-page *::after {\n    scroll-behavior: auto !important;\n    transition-duration: 0.01ms !important;\n    animation-duration: 0.01ms !important;\n  }\n}\n`;
});

console.log('[doctor-dashboard-scroll-performance] applied');
