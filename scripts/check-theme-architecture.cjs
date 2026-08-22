#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const CANONICAL_WRITER = path.normalize('src/contexts/ThemeContext.tsx');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const LEGACY_SHARED_CHROME_HEX_BASELINE = new Map([
  ['src/components/layout/Header.tsx', 0],
  ['src/components/layout/Sidebar.tsx', 0],
]);

const writerPatterns = [
  /document\.documentElement[\s\S]{0,240}(?:classList\.(?:add|remove|toggle)|dataset\.theme|setAttribute\(\s*['"]data-theme['"])/m,
  /(?:classList\.(?:add|remove|toggle)|dataset\.theme|setAttribute\(\s*['"]data-theme['"])[\s\S]{0,240}document\.documentElement/m,
  /localStorage\.setItem\(\s*['"]dawaa_theme['"]/m,
  /localStorage\.removeItem\(\s*['"]dawaa_theme['"]/m,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function repoPath(file) {
  return path.normalize(path.relative(ROOT, file));
}

const violations = [];
for (const file of walk(SRC)) {
  const rel = repoPath(file);
  if (rel === CANONICAL_WRITER) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of writerPatterns) {
    if (pattern.test(text)) {
      violations.push(`${rel}: runtime theme writer`);
      break;
    }
  }
}

const mainPath = path.join(SRC, 'main.tsx');
const mainText = fs.readFileSync(mainPath, 'utf8');
const expectedThemeImports = [
  "./styles/dawaa-theme.css",
  "./styles/dawaa-theme-tokens.css",
  "./styles/dawaa-theme-foundation.css",
  "./styles/dawaa-theme-palettes.css",
  "./styles/dawaa-theme-components.css",
  "./styles/dawaa-theme-shell.css",
];
let previousIndex = -1;
for (const importPath of expectedThemeImports) {
  const index = mainText.indexOf(importPath);
  if (index < 0) {
    violations.push(`src/main.tsx: missing canonical theme layer ${importPath}`);
    continue;
  }
  if (index <= previousIndex) {
    violations.push(`src/main.tsx: canonical theme layer order is invalid near ${importPath}`);
  }
  previousIndex = index;
}

const hardcodedPalette = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g;

for (const rel of [
  'src/styles/dawaa-theme.css',
  'src/styles/dawaa-theme-components.css',
  'src/styles/dawaa-theme-tokens.css',
  'src/styles/dawaa-theme-shell.css',
  'src/styles/dawaa-design-system.css',
  'src/styles/v3-polish.css',
  'src/styles/customer-service-followups.css',
  'src/styles/customer-cashback-polish.css',
  'src/styles/reviews-modal-polish.css',
]) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const colors = text.match(hardcodedPalette) || [];
  if (colors.length) violations.push(`${rel}: contains ${colors.length} hard-coded palette color(s)`);
  if (/\.light-mode|data-palette=|\[data-palette/.test(text)) {
    violations.push(`${rel}: contains retired legacy theme selector(s)`);
  }
}

const palettesPath = path.join(SRC, 'styles', 'dawaa-theme-palettes.css');
if (!fs.existsSync(palettesPath)) {
  violations.push('src/styles/dawaa-theme-palettes.css: canonical palette owner is missing');
} else {
  const palettesText = fs.readFileSync(palettesPath, 'utf8');
  for (const theme of ['dark', 'light', 'pharmacy-green']) {
    if (!palettesText.includes(`data-theme='${theme}'`)) {
      violations.push(`src/styles/dawaa-theme-palettes.css: missing palette contract for ${theme}`);
    }
  }
  for (const semanticVar of [
    '--dawaa-theme-bg', '--dawaa-theme-surface', '--dawaa-theme-surface-2',
    '--dawaa-theme-surface-raised', '--dawaa-theme-text', '--dawaa-theme-heading',
    '--dawaa-theme-muted', '--dawaa-theme-primary', '--dawaa-theme-border',
    '--dawaa-theme-sidebar', '--dawaa-status-success-bg', '--dawaa-status-warning-bg',
    '--dawaa-status-danger-bg', '--dawaa-status-info-bg',
  ]) {
    if (!palettesText.includes(semanticVar)) {
      violations.push(`src/styles/dawaa-theme-palettes.css: missing semantic palette variable ${semanticVar}`);
    }
  }
}

const themeContextText = fs.readFileSync(path.join(SRC, 'contexts', 'ThemeContext.tsx'), 'utf8');
if (/light\s*:\s*\[[^\]]*['"]light-mode['"]/.test(themeContextText)
  || /pharmacy-green['"]?\s*:\s*\[[^\]]*['"]light-mode['"]/.test(themeContextText)) {
  violations.push('src/contexts/ThemeContext.tsx: canonical theme map activates legacy light-mode');
}

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (/dataset\.palette\s*=|classList\.add\([^)]*['"]light-mode['"]|setAttribute\(\s*['"]data-palette['"]/.test(indexHtml)) {
  violations.push('index.html: bootstrap activates legacy palette/light-mode engine');
}

for (const [rel, baseline] of LEGACY_SHARED_CHROME_HEX_BASELINE) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const count = (text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  if (count > baseline) violations.push(`${rel}: hard-coded hex debt increased (${count} > ${baseline})`);
}

if (violations.length) {
  console.error('Theme architecture violation:');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Theme architecture OK: one data-theme runtime, canonical palette ownership, palette-neutral global/legacy utilities, canonical bootstrap, and zero hard-coded chrome hex colors verified.');
