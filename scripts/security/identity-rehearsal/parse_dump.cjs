const fs=require('fs');
const raw=fs.readFileSync(process.argv[2],'utf8');
let outer=JSON.parse(raw); let txt=outer.result||outer;
const s=txt.indexOf('['), e=txt.lastIndexOf(']');
const rows=JSON.parse(txt.slice(s,e+1));
fs.writeFileSync(process.argv[3], JSON.stringify(rows));
const by={}; for(const r of rows){by[r.kind]=(by[r.kind]||0)+1}
console.log(rows.length, by);
console.log(rows.filter(r=>r.kind==='a_table').map(r=>r.nm).join(','));
