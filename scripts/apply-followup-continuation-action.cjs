const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/components/customerService/CustomerFollowupRecordsAndPerformance.tsx');
if (!fs.existsSync(file)) process.exit(0);
let s = fs.readFileSync(file, 'utf8');
const before = s;
if (!s.includes("ContinueFollowupModal")) {
  s = s.replace("import { canViewAllBranches } from '@/lib/security/userDataScope';", "import { canViewAllBranches } from '@/lib/security/userDataScope';\nimport ContinueFollowupModal from '@/components/customerService/ContinueFollowupModal';");
}
if (!s.includes("const [continueRow, setContinueRow]")) {
  s = s.replace("const [selected, setSelected] = useState<Row | null>(null);", "const [selected, setSelected] = useState<Row | null>(null);\n  const [continueRow, setContinueRow] = useState<Row | null>(null);");
}
const oldActions = '<button className="btn-secondary flex items-center gap-2" onClick={()=>setSelected(row)}><Eye size={16}/> التفاصيل</button>';
const newActions = '<div className="flex flex-wrap gap-2"><button className="btn-secondary flex items-center gap-2" onClick={()=>setSelected(row)}><Eye size={16}/> التفاصيل</button>{(mode === \'waiting\' || mode === \'no_answer\' || mode === \'exceptional\') ? <button className="btn-primary" onClick={()=>setContinueRow(row)}>استكمال المتابعة</button> : null}</div>';
if (s.includes(oldActions)) s = s.replace(oldActions, newActions);
if (!s.includes("<ContinueFollowupModal row={continueRow}")) {
  s = s.replace("{selected ? <div className=\"fixed inset-0 z-[170]", "<ContinueFollowupModal row={continueRow} onClose={()=>setContinueRow(null)} onSaved={(updated)=>{ setRows((current)=>current.map((item)=>item.id===updated.id?updated:item)); setSelected((current)=>current?.id===updated.id?updated:current); }} />\n      {selected ? <div className=\"fixed inset-0 z-[170]");
}
if (s !== before) fs.writeFileSync(file, s);
if (!s.includes("ContinueFollowupModal row={continueRow}")) throw new Error('followup continuation action was not applied');
console.log('[followup-continuation] action connected');
