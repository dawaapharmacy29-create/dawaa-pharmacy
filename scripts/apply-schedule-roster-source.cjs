const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Schedule.tsx');
if (!fs.existsSync(file)) throw new Error('[schedule-roster] Schedule.tsx not found');

let source = fs.readFileSync(file, 'utf8');
const before = source;

source = source.replace(
  /const \{ data: employees, loading \} = useSupabaseQuery<Employee>\(\{\s*table: 'staff',\s*filters: isActiveStaffFilter\(\),\s*orderBy: \{ column: 'name', ascending: true \},\s*realtimeEnabled: true,\s*\}\);/,
  `const { data: employees, loading } = useSupabaseQuery<Employee>({\n    table: 'schedule_roster_display',\n    orderBy: { column: 'name', ascending: true },\n    realtimeEnabled: true,\n  });`
);

source = source.replace(/\s*isActiveStaffFilter,\n/, '\n');

if (!source.includes("table: 'schedule_roster_display'")) {
  throw new Error('[schedule-roster] roster view query was not applied');
}
if (source.includes("table: 'staff',\n    filters: isActiveStaffFilter()")) {
  throw new Error('[schedule-roster] legacy staff query remains');
}

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('[schedule-roster] schedule now reads only current roster members');
} else {
  console.log('[schedule-roster] already applied');
}
