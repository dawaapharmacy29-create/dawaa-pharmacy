#!/usr/bin/env node
const fs = require('node:fs');

const files = [
  'src/components/customer-requests/CustomerRequestInsightsPanel.tsx',
  'src/components/customer-requests/CustomerRequestQualityCenter.tsx',
  'src/components/customer-requests/CustomerRequestWarehousePanel.tsx',
  'src/components/customer-requests/CustomerRequestCriticalToday.tsx',
  'src/components/customer-requests/CustomerRequestDataQualityPanel.tsx',
  'src/components/customer-requests/CustomerRequestActionQueue.tsx',
  'src/components/customer-requests/CustomerRequestSyncHealthPanel.tsx',
  'src/components/customer-requests/CustomerRequestSourceAuditPanel.tsx',
];
const auditFile = 'scripts/audit-theme-debt.cjs';

const neutral = new Set(['slate','gray','zinc','neutral','stone','white','black']);
const accent = new Set(['teal','cyan']);
const success = new Set(['green','emerald','lime']);
const warning = new Set(['amber','yellow','orange']);
const danger = new Set(['red','rose','pink']);
const info = new Set(['sky','blue','indigo','violet','purple','fuchsia']);

function mapUtility(kind, family, shadeRaw, opacityRaw) {
  const shade = Number(shadeRaw || 0);
  const opacity = opacityRaw ? Number(opacityRaw) : null;
  if (neutral.has(family)) {
    if (kind === 'bg') {
      if (family === 'black') return 'bg-[var(--dawaa-theme-overlay)]';
      if (family === 'white') return 'bg-[var(--dawaa-theme-surface)]';
      if (shade >= 900) return 'bg-[var(--dawaa-theme-surface)]';
      if (shade >= 700) return 'bg-[var(--dawaa-theme-surface-2)]';
      return 'bg-[var(--dawaa-theme-soft)]';
    }
    if (kind === 'text') {
      if (family === 'white' || (shade > 0 && shade <= 200)) return 'text-[var(--dawaa-theme-heading)]';
      if (shade >= 400) return 'text-[var(--dawaa-theme-muted)]';
      return 'text-[var(--dawaa-theme-text)]';
    }
    if (kind === 'border') return 'border-[var(--dawaa-theme-border)]';
    if (kind === 'ring') return 'ring-[var(--dawaa-theme-focus)]';
    if (kind === 'divide') return 'divide-[var(--dawaa-theme-divider)]';
    if (kind === 'placeholder') return 'placeholder:text-[var(--dawaa-theme-muted)]';
    if (['from','via','to'].includes(kind)) return `${kind}-[var(--dawaa-theme-surface-2)]`;
  }
  if (accent.has(family)) {
    if (kind === 'bg') return opacity !== null || (shade && shade < 500)
      ? 'bg-[var(--dawaa-theme-accent-soft)]'
      : 'bg-[var(--dawaa-theme-primary)]';
    if (kind === 'text') return 'text-[var(--dawaa-theme-primary)]';
    if (kind === 'border') return 'border-[var(--dawaa-theme-accent-border)]';
    if (kind === 'ring') return 'ring-[var(--dawaa-theme-focus)]';
    if (kind === 'divide') return 'divide-[var(--dawaa-theme-accent-border)]';
    if (kind === 'placeholder') return 'placeholder:text-[var(--dawaa-theme-primary)]';
    if (['from','via','to'].includes(kind)) return `${kind}-[var(--dawaa-theme-accent-soft)]`;
  }
  const status = success.has(family) ? 'success' : warning.has(family) ? 'warning' : danger.has(family) ? 'danger' : info.has(family) ? 'info' : null;
  if (status) {
    if (kind === 'bg') return `bg-[var(--dawaa-status-${status}-bg)]`;
    if (kind === 'text') return `text-[var(--dawaa-status-${status}-text)]`;
    if (kind === 'border') return `border-[var(--dawaa-status-${status}-border)]`;
    if (kind === 'ring') return `ring-[var(--dawaa-status-${status}-border)]`;
    if (kind === 'divide') return `divide-[var(--dawaa-status-${status}-border)]`;
    if (kind === 'placeholder') return `placeholder:text-[var(--dawaa-status-${status}-text)]`;
    if (['from','via','to'].includes(kind)) return `${kind}-[var(--dawaa-status-${status}-bg)]`;
  }
  return null;
}

function transform(source) {
  const utility = /((?:[a-z-]+:)*)((?:bg|text|border|ring|from|via|to|divide|placeholder))-(white|black|slate|gray|zinc|neutral|stone|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?/g;
  source = source.replace(utility, (full, variants, kind, family, shade, opacity) => {
    const mapped = mapUtility(kind, family, shade, opacity);
    if (!mapped) return full;
    return variants + mapped;
  });
  source = source
    .replaceAll('ring-offset-[#0b1f36]', 'ring-offset-[var(--dawaa-theme-surface)]')
    .replaceAll('ring-offset-[#06131f]', 'ring-offset-[var(--dawaa-theme-surface)]')
    .replace(/bg-\[#[0-9a-fA-F]{3,8}\]/g, 'bg-[var(--dawaa-theme-surface)]')
    .replace(/text-\[#[0-9a-fA-F]{3,8}\]/g, 'text-[var(--dawaa-theme-text)]')
    .replace(/border-\[#[0-9a-fA-F]{3,8}\]/g, 'border-[var(--dawaa-theme-border)]')
    .replace(/from-\[#[0-9a-fA-F]{3,8}\]/g, 'from-[var(--dawaa-theme-surface-2)]')
    .replace(/via-\[#[0-9a-fA-F]{3,8}\]/g, 'via-[var(--dawaa-theme-surface-2)]')
    .replace(/to-\[#[0-9a-fA-F]{3,8}\]/g, 'to-[var(--dawaa-theme-surface-2)]')
    .replace(/shadow-\[[^\]]*rgba\([^\]]+\)\]/g, 'shadow-[0_0_12px_var(--dawaa-theme-focus)]');
  source = source.replace(/bg-\[var\(--dawaa-theme-primary\)\]([^"'`]{0,220})text-\[var\(--dawaa-theme-heading\)\]/g,
    'bg-[var(--dawaa-theme-primary)]$1text-[var(--dawaa-theme-primary-text)]');
  return source;
}

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after);
}

const paletteUtility = /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-|\/|\b)/g;
const hardcodedColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
let audit = fs.readFileSync(auditFile, 'utf8');
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const paletteCount = (text.match(paletteUtility) || []).length;
  const colorCount = (text.match(hardcodedColor) || []).length;
  console.log(`[customer-request-components-theme] ${file}: palette=${paletteCount}, colors=${colorCount}`);
  if (paletteCount === 0 && colorCount === 0 && !audit.includes(`'${file}',`)) {
    audit = audit.replace('const CLEAN_UI_FILES = new Set([', `const CLEAN_UI_FILES = new Set([\n  '${file}',`);
  }
}
fs.writeFileSync(auditFile, audit);
console.log('Customer request component theme migration completed.');
