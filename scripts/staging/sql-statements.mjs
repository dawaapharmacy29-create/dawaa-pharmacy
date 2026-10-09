// Minimal top-level SQL statement splitter for migration files: respects single quotes,
// double-quoted identifiers, $tag$ dollar quotes, -- and /* */ comments. Used only by the
// staging tooling to classify statements; it never rewrites SQL that it does not understand.
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') { const end = sql.indexOf('\n', i); i = end < 0 ? n : end + 1; continue; }
    if (ch === '/' && next === '*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue; }
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < n) { if (sql[i] === ch) { if (sql[i + 1] === ch) { i += 2; continue; } break; } i += 1; }
      i += 1; continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (tag) { const end = sql.indexOf(tag[0], i + tag[0].length); i = end < 0 ? n : end + tag[0].length; continue; }
    }
    if (ch === ';') { statements.push({ start, end: i + 1, text: sql.slice(start, i + 1) }); start = i + 1; }
    i += 1;
  }
  if (sql.slice(start).trim()) statements.push({ start, end: n, text: sql.slice(start) });
  return statements;
}

const stripComments = (text) => text.replace(/--[^\n]*\n?/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();

// Top-level statements that write table rows (DO blocks are reported separately for review).
export function statementKind(text) {
  const body = stripComments(text).toLowerCase();
  if (/^(with\b[\s\S]*?\)\s*)?(update|insert|delete|merge|truncate|copy)\b/.test(body)) return 'dml';
  if (/^select\b/.test(body)) return /\bfrom\b/.test(body) ? 'select' : 'select_expr';
  if (/^do\b/.test(body)) return 'do';
  if (!body) return 'empty';
  return 'ddl';
}
