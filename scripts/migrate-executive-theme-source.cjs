#!/usr/bin/env node
const fs = require('node:fs');

const file = 'src/pages/ExecutiveDashboard2027.tsx';
let source = fs.readFileSync(file, 'utf8');
const before = source;

function replaceAllLiteral(from, to) {
  source = source.split(from).join(to);
}

// Canonical chart ownership: charts consume theme series rather than a page palette.
replaceAllLiteral(
  "const COLORS = ['#2dd4bf', '#38bdf8', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444'];",
  "const COLORS = ['var(--dawaa-chart-series-1)', 'var(--dawaa-chart-series-2)', 'var(--dawaa-chart-series-3)', 'var(--dawaa-chart-series-4)', 'var(--dawaa-chart-series-5)', 'var(--dawaa-chart-series-6)'];"
);

// The actual runtime page owns its own canvas. Remove the historical full-screen dark overlay.
replaceAllLiteral(
  'className="executive-dashboard-page min-h-screen bg-[#06131f] text-slate-100"',
  'className="executive-dashboard-page dawaa-page min-h-screen"'
);
source = source.replace(
  /\n\s*<div className="pointer-events-none fixed inset-0 bg-\[radial-gradient\([^\n]+\]" \/>/,
  ''
);
replaceAllLiteral('bg-[#06131f]', 'bg-[var(--dawaa-theme-bg)]');
replaceAllLiteral('bg-[#0b1d31]/85', 'bg-[var(--dawaa-theme-surface)]');

// Core helpers: the page can keep its data logic, but its reusable surfaces are semantic.
source = source.replace(
  /className=\{`card rounded-3xl border border-cyan-300\/10 bg-\[var\(--dawaa-theme-surface\)\] shadow-\[0_18px_80px_rgba\(0,0,0,0\.28\)\] backdrop-blur \$\{className\}`\}/g,
  'className={`dawaa-card dawaa-card--raised rounded-3xl ${className}`}'
);
replaceAllLiteral('className="text-xl font-black text-white"', 'className="dawaa-title text-xl"');
replaceAllLiteral('className="mt-1 text-xs font-bold text-slate-400"', 'className="dawaa-caption mt-1 text-xs font-bold"');
replaceAllLiteral('className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-200"', 'className="dawaa-icon-tile p-3"');

