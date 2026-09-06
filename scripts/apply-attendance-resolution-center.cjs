const fs = require('fs');
const path = 'src/pages/AttendanceReport.tsx';
let s = fs.readFileSync(path, 'utf8');

const syncImport = "import AttendanceSyncCommandCenter from '@/components/attendance/AttendanceSyncCommandCenter';";
const resolutionImport = "import AttendanceResolutionCenter from '@/components/attendance/AttendanceResolutionCenter';";
if (!s.includes(resolutionImport)) s = s.replace(syncImport, `${syncImport}\n${resolutionImport}`);

s = s.replace("type Tab = 'clock' | 'today' | 'sync' | 'report' | 'logs';", "type Tab = 'clock' | 'today' | 'resolution' | 'sync' | 'report' | 'logs';");

const oldButtons = "{isOperationalManager && <button onClick={() => setTab('today')} className={tab === 'today' ? 'btn-primary' : 'btn-secondary'}><Users size={16} /> اليوم</button>}{canViewSyncHealth && <button onClick={() => setTab('sync')} className={tab === 'sync' ? 'btn-primary' : 'btn-secondary'}><ShieldAlert size={16} /> البصمات</button>}";
const newButtons = "{isOperationalManager && <button onClick={() => setTab('today')} className={tab === 'today' ? 'btn-primary' : 'btn-secondary'}><Users size={16} /> اليوم</button>}{isOperationalManager && <button onClick={() => setTab('resolution')} className={tab === 'resolution' ? 'btn-primary' : 'btn-secondary'}><ShieldAlert size={16} /> التسوية والالتزام</button>}{canViewSyncHealth && <button onClick={() => setTab('sync')} className={tab === 'sync' ? 'btn-primary' : 'btn-secondary'}><Fingerprint size={16} /> البصمات والمزامنة</button>}";
if (!s.includes(oldButtons)) throw new Error('attendance tab buttons anchor not found');
s = s.replace(oldButtons, newButtons);

const todayBlockEnd = "{tab === 'sync' && <><AttendanceSyncCommandCenter";
const resolutionBlock = "{tab === 'resolution' && <AttendanceResolutionCenter defaultBranch={effectiveBranch} />}\n      ";
if (!s.includes(resolutionBlock.trim())) {
  if (!s.includes(todayBlockEnd)) throw new Error('sync render anchor not found');
  s = s.replace(todayBlockEnd, resolutionBlock + todayBlockEnd);
}

s = s.replace(
  'الجدول المعتمد + بصمة الجهاز + الاستثناءات في مسار واحد، مع إيقاف الحكم تلقائيًا عند تعارض الجدول.',
  'الجدول المعتمد + البصمة + الأذونات والإجازات + التسوية اليومية في مسار واحد. لا يتحول أي Raw event إلى خصم أو غياب نهائي قبل اكتمال المزامنة والقرار المعتمد.'
);

fs.writeFileSync(path, s);
console.log('Attendance resolution center integrated.');
