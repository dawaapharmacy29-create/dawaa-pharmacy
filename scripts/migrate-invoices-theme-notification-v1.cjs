#!/usr/bin/env node
const fs = require('node:fs');

const file = 'src/pages/Invoices.tsx';
const auditFile = 'scripts/audit-theme-debt.cjs';
let source = fs.readFileSync(file, 'utf8');

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

const utility = /((?:[a-z-]+:)*)((?:bg|text|border|ring|from|via|to|divide|placeholder))-(white|black|slate|gray|zinc|neutral|stone|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?/g;
source = source.replace(utility, (full, variants, kind, family, shade, opacity) => {
  const mapped = mapUtility(kind, family, shade, opacity);
  return mapped ? variants + mapped : full;
});

source = source
  .replace(/bg-\[#[0-9a-fA-F]{3,8}\]/g, 'bg-[var(--dawaa-theme-surface)]')
  .replace(/text-\[#[0-9a-fA-F]{3,8}\]/g, 'text-[var(--dawaa-theme-text)]')
  .replace(/border-\[#[0-9a-fA-F]{3,8}\]/g, 'border-[var(--dawaa-theme-border)]')
  .replace(/from-\[#[0-9a-fA-F]{3,8}\]/g, 'from-[var(--dawaa-theme-surface-2)]')
  .replace(/via-\[#[0-9a-fA-F]{3,8}\]/g, 'via-[var(--dawaa-theme-surface-2)]')
  .replace(/to-\[#[0-9a-fA-F]{3,8}\]/g, 'to-[var(--dawaa-theme-surface-2)]')
  .replace(/shadow-\[[^\]]*rgba\([^\]]+\)\]/g, 'shadow-[0_0_12px_var(--dawaa-theme-focus)]')
  .replaceAll('text-navy-900', 'text-[var(--dawaa-theme-primary-text)]')
  .replaceAll('input-dark', 'dawaa-input')
  .replaceAll('btn-primary', 'dawaa-button dawaa-button--primary')
  .replaceAll('btn-secondary', 'dawaa-button dawaa-button--secondary')
  .replaceAll('stat-card', 'dawaa-card dawaa-card--soft')
  .replaceAll('modal-backdrop', 'fixed inset-0 z-50 flex items-center justify-center bg-[var(--dawaa-theme-overlay)] p-4')
  .replaceAll('modal-panel', 'dawaa-card dawaa-card--raised w-full');

source = source.replace(/bg-\[var\(--dawaa-theme-primary\)\]([^"'`]{0,240})text-\[var\(--dawaa-theme-heading\)\]/g,
  'bg-[var(--dawaa-theme-primary)]$1text-[var(--dawaa-theme-primary-text)]');

if (!source.includes("import { createNotification } from '@/lib/notificationService';")) {
  source = source.replace(
    "import { toast } from 'sonner';",
    "import { toast } from 'sonner';\nimport { createNotification } from '@/lib/notificationService';"
  );
}

const directNotification = `await supabase.from('notifications').insert({
          title: 'استيراد ملف فواتير جديد',
          message: \`تم قراءة \${summary.distinctInvoicesInFile || summary.totalRows} فاتورة من \${fileName}. تمت إضافة \${summary.insertedRows} وتأكيد/تحديث \${summary.confirmedExistingInvoices ?? summary.updatedInvoices ?? 0}. صافي الملف \${formatCurrency(summary.fileNetSales || 0)}، وصافي الجديد + الموجود المؤكد \${formatCurrency(summary.processedNetSales ?? summary.savedNetSales ?? summary.importedNetSales ?? 0)}.\`,
          type: 'sales_import',
          severity: summary.errors.length ? 'medium' : 'info',
          entity_type: 'sales_invoices',
          entity_id: summary.importBatch,
          route_path: '/analytics',
          is_read: false,
          created_at: new Date().toISOString(),
        });`;
const canonicalNotification = `await createNotification({
          title: 'استيراد ملف فواتير جديد',
          message: \`تم قراءة \${summary.distinctInvoicesInFile || summary.totalRows} فاتورة من \${fileName}. تمت إضافة \${summary.insertedRows} وتأكيد/تحديث \${summary.confirmedExistingInvoices ?? summary.updatedInvoices ?? 0}. صافي الملف \${formatCurrency(summary.fileNetSales || 0)}، وصافي الجديد + الموجود المؤكد \${formatCurrency(summary.processedNetSales ?? summary.savedNetSales ?? summary.importedNetSales ?? 0)}.\`,
          type: 'sales_performance',
          priority: summary.errors.length ? 'high' : 'normal',
          target_type: 'sales_invoices',
          target_id: summary.importBatch,
          target_route: '/analytics',
          is_read: false,
          created_by: user?.id || null,
          created_by_name: user?.name || null,
          metadata: { import_batch: summary.importBatch, source: 'invoice_import' },
        });`;
if (source.includes(directNotification)) source = source.replace(directNotification, canonicalNotification);
else if (source.includes("supabase.from('notifications').insert")) throw new Error('Direct notification writer remains but expected block changed.');

fs.writeFileSync(file, source);

const paletteUtility = /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-|\/|\b)/g;
const hardcodedColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const migrated = fs.readFileSync(file, 'utf8');
const paletteCount = (migrated.match(paletteUtility) || []).length;
const colorCount = (migrated.match(hardcodedColor) || []).length;
console.log(`[invoices-theme] remaining palette=${paletteCount} colors=${colorCount}`);

if (paletteCount === 0 && colorCount === 0) {
  let audit = fs.readFileSync(auditFile, 'utf8');
  if (!audit.includes("'src/pages/Invoices.tsx',")) {
    audit = audit.replace('const CLEAN_UI_FILES = new Set([', "const CLEAN_UI_FILES = new Set([\n  'src/pages/Invoices.tsx',");
    fs.writeFileSync(auditFile, audit);
  }
}
console.log('Invoices theme + notification migration complete.');
