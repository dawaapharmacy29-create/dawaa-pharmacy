#!/usr/bin/env node
const fs = require('node:fs');

const files = [
  'src/components/customerService/CustomerDailyPriorityQueues.tsx',
  'src/components/customerService/CustomerFollowupCockpitPanel.tsx',
  'src/components/customerService/ExceptionalFollowupCenter.tsx',
];
const auditFile = 'scripts/audit-theme-debt.cjs';

const paletteFamilies = ['slate','gray','zinc','neutral','stone','white','black','teal','cyan','sky','blue','indigo','violet','purple','fuchsia','pink','rose','red','orange','amber','yellow','lime','green','emerald'];
const familyPattern = paletteFamilies.join('|');
const utility = new RegExp(`\\b(bg|text|border|ring|from|to|via)-(${familyPattern})(?:-(\\d{2,3}))?(?:\\/(?:\\[[^\\]]+\\]|\\d{1,3}))?`, 'g');
const whiteBracketBg = new RegExp('\\bbg-white\\/\\[[^\\]]+\\]', 'g');
const arbitraryBg = new RegExp('\\bbg-\\[#[0-9a-fA-F]{3,8}\\](?:\\/\\d{1,3})?', 'g');
const arbitraryText = new RegExp('\\btext-\\[#[0-9a-fA-F]{3,8}\\](?:\\/\\d{1,3})?', 'g');
const arbitraryBorder = new RegExp('\\bborder-\\[#[0-9a-fA-F]{3,8}\\](?:\\/\\d{1,3})?', 'g');
const arbitraryRing = new RegExp('\\bring-\\[#[0-9a-fA-F]{3,8}\\](?:\\/\\d{1,3})?', 'g');
const arbitraryShadow = new RegExp('\\bshadow-\\[[^\\]]*(?:#[0-9a-fA-F]{3,8}|rgba?\\([^\\]]+\\))[^\\]]*\\]', 'g');
const debtPattern = new RegExp(`\\b(?:bg|text|border|ring|from|to|via)-(?:${familyPattern})(?:-|\\/|\\b)|#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)`, 'g');

function map(kind, family, shadeRaw) {
  const shade = Number(shadeRaw || 0);
  const neutral = ['slate','gray','zinc','neutral','stone','white','black'].includes(family);
  const primary = ['teal','cyan'].includes(family);
  const success = ['green','emerald','lime'].includes(family);
  const warning = ['amber','yellow','orange'].includes(family);
  const danger = ['red','rose','pink'].includes(family);
  const info = ['sky','blue','indigo','violet','purple','fuchsia'].includes(family);

  if (kind === 'bg') {
    if (neutral) return family === 'black' || shade >= 800 ? 'bg-[var(--dawaa-theme-surface)]' : 'bg-[var(--dawaa-theme-surface-2)]';
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
    const prefix = `${kind}-`;
    if (neutral) return `${prefix}[var(--dawaa-theme-border)]`;
    if (primary) return `${prefix}[var(--dawaa-theme-accent-border)]`;
    if (success) return `${prefix}[var(--dawaa-status-success-border)]`;
    if (warning) return `${prefix}[var(--dawaa-status-warning-border)]`;
    if (danger) return `${prefix}[var(--dawaa-status-danger-border)]`;
    if (info) return `${prefix}[var(--dawaa-status-info-border)]`;
  }
  if (kind === 'from' || kind === 'via' || kind === 'to') {
    if (neutral) return `${kind}-[var(--dawaa-theme-surface-2)]`;
    if (primary) return `${kind}-[var(--dawaa-theme-primary)]`;
    if (success) return `${kind}-[var(--dawaa-status-success-bg)]`;
    if (warning) return `${kind}-[var(--dawaa-status-warning-bg)]`;
    if (danger) return `${kind}-[var(--dawaa-status-danger-bg)]`;
    if (info) return `${kind}-[var(--dawaa-status-info-bg)]`;
  }
  return `${kind}-${family}${shadeRaw ? `-${shadeRaw}` : ''}`;
}

function migrate(source) {
  return source
    .replace(whiteBracketBg, 'bg-[var(--dawaa-theme-surface-2)]')
    .replace(arbitraryBg, 'bg-[var(--dawaa-theme-surface-raised)]')
    .replace(arbitraryText, 'text-[var(--dawaa-theme-heading)]')
    .replace(arbitraryBorder, 'border-[var(--dawaa-theme-border)]')
    .replace(arbitraryRing, 'ring-[var(--dawaa-theme-focus)]')
    .replace(arbitraryShadow, 'shadow-[var(--dawaa-theme-shadow-soft)]')
    .replace(utility, (_match, kind, family, shade) => map(kind, family, shade));
}

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const after = migrate(before);
  const leftovers = [...after.matchAll(debtPattern)];
  if (leftovers.length) {
    const samples = leftovers.slice(0, 12).map((match) => {
      const start = Math.max(0, (match.index || 0) - 80);
      const end = Math.min(after.length, (match.index || 0) + match[0].length + 80);
      return after.slice(start, end).replace(/\n/g, ' ');
    });
    throw new Error(`${file} still has ${leftovers.length} theme-debt token(s):\n${samples.join('\n---\n')}`);
  }
  fs.writeFileSync(file, after);
  console.log(`[customer-service-theme] migrated ${file}`);
}

let audit = fs.readFileSync(auditFile, 'utf8');
const anchor = 'const CLEAN_UI_FILES = new Set([\n';
if (!audit.includes(anchor)) throw new Error('theme audit clean-list anchor missing');
for (const file of files) {
  if (!audit.includes(`'${file}'`)) audit = audit.replace(anchor, `${anchor}  '${file}',\n`);
}
fs.writeFileSync(auditFile, audit);
console.log('Customer service core panels migration complete.');
