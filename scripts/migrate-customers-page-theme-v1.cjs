#!/usr/bin/env node
const fs = require('node:fs');

const files = [
  'src/pages/Customers.tsx',
  'src/components/customers/CustomerQuickDetailsModal.tsx',
];
const auditFile = 'scripts/audit-theme-debt.cjs';
const paletteUtility = /\b(bg|text|border|ring|from|to|via)-(slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-(\d{2,3}))?(?:\/(\d+))?/g;

function replacement(kind, family, shadeRaw) {
  const shade = Number(shadeRaw || 0);
  const neutral = /^(slate|gray|zinc|neutral|stone|white|black)$/.test(family);
  const danger = /^(red|rose|pink)$/.test(family);
  const warning = /^(amber|yellow|orange)$/.test(family);
  const success = /^(green|emerald|lime)$/.test(family);
  const primary = /^(teal|cyan)$/.test(family);

  if (kind === 'text') {
    if (danger) return 'text-[var(--dawaa-status-danger-text)]';
    if (warning) return 'text-[var(--dawaa-status-warning-text)]';
    if (success) return 'text-[var(--dawaa-status-success-text)]';
    if (primary) return 'text-[var(--dawaa-theme-primary)]';
    if (!neutral) return 'text-[var(--dawaa-status-info-text)]';
    if (family === 'white' || shade >= 700) return 'text-[var(--dawaa-theme-heading)]';
    return 'text-[var(--dawaa-theme-muted)]';
  }
  if (kind === 'bg' || kind === 'from' || kind === 'to' || kind === 'via') {
    if (danger) return `${kind}-[var(--dawaa-status-danger-bg)]`;
    if (warning) return `${kind}-[var(--dawaa-status-warning-bg)]`;
    if (success) return `${kind}-[var(--dawaa-status-success-bg)]`;
    if (primary) return `${kind}-[var(--dawaa-theme-accent-soft)]`;
    if (!neutral) return `${kind}-[var(--dawaa-status-info-bg)]`;
    return `${kind}-[var(--dawaa-theme-surface-2)]`;
  }
  if (kind === 'border' || kind === 'ring') {
    if (danger) return `${kind}-[var(--dawaa-status-danger-border)]`;
    if (warning) return `${kind}-[var(--dawaa-status-warning-border)]`;
    if (success) return `${kind}-[var(--dawaa-status-success-border)]`;
    if (primary) return `${kind}-[var(--dawaa-theme-accent-border)]`;
    if (!neutral) return `${kind}-[var(--dawaa-status-info-border)]`;
    return `${kind}-[var(--dawaa-theme-border)]`;
  }
  return `${kind}-[var(--dawaa-theme-border)]`;
}

function migrate(source) {
  return source
    .replace(paletteUtility, (_m, kind, family, shade) => replacement(kind, family, shade))
    .replace(/bg-\[#[0-9a-fA-F]{3,8}\]/g, 'bg-[var(--dawaa-theme-surface)]')
    .replace(/border-\[#[0-9a-fA-F]{3,8}\]/g, 'border-[var(--dawaa-theme-border)]')
    .replace(/text-\[#[0-9a-fA-F]{3,8}\]/g, 'text-[var(--dawaa-theme-heading)]')
    .replace(/ring-offset-\[#[0-9a-fA-F]{3,8}\]/g, 'ring-offset-[var(--dawaa-theme-surface)]')
    .replace(/shadow-\[[^\]]*(?:rgba?\([^\]]*\)|#[0-9a-fA-F]{3,8})[^\]]*\]/g, 'shadow-[var(--dawaa-theme-shadow-soft)]');
}

const hardcodedColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const stillPalette = /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-|\/|\b)/g;
const clean = [];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const next = migrate(source);
  fs.writeFileSync(file, next);
  if (!(next.match(stillPalette) || []).length && !(next.match(hardcodedColor) || []).length) clean.push(file);
}

let audit = fs.readFileSync(auditFile, 'utf8');
for (const file of clean.reverse()) {
  if (!audit.includes(`  '${file}',`)) {
    audit = audit.replace('const CLEAN_UI_FILES = new Set([\n', `const CLEAN_UI_FILES = new Set([\n  '${file}',\n`);
  }
}
fs.writeFileSync(auditFile, audit);
console.log(`[customers-page-theme] clean=${clean.length}/${files.length}`);
if (clean.length !== files.length) process.exitCode = 2;
