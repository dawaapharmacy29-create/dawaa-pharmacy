const { describe, it, expect } = require('vitest');

describe('staging historical DML exclusion', () => {
  it('keeps archived historical writes out of every executable replacement migration', async () => {
    const { extractDdl, HISTORICAL_DML } = await import('./historical-dml.mjs');
    const { splitStatements, statementKind } = await import('./sql-statements.mjs');
    const { existsSync } = require('node:fs');
    const path = require('node:path');
    const root = process.cwd();

    for (const entry of HISTORICAL_DML) {
      const result = extractDdl(root, entry.migration);
      expect(existsSync(path.join(root, 'supabase/migrations', entry.historicalMigration))).toBe(false);
      expect(
        splitStatements(result.sql).some((statement) => statementKind(statement.text) === 'dml')
      ).toBe(false);
      expect(Object.keys(entry.statements).length).toBeGreaterThan(0);
      expect(Object.values(entry.statements).every((digest) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    }
  });
});
