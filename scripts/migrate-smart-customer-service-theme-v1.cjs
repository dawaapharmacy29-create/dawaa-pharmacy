#!/usr/bin/env node
const fs = require('node:fs');

const page = 'src/pages/SmartCustomerService.tsx';
const audit = 'scripts/audit-theme-debt.cjs';
let src = fs.readFileSync(page, 'utf8');
let auditSrc = fs.readFileSync(audit, 'utf8');

const families = '(?:slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)';
const utility = new RegExp(`\\b(bg|text|border|ring)-(${families.slice(3, -1)})(?:-(\\d{2,3}))?(?:\\/(\\d{1,3}))?`, 'g');

function map(kind, family, shadeRaw) {
  const shade = Number(shadeRaw || 0);
  const neutral = ['slate','gray','zinc','neutral','stone','white','black'].includes(family);
  const primary = ['teal','cyan'].includes(family);
  const success = ['green','emerald','lime'].includes(family);
  const warning = ['amber','yellow','orange'].includes(family);
  const danger = ['red','rose','pink'].includes(family);
  const info = ['sky','blue','indigo','violet','purple','fuchsia'].includes(family);

  if (kind === 'bg') {
    if (neutral) return shade >= 800 || family === 'black' ? 'bg-[var(--dawaa-theme-surface)]' : 'bg-[var(--dawaa-theme-surface-2)]';
    if (primary) return 'bg-[var(--dawaa-theme-accent-soft)]';
    if (success) return 'bg-[var(--dawaa-status-success-bg)]';
    if (warning) return 'bg-[var(--dawaa-status-warning-bg)]';
    if (danger) return 'bg-[var(--dawaa-status-danger-bg)]';
    if (info) return 'bg-[var(--dawaa-status-info-bg)]';
  }
  if (kind === 'text') {
    if (neutral) {
      if (family === 'white' || shade >= 700) return 'text-[var(--dawaa-theme-heading)]';
      if (shade >= 500) return 'text-[var(--dawaa-theme-muted)]';
      return 'text-[var(--dawaa-theme-text)]';
    }
    if (primary) return 'text-[var(--dawaa-theme-primary)]';
    if (success) return 'text-[var(--dawaa-status-success-text)]';
    if (warning) return 'text-[var(--dawaa-status-warning-text)]';
    if (danger) return 'text-[var(--dawaa-status-danger-text)]';
    if (info) return 'text-[var(--dawaa-status-info-text)]';
  }
  if (kind === 'border' || kind === 'ring') {
    if (neutral) return `${kind}-[var(--dawaa-theme-border)]`;
    if (primary) return `${kind}-[var(--dawaa-theme-accent-border)]`;
    if (success) return `${kind}-[var(--dawaa-status-success-border)]`;
    if (warning) return `${kind}-[var(--dawaa-status-warning-border)]`;
    if (danger) return `${kind}-[var(--dawaa-status-danger-border)]`;
    if (info) return `${kind}-[var(--dawaa-status-info-border)]`;
  }
  return `${kind}-${family}${shadeRaw ? `-${shadeRaw}` : ''}`;
}

src = src
  .replaceAll('bg-[#071827]/95', 'bg-[var(--dawaa-theme-surface-raised)]')
  .replaceAll('shadow-black/20', '')
  .replace(/\bbg-white\/\[[^\]]+\]/g, 'bg-[var(--dawaa-theme-surface-2)]')
  .replace(utility, (_m, kind, family, shade) => map(kind, family, shade));

const leftovers = src.match(/\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-|\/|\b)|#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
if (leftovers.length) throw new Error(`SmartCustomerService theme leftovers: ${[...new Set(leftovers)].join(', ')}`);

const cleanAnchor = "const CLEAN_UI_FILES = new Set([\n";
if (!auditSrc.includes("'src/pages/SmartCustomerService.tsx'")) {
  if (!auditSrc.includes(cleanAnchor)) throw new Error('theme clean-list anchor missing');
  auditSrc = auditSrc.replace(cleanAnchor, `${cleanAnchor}  'src/pages/SmartCustomerService.tsx',\n`);
}

fs.writeFileSync(page, src);
fs.writeFileSync(audit, auditSrc);
console.log('SmartCustomerService semantic theme migration applied.');
