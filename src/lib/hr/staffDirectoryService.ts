import { supabase } from '@/lib/supabase';

export type HRStaffDirectoryRow = {
  account_id: string | null;
  staff_id: string | null;
  username: string | null;
  name: string | null;
  branch: string | null;
  role: string | null;
  active: boolean | null;
};

export async function listActiveHRStaffDirectory(args: {
  branch?: string | null;
  roles?: string[] | null;
} = {}): Promise<HRStaffDirectoryRow[]> {
  const { data, error } = await supabase.rpc('get_staff_accounts_directory', {
    p_roles: args.roles || null,
    p_branch: args.branch || null,
  });
  if (error) throw new Error(error.message);

  return ((data || []) as HRStaffDirectoryRow[])
    .filter((row) => row && row.active !== false && Boolean(row.username) && Boolean(row.staff_id));
}
