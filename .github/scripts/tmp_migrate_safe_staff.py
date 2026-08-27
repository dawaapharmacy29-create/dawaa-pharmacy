from pathlib import Path

stories = Path('src/pages/Stories.tsx')
text = stories.read_text(encoding='utf-8')
text = text.replace("import { isActiveStaffFilter } from '@/lib/staffActiveFilter';\n", "")
text = text.replace("import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';\n", "import { useStaffDirectory } from '@/hooks/useStaffDirectory';\n")
old = """  const { data: staffRows } = useSupabaseQuery<StaffOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });"""
new = """  const { data: staffDirectory = [] } = useStaffDirectory();
  const staffRows = useMemo(
    () =>
      staffDirectory
        .filter((item) => item.source !== 'alias' && item.active)
        .map((item) => ({
          id: item.id || undefined,
          name: item.name,
          role: item.role,
          branch: item.branch,
        })),
    [staffDirectory]
  );"""
if old not in text:
    raise SystemExit('Stories staff query anchor not found')
stories.write_text(text.replace(old, new, 1), encoding='utf-8')

incentive = Path('src/pages/IncentiveMedicines.tsx')
text = incentive.read_text(encoding='utf-8')
text = text.replace("import { isActiveStaffFilter } from '@/lib/staffActiveFilter';\n", "")
anchor = "import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';\n"
if anchor not in text:
    raise SystemExit('Incentive import anchor not found')
text = text.replace(anchor, anchor + "import { useStaffDirectory } from '@/hooks/useStaffDirectory';\n", 1)
old = """  const { data: staffOptions } = useSupabaseQuery<DoctorOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: false,
  });"""
new = """  const { data: staffDirectory = [] } = useStaffDirectory();
  const staffOptions = useMemo<DoctorOption[]>(
    () =>
      staffDirectory
        .filter((item) => item.source !== 'alias' && item.active && item.id && item.name)
        .map((item) => ({
          id: item.id as string,
          name: item.name as string,
          role: item.role,
          branch: item.branch,
          branch_name: item.branch,
          active: item.active,
        })),
    [staffDirectory]
  );"""
if old not in text:
    raise SystemExit('Incentive staff query anchor not found')
incentive.write_text(text.replace(old, new, 1), encoding='utf-8')

gate = Path('scripts/check-generic-query-data-access.cjs')
text = gate.read_text(encoding='utf-8')
for debt in ["  'src/pages/IncentiveMedicines.tsx',\n", "  'src/pages/Stories.tsx',\n"]:
    if debt not in text:
        raise SystemExit('Staff debt line missing: ' + debt.strip())
    text = text.replace(debt, '', 1)
gate.write_text(text, encoding='utf-8')

for temp in [
    Path('.github/workflows/tmp-staff-directory-safe-pages.yml'),
    Path('.github/workflows/tmp-staff-directory-safe-pages-fix.yml'),
    Path('.github/workflows/tmp-staff-directory-safe-pages-run.yml'),
    Path('.github/scripts/tmp_migrate_safe_staff.py'),
]:
    if temp.exists():
        temp.unlink()
