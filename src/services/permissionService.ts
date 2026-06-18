import { supabase } from '@/lib/supabase';
import { logSupabaseError } from '@/lib/supabaseError';
import { TABLES } from '@/lib/supabaseTables';

export async function upsertUserPermission(
  userId: string,
  permissionKey: string,
  allowed: boolean,
  createdBy?: string | null
) {
  const payload: Record<string, unknown> = {
    user_id: userId,
    permission_key: permissionKey,
    allowed,
  };
  if (createdBy) payload.created_by = createdBy;

  const result = await supabase
    .from(TABLES.userPermissions)
    .upsert(payload, { onConflict: 'user_id,permission_key' });
  if (result.error) logSupabaseError('upsert user permission', result.error);
  return result;
}
