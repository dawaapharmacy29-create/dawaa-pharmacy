#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const rows = [];

const textExts = new Set(['.css', '.ts', '.tsx', '.js', '.jsx']);
const paletteUtility = /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|white|black)(?:-|\/|\b)/g;
const hardcodedColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const important = /!important/g;
const semanticTokens = /var\(--dawaa-theme-|\b(?:dawaa-app-bg|dawaa-surface|dawaa-surface-soft|dawaa-surface-raised|dawaa-text|dawaa-heading|dawaa-muted|dawaa-border)\b/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (textExts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function count(text, re) {
  return (text.match(re) || []).length;
}

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file);
  const row = {
    file: rel,
    paletteUtilities: ext === '.css' ? 0 : count(text, paletteUtility),
    hardcodedColors: count(text, hardcodedColor),
    important: ext === '.css' ? count(text, important) : 0,
    semanticTokens: count(text, semanticTokens),
  };
  row.debt = row.paletteUtilities + row.hardcodedColors + row.important;
  if (row.debt || row.semanticTokens) rows.push(row);
}

const totals = rows.reduce((acc, row) => {
  acc.paletteUtilities += row.paletteUtilities;
  acc.hardcodedColors += row.hardcodedColors;
  acc.important += row.important;
  acc.semanticTokens += row.semanticTokens;
  return acc;
}, { paletteUtilities: 0, hardcodedColors: 0, important: 0, semanticTokens: 0 });

console.log('[theme-debt] totals');
console.log(JSON.stringify(totals, null, 2));
console.log('[theme-debt] top files');
for (const row of rows.sort((a, b) => b.debt - a.debt).slice(0, 20)) {
  console.log(`${row.debt.toString().padStart(4)} debt | ${row.paletteUtilities.toString().padStart(3)} palette | ${row.hardcodedColors.toString().padStart(3)} colors | ${row.important.toString().padStart(3)} !important | ${row.semanticTokens.toString().padStart(3)} semantic | ${row.file}`);
}

// Diagnostic only for the current legacy cleanup phase. The single-writer theme gate is enforced separately.
process.exit(0);
