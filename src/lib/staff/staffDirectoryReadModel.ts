import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { staffRowIsActive } from '@/lib/staffActiveFilter';

export type StaffDirectoryReadRow = {
  id: string;
  name: string;
  role: string | null;
  branch: string | null;
  is_active: boolean;
};

/**
 * Canonical read boundary for the active staff directory used by analytics surfaces.
 * UI components must not read the staff table directly; identity/active semantics live here.
 */
export async function readStaffDirectory(limit = 2000): Promise<StaffDirectoryReadRow[]> {
  const { data, error } = await supabase
    .from(TABLES.staff)
    .select('id,name,role,branch,is_active,active,status')
    .limit(limit);

  if (error) throw error;

  return ((data || []) as Record<string, unknown>[])
    .filter((row) => row.id && row.name)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: row.role == null ? null : String(row.role),
      branch: row.branch == null ? null : String(row.branch),
      is_active: staffRowIsActive(row as any),
    }));
}
