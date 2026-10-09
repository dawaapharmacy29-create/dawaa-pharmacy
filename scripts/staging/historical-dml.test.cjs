const { describe, it, expect } = require('vitest');

describe('staging historical DML exclusion', () => {
  it('excludes each pinned one-time write across platform line endings', async () => {
    const { extractDdl, HISTORICAL_DML } = await import('./historical-dml.mjs');
    const { splitStatements, statementKind } = await import('./sql-statements.mjs');
    const root = process.cwd();

    for (const entry of HISTORICAL_DML) {
      const result = extractDdl(root, entry.migration);
      expect(result.excluded).toHaveLength(Object.keys(entry.statements).length);
      expect(
        splitStatements(result.sql).some((statement) => statementKind(statement.text) === 'dml')
      ).toBe(false);
    }
  });
});
