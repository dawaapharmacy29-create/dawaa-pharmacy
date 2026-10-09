// Local-only SQL boundary for the existing staging runner. Native PostgreSQL remains the default.
import { spawn } from 'node:child_process';

export async function localSql(usePglite) {
  if (!usePglite) return {
    execute(db, sql, options = '') {
      const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db], {
        env: { ...process.env, PGOPTIONS: options },
      });
      return new Promise(resolve => {
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => resolve({ code: 1, stdout, stderr: error.message }));
        child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
        child.stdin.end(sql);
      });
    },
    async close() {},
  };
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const databases = new Map();
  const value = (v) => v === null ? '' : typeof v === 'boolean' ? (v ? 't' : 'f')
    : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return {
    async execute(name, sql, options = '') {
      try {
        if (name === 'postgres') {
          for (const m of sql.matchAll(/\b(drop|create) database (?:if exists )?(\w+)/gi)) {
            if (m[1].toLowerCase() === 'drop') {
              await databases.get(m[2])?.close(); databases.delete(m[2]);
            } else databases.set(m[2], new PGlite({ extensions: { pgcrypto, pg_trgm } }));
          }
          return { code: 0, stdout: '', stderr: '' };
        }
        const db = databases.get(name);
        if (!db) throw new Error(`unknown local PGlite database ${name}`);
        // Each native psql call opens a fresh session; keep the same identity/config semantics here.
        await db.exec(`reset role; reset all; set check_function_bodies=${options.includes('check_function_bodies=off') ? 'off' : 'on'}`);
        const variables = new Map();
        sql = sql.replace(/^\\set (\w+) '([^\n]*)'\s*$/gm, (_, key, literal) => {
          variables.set(key, literal.replaceAll("''", "'")); return '';
        }).replace(/^\\echo[^\n]*$/gm, '').replace(/^\\set ON_ERROR_STOP 1\s*$/gm, '');
        for (const [key, text] of variables) sql = sql.replaceAll(`:${key}`, () => text);
        if (/^\\/m.test(sql)) throw new Error('unsupported psql command in PGlite staging');
        const results = await db.exec(sql);
        return { code: 0, stdout: results.flatMap(r => r.rows.map(row => Object.values(row).map(value).join('|'))).join('\n'), stderr: '' };
      } catch (e) {
        const db = databases.get(name);
        if (db) await db.exec('rollback; reset role; reset all').catch(() => {});
        return { code: 1, stdout: '', stderr: e.message };
      }
    },
    async close() { for (const db of databases.values()) await db.close(); databases.clear(); },
  };
}