// Neutral-first KPI cards. Tone is communicated by compact semantic accents, not full card fills.
source = source.replace(
  /const toneClass = \{[\s\S]*?\}\[tone\];\n\n  return \(/,
  `const toneClass = {\n    cyan: 'dawaa-badge--info',\n    green: 'dawaa-badge--success',\n    amber: 'dawaa-badge--warning',\n    blue: 'dawaa-badge--info',\n    purple: 'dawaa-badge--info',\n    red: 'dawaa-badge--danger',\n  }[tone];\n\n  return (`
);
source = source.replace(
  /className=\{`relative overflow-hidden rounded-3xl border bg-gradient-to-br \$\{toneClass\} p-5 transition \$\{onClick \? '[^']*' : ''\}`\}/g,
  "className={`dawaa-card dawaa-card--interactive relative overflow-hidden p-5 ${onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--dawaa-theme-focus)]' : ''}`}"
);
replaceAllLiteral('className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-white/5 blur-2xl"', 'className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-[var(--dawaa-theme-soft)] blur-2xl"');
replaceAllLiteral('className="rounded-2xl bg-slate-950/55 p-3 text-cyan-200"', 'className={`dawaa-icon-tile p-3 ${toneClass}`}');

// Generic old Tailwind palette utilities are replaced at source with canonical semantic values.
const replacements = [
  [/\btext-white\b/g, 'text-[var(--dawaa-theme-heading)]'],
  [/\btext-slate-(?:50|100|200|300)\b/g, 'text-[var(--dawaa-theme-text)]'],
  [/\btext-slate-(?:400|500|600)\b/g, 'text-[var(--dawaa-theme-muted)]'],
  [/\btext-slate-(?:700|800|900|950)\b/g, 'text-[var(--dawaa-theme-heading)]'],
  [/\bbg-slate-(?:950|900)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-theme-surface)]'],
  [/\bbg-slate-(?:800|700)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-theme-surface-2)]'],
  [/\bborder-slate-(?:950|900|800|700|600|500|400|300|200)(?:\/[0-9]+)?\b/g, 'border-[var(--dawaa-theme-border)]'],
  [/\bring-slate-(?:950|900|800|700|600|500|400|300|200)(?:\/[0-9]+)?\b/g, 'ring-[var(--dawaa-theme-border)]'],
  [/\bbg-white\/(?:5|10|15|20)\b/g, 'bg-[var(--dawaa-theme-soft)]'],
  [/\bborder-white\/(?:5|10|15|20|25|30|40)\b/g, 'border-[var(--dawaa-theme-border)]'],
  [/\btext-cyan-(?:50|100|200|300|400|500)\b/g, 'text-[var(--dawaa-theme-primary-strong)]'],
  [/\bbg-cyan-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-theme-accent-soft)]'],
  [/\bborder-cyan-(?:200|300|400|500)(?:\/[0-9]+)?\b/g, 'border-[var(--dawaa-theme-accent-border)]'],
  [/\bring-cyan-(?:200|300|400|500)(?:\/[0-9]+)?\b/g, 'ring-[var(--dawaa-theme-accent-border)]'],
  [/\bfocus:border-cyan-(?:300|400|500)\b/g, 'focus:border-[var(--dawaa-theme-primary)]'],
  [/\bhover:border-cyan-(?:200|300|400|500)(?:\/[0-9]+)?\b/g, 'hover:border-[var(--dawaa-theme-accent-border)]'],
  [/\bhover:bg-cyan-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'hover:bg-[var(--dawaa-theme-accent-soft)]'],

  [/\btext-(?:emerald|green)-(?:50|100|200|300|400|500)\b/g, 'text-[var(--dawaa-status-success-text)]'],
  [/\bbg-(?:emerald|green)-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-status-success-bg)]'],
  [/\bborder-(?:emerald|green)-(?:200|300|400|500)(?:\/[0-9]+)?\b/g, 'border-[var(--dawaa-status-success-border)]'],
  [/\bhover:bg-(?:emerald|green)-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'hover:bg-[var(--dawaa-status-success-bg)]'],

  [/\btext-(?:amber|yellow|orange)-(?:50|100|200|300|400|500)\b/g, 'text-[var(--dawaa-status-warning-text)]'],
  [/\bbg-(?:amber|yellow|orange)-(?:200|300|400|500|600)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-status-warning-bg)]'],
  [/\bborder-(?:amber|yellow|orange)-(?:100|200|300|400|500)(?:\/[0-9]+)?\b/g, 'border-[var(--dawaa-status-warning-border)]'],
  [/\bhover:bg-(?:amber|yellow|orange)-(?:200|300|400|500|600)(?:\/[0-9]+)?\b/g, 'hover:bg-[var(--dawaa-status-warning-bg)]'],

  [/\btext-(?:red|rose)-(?:50|100|200|300|400|500)\b/g, 'text-[var(--dawaa-status-danger-text)]'],
  [/\bbg-(?:red|rose)-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-status-danger-bg)]'],
  [/\bborder-(?:red|rose)-(?:200|300|400|500)(?:\/[0-9]+)?\b/g, 'border-[var(--dawaa-status-danger-border)]'],
  [/\bhover:bg-(?:red|rose)-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'hover:bg-[var(--dawaa-status-danger-bg)]'],

  [/\btext-(?:sky|blue|indigo|violet|purple)-(?:50|100|200|300|400|500)\b/g, 'text-[var(--dawaa-status-info-text)]'],
  [/\bbg-(?:sky|blue|indigo|violet|purple)-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'bg-[var(--dawaa-status-info-bg)]'],
  [/\bborder-(?:sky|blue|indigo|violet|purple)-(?:200|300|400|500)(?:\/[0-9]+)?\b/g, 'border-[var(--dawaa-status-info-border)]'],
  [/\bhover:bg-(?:sky|blue|indigo|violet|purple)-(?:300|400|500|600)(?:\/[0-9]+)?\b/g, 'hover:bg-[var(--dawaa-status-info-bg)]'],
];
for (const [pattern, replacement] of replacements) source = source.replace(pattern, replacement);

// Remove gradient tone fragments that otherwise keep a local palette on KPI cards.
source = source
  .replace(/\bfrom-(?:cyan|emerald|amber|sky|violet|red)-\d+(?:\/[0-9]+)?\b/g, '')
  .replace(/\bto-(?:cyan|emerald|amber|sky|violet|red)-\d+(?:\/[0-9]+)?\b/g, '')
  .replace(/\bbg-gradient-to-br\b/g, '')
  .replace(/\s{2,}/g, (match) => match.includes('\n') ? match : ' ');

// Hard-coded chart/UI colors outside the canonical chart contract.
source = source
  .replace(/#2dd4bf/gi, 'var(--dawaa-chart-series-1)')
  .replace(/#38bdf8/gi, 'var(--dawaa-chart-series-2)')
  .replace(/#8b5cf6/gi, 'var(--dawaa-chart-series-3)')
  .replace(/#22c55e/gi, 'var(--dawaa-chart-series-4)')
  .replace(/#f59e0b/gi, 'var(--dawaa-chart-series-5)')
  .replace(/#ef4444/gi, 'var(--dawaa-chart-series-6)');

if (source === before) {
  console.log('[executive-theme-migration] no changes needed');
  process.exit(0);
}

const oldPalette = (before.match(/\b(?:bg|text|border|ring|from|to|via)-(?:slate|white|black|teal|cyan|sky|blue|indigo|violet|purple|rose|red|amber|yellow|green|emerald)(?:-|\/|\b)/g) || []).length;
const newPalette = (source.match(/\b(?:bg|text|border|ring|from|to|via)-(?:slate|white|black|teal|cyan|sky|blue|indigo|violet|purple|rose|red|amber|yellow|green|emerald)(?:-|\/|\b)/g) || []).length;
console.log(`[executive-theme-migration] palette utilities: ${oldPalette} -> ${newPalette}`);

fs.writeFileSync(file, source);
