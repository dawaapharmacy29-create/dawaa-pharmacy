#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const CANONICAL_WRITER = path.normalize('src/contexts/ThemeContext.tsx');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

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
      violations.push(rel);
      break;
    }
  }
}

if (violations.length) {
  console.error('Theme architecture violation: ThemeContext must be the only runtime theme writer.');
  for (const file of [...new Set(violations)].sort()) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Theme architecture OK: ThemeContext is the single runtime theme writer.');
