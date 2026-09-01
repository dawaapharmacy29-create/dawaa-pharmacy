import { supabase } from '@/lib/supabase';

export interface StaffDirectoryOption {
  id: string;
  name: string;
  branch: string | null;
}

export async function searchActiveStaffByName(term: string, limit = 10): Promise<StaffDirectoryOption[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, branch')
    .eq('active', true)
    .ilike('name', `%${trimmed}%`)
    .limit(limit);
  if (error) {
    console.error('searchActiveStaffByName error:', error);
    return [];
  }
  return (data || []) as StaffDirectoryOption[];
}
