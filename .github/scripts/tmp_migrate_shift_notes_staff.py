from pathlib import Path

page = Path('src/pages/ShiftNotes.tsx')
text = page.read_text(encoding='utf-8')
text = text.replace("import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';\n", "import { useStaffDirectory } from '@/hooks/useStaffDirectory';\n")
text = text.replace("import { isActiveStaffFilter } from '@/lib/staffActiveFilter';\n", "")
text = text.replace("import type { Staff } from '@/types/database';\n", "")
old = """  const { data: staffRows } = useSupabaseQuery<Staff>({
    table: 'staff', filters: isActiveStaffFilter(), realtimeEnabled: false,
  });
  const staffChoices = useMemo(
    () => selectableStaffChoices(staffRows as unknown as Record<string, unknown>[]),
    [staffRows]
  );"""
new = """  const { data: staffDirectory = [] } = useStaffDirectory();
  const staffChoices = useMemo(
    () =>
      selectableStaffChoices(
        staffDirectory.filter((item) => item.source !== 'alias' && item.active) as unknown as Record<string, unknown>[]
      ),
    [staffDirectory]
  );"""
if old not in text:
    raise SystemExit('ShiftNotes staff query anchor not found')
page.write_text(text.replace(old, new, 1), encoding='utf-8')

gate = Path('scripts/check-generic-query-data-access.cjs')
text = gate.read_text(encoding='utf-8')
debt = "  'src/pages/ShiftNotes.tsx',\n"
if debt not in text:
    raise SystemExit('ShiftNotes debt line not found')
gate.write_text(text.replace(debt, '', 1), encoding='utf-8')

for temp in [
    Path('.github/workflows/tmp-shift-notes-staff-run.yml'),
    Path('.github/scripts/tmp_migrate_shift_notes_staff.py'),
]:
    if temp.exists():
        temp.unlink()
