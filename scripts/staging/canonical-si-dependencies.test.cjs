const fs = require('fs');
const { describe, it, expect } = require('vitest');
const path = require('path');
const { checkCanonicalSiDependencies } = require('../check-canonical-si-dependencies.cjs');
const root = path.resolve(__dirname, '../..');
describe('canonical SI dependency closure', () => {
  it('every captured function/view relation and helper has a source definition', () => {
    expect(checkCanonicalSiDependencies().missing).toEqual([]);
  });
  it('the full capture and helper migrations are both in the local RC chain', () => {
    const order = fs.readFileSync(path.join(root, 'scripts/staging/rc-migration-order.mjs'), 'utf8');
    expect(order).toContain('20261009200000_capture_production_canonical_si_writers_v1.sql');
    expect(order).toContain('20261009210000_close_internal_story_sync_dependencies_v16.sql');
  });
  it('internal helper migration revokes client access and pins the search path', () => {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261009210000_close_internal_story_sync_dependencies_v16.sql'), 'utf8');
    for (const name of ['dawaa_sync_whatsapp_story_product_events_v16', 'dawaa_sync_whatsapp_story_reengagement_events_v16']) {
      expect(sql).toContain(`revoke all on function public.${name}(uuid) from public, anon, authenticated`);
    }
    expect((sql.match(/SET search_path TO 'pg_catalog', 'public', 'pg_temp'/g) || []).length).toBe(2);
  });
  it('fails when a transitive helper definition disappears even though the original nine still exist', () => {
    const read = fs.readFileSync;
    try {
      fs.readFileSync = (file, ...args) => {
        const sql = read(file, ...args);
        return String(file).endsWith('20261009210000_close_internal_story_sync_dependencies_v16.sql')
          ? sql.replace('CREATE OR REPLACE FUNCTION public.dawaa_sync_whatsapp_story_reengagement_events_v16',
            'ALTER FUNCTION public.dawaa_sync_whatsapp_story_reengagement_events_v16') : sql;
      };
      expect(checkCanonicalSiDependencies().missing).toContain('dawaa_sync_whatsapp_story_reengagement_events_v16');
    } finally { fs.readFileSync = read; }
  });
  it('fails when the real analysis table/row type is omitted from the staging baseline', () => {
    const read = fs.readFileSync;
    try {
      fs.readFileSync = (file, ...args) => {
        const sql = read(file, ...args);
        return String(file).endsWith('15_canonical_si_schema.sql')
          ? sql.replace('CREATE TABLE IF NOT EXISTS public."sales_intelligence_case_analyses"',
            'ALTER TABLE public."sales_intelligence_case_analyses"') : sql;
      };
      expect(checkCanonicalSiDependencies().missing).toContain('sales_intelligence_case_analyses');
    } finally { fs.readFileSync = read; }
  });
});
