#!/usr/bin/env node
const fs = require('node:fs');

const customerFile = 'src/pages/CustomerRequests.tsx';
const appFile = 'src/App.tsx';
const auditFile = 'scripts/audit-theme-debt.cjs';

function semanticVar(kind, family, shadeRaw, opacityRaw) {
  const shade = Number(shadeRaw || 0);
  const opacity = opacityRaw ? Number(opacityRaw) : null;
  const neutral = new Set(['slate','gray','zinc','neutral','stone','white','black']);
  const accent = new Set(['teal','cyan']);
  const success = new Set(['green','emerald','lime']);
  const warning = new Set(['amber','yellow','orange']);
  const danger = new Set(['red','rose','pink']);
  const info = new Set(['sky','blue','indigo','violet','purple','fuchsia']);

  if (neutral.has(family)) {
    if (kind === 'bg') {
      if (family === 'black') return 'bg-[var(--dawaa-theme-overlay)]';
      if (family === 'white') return 'bg-[var(--dawaa-theme-surface)]';
      if (shade >= 900) return 'bg-[var(--dawaa-theme-surface)]';
      if (shade >= 700) return 'bg-[var(--dawaa-theme-surface-2)]';
      return 'bg-[var(--dawaa-theme-soft)]';
    }
    if (kind === 'text') {
      if (family === 'white' || shade <= 200 && shade > 0) return 'text-[var(--dawaa-theme-heading)]';
      if (shade >= 500) return 'text-[var(--dawaa-theme-muted)]';
      return 'text-[var(--dawaa-theme-text)]';
    }
    if (kind === 'border') return 'border-[var(--dawaa-theme-border)]';
    if (kind === 'ring') return 'ring-[var(--dawaa-theme-focus)]';
    if (kind === 'divide') return 'divide-[var(--dawaa-theme-divider)]';
    if (kind === 'placeholder') return 'placeholder:text-[var(--dawaa-theme-muted)]';
    if (['from','via','to'].includes(kind)) return `${kind}-[var(--dawaa-theme-surface-2)]`;
  }

  if (accent.has(family)) {
    if (kind === 'bg') {
      if (opacity !== null || shade && shade < 500) return 'bg-[var(--dawaa-theme-accent-soft)]';
      return 'bg-[var(--dawaa-theme-primary)]';
    }
    if (kind === 'text') return 'text-[var(--dawaa-theme-primary)]';
    if (kind === 'border') return 'border-[var(--dawaa-theme-accent-border)]';
    if (kind === 'ring') return 'ring-[var(--dawaa-theme-focus)]';
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

function semanticizeUtilities(source) {
  const re = /((?:[a-z-]+:)*)((?:bg|text|border|ring|from|via|to|divide|placeholder))-(white|black|slate|gray|zinc|neutral|stone|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?/g;
  source = source.replace(re, (full, variants, kind, family, shade, opacity) => {
    const mapped = semanticVar(kind, family, shade, opacity);
    if (!mapped) return full;
    if (!variants) return mapped;
    // placeholder mapping already includes placeholder: prefix.
    if (kind === 'placeholder') return variants + mapped;
    return variants + mapped;
  });

  source = source
    .replaceAll('ring-offset-[#0b1f36]', 'ring-offset-[var(--dawaa-theme-surface)]')
    .replaceAll('ring-offset-[#06131f]', 'ring-offset-[var(--dawaa-theme-surface)]')
    .replace(/shadow-\[[^\]]*rgba\([^\]]+\)\]/g, 'shadow-[0_0_12px_var(--dawaa-theme-focus)]')
    .replace(/bg-\[#[0-9a-fA-F]{3,8}\]/g, 'bg-[var(--dawaa-theme-surface)]')
    .replace(/text-\[#[0-9a-fA-F]{3,8}\]/g, 'text-[var(--dawaa-theme-text)]')
    .replace(/border-\[#[0-9a-fA-F]{3,8}\]/g, 'border-[var(--dawaa-theme-border)]')
    .replace(/from-\[#[0-9a-fA-F]{3,8}\]/g, 'from-[var(--dawaa-theme-surface-2)]')
    .replace(/via-\[#[0-9a-fA-F]{3,8}\]/g, 'via-[var(--dawaa-theme-surface-2)]')
    .replace(/to-\[#[0-9a-fA-F]{3,8}\]/g, 'to-[var(--dawaa-theme-surface-2)]');

  // Primary actions need the canonical contrast text rather than page heading text.
  source = source.replace(/bg-\[var\(--dawaa-theme-primary\)\]([^"'`]{0,220})text-\[var\(--dawaa-theme-heading\)\]/g,
    'bg-[var(--dawaa-theme-primary)]$1text-[var(--dawaa-theme-primary-text)]');
  source = source.replace(/text-\[var\(--dawaa-theme-heading\)\]([^"'`]{0,220})bg-\[var\(--dawaa-theme-primary\)\]/g,
    'text-[var(--dawaa-theme-primary-text)]$1bg-[var(--dawaa-theme-primary)]');

  return source;
}

function migrateApp() {
  let source = fs.readFileSync(appFile, 'utf8');
  const replacement = `function PageLoadingFallback({ pageName }: { pageName: string }) {
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    const timerId = window.setTimeout(() => setIsSlow(true), 8000);
    return () => window.clearTimeout(timerId);
  }, []);

  if (isSlow) {
    return <div className="dawaa-card dawaa-card--raised p-6 text-center" dir="rtl">
      <div className="dawaa-icon-tile mx-auto text-2xl">⚠️</div>
      <h2 className="dawaa-title mt-3 text-xl">تعذر تحميل {pageName}</h2>
      <p className="dawaa-body mx-auto mt-2 max-w-2xl text-sm leading-7">استغرق تحميل هذه الصفحة أكثر من المعتاد. التطبيق ما زال يعمل، ويمكنك فتح التشخيص أو تسجيل الدخول من جديد.</p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button onClick={() => window.location.reload()} className="dawaa-button dawaa-button--primary px-5 py-3 text-sm font-black">إعادة المحاولة</button>
        <a href={diagnosticsUrl('route_slow_loading')} className="dawaa-button dawaa-button--secondary px-5 py-3 text-sm font-black">فتح التشخيص</a>
        <a href={loginRecoveryUrl('route_slow_loading')} className="dawaa-button dawaa-button--ghost px-5 py-3 text-sm font-black">تسجيل الدخول</a>
      </div>
    </div>;
  }

  return <div className="dawaa-card dawaa-card--soft p-6" dir="rtl">
    <div className="flex items-center gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-[var(--dawaa-theme-border)] border-t-[var(--dawaa-theme-primary)]" />
      <div className="dawaa-body text-sm font-black">جاري تحميل {pageName}...</div>
    </div>
    <div className="mt-5 grid gap-3 md:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-[var(--dawaa-theme-soft)]" />)}</div>
  </div>;
}

function routeSuspense`;
  const next = source.replace(/function PageLoadingFallback\([\s\S]*?\n}\n\nfunction routeSuspense/, replacement);
  if (next === source) throw new Error('Could not replace PageLoadingFallback in App.tsx');
  source = next
    .replaceAll('className="stat-card text-center text-slate-300 py-16"', 'className="dawaa-card dawaa-card--soft dawaa-body py-16 text-center"');
  fs.writeFileSync(appFile, source);
}

function migrateCustomerRequests() {
  let source = fs.readFileSync(customerFile, 'utf8');
  source = semanticizeUtilities(source);

  source = source
    .replace("return { label: 'عاجل', className: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' };", "return { label: 'عاجل', className: 'dawaa-badge dawaa-badge--danger' };")
    .replace("return { label: 'مهم', className: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' };", "return { label: 'مهم', className: 'dawaa-badge dawaa-badge--warning' };")
    .replace("return { label: 'عادي', className: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-text)]' };", "return { label: 'عادي', className: 'dawaa-badge' };")
    .replace(/className="min-h-screen[^\"]*"/g, 'className="dawaa-page min-h-screen"');

  fs.writeFileSync(customerFile, source);
}

function maybeLockZeroDebt() {
  const source = fs.readFileSync(customerFile, 'utf8');
  const paletteUtility = /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|white|black|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald)(?:-|\/|\b)/g;
  const hardcodedColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  const paletteCount = (source.match(paletteUtility) || []).length;
  const colorCount = (source.match(hardcodedColor) || []).length;
  console.log(`[customer-requests-theme] remaining palette utilities=${paletteCount}, hardcoded colors=${colorCount}`);
  if (paletteCount || colorCount) return;

  let audit = fs.readFileSync(auditFile, 'utf8');
  if (!audit.includes("'src/pages/CustomerRequests.tsx',")) {
    audit = audit.replace("const CLEAN_UI_FILES = new Set([", "const CLEAN_UI_FILES = new Set([\n  'src/pages/CustomerRequests.tsx',");
    fs.writeFileSync(auditFile, audit);
  }
}

migrateApp();
migrateCustomerRequests();
maybeLockZeroDebt();
console.log('Customer Requests theme source migration completed.');
