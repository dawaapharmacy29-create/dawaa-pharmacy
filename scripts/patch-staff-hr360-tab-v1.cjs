const fs=require('fs');
const p='src/pages/StaffProfile2027.tsx';
let s=fs.readFileSync(p,'utf8');
if(!s.includes("import StaffHR360Panel from '@/components/staff/StaffHR360Panel';")){
  s=s.replace("import StaffPerformanceCharts from '@/components/staff/StaffPerformanceCharts';", "import StaffPerformanceCharts from '@/components/staff/StaffPerformanceCharts';\nimport StaffHR360Panel from '@/components/staff/StaffHR360Panel';");
}
if(!s.includes("| 'hr360'")){
  s=s.replace("  | 'attendance'\n", "  | 'attendance'\n  | 'hr360'\n");
}
if(!s.includes("{ key: 'hr360', label: 'ملف HR 360°'")){
  s=s.replace("  { key: 'attendance', label: 'الحضور', icon: Calendar },", "  { key: 'attendance', label: 'الحضور', icon: Calendar },\n  { key: 'hr360', label: 'ملف HR 360°', icon: BriefcaseBusiness },");
}
if(!s.includes('BriefcaseBusiness,')){
  s=s.replace('  BarChart3,\n', '  BarChart3,\n  BriefcaseBusiness,\n');
}
if(!s.includes("activeTab === 'hr360' && <StaffHR360Panel")){
  s=s.replace("        {activeTab === 'attendance' && <AttendanceTab profile={profile} />}", "        {activeTab === 'attendance' && <AttendanceTab profile={profile} />}\n        {activeTab === 'hr360' && <StaffHR360Panel staffId={profile.staff.id} />}");
}
fs.writeFileSync(p,s);
