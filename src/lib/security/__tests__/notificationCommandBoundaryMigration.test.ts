import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20260826023000_unify_notification_command_boundary_v1.sql'), 'utf8');
const textRecipientMigration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20260826024500_support_text_notification_recipients_v2.sql'), 'utf8');

describe('notification command boundary migration', () => {
  it('removes browser writes to the notification table', () => {
    expect(migration).toContain('revoke insert, update, delete, truncate on public.notifications from anon, authenticated');
    expect(migration).toContain('drop policy if exists notifications_insert_app');
  });
  it('requires a canonical active actor for every command', () => {
    expect(migration.match(/dawaa_current_staff_account_id_strict\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
  it('fans role audiences out to independent staff rows', () => {
    expect(textRecipientMigration).toContain("trim(p_dedupe_key)||':'||v_recipient.staff_id");
    expect(migration).toContain('recipient_staff_id=v_actor.staff_id');
  });
  it('supports canonical text and UUID-shaped staff identifiers', () => {
    expect(textRecipientMigration).toContain("nullif(trim(sa.staff_id),'') staff_id");
    expect(textRecipientMigration).not.toContain("sa.staff_id ~*");
  });
  it('revokes unsafe definer entry points', () => {
    expect(migration).toContain('revoke execute on function public.create_staff_notification');
    expect(migration).toContain('revoke execute on function public.get_my_notifications');
  });
});
