const CAIRO_TZ='Africa/Cairo';
function offsetMs(date:Date){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:CAIRO_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const v=Object.fromEntries(p.map(x=>[x.type,x.value]));
 return Date.UTC(+v.year,+v.month-1,+v.day,+v.hour,+v.minute,+v.second)-Math.floor(date.getTime()/1000)*1000;
}
export function cairoDateBoundaryIso(dateText:string,end=false){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);if(!m)throw new Error('Invalid Cairo date boundary');
 const local=Date.UTC(+m[1],+m[2]-1,+m[3],end?23:0,end?59:0,end?59:0,end?999:0);
 let d=new Date(local);for(let i=0;i<2;i++)d=new Date(local-offsetMs(d));return d.toISOString();
}
const cairoDayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:CAIRO_TZ,year:'numeric',month:'2-digit',day:'2-digit'});
/** Cairo calendar day (YYYY-MM-DD) of a timestamp; a plain date string is returned as-is. Null when unparseable. */
export function cairoDayOf(value:unknown):string|null{
 const text=String(value??'').trim();if(!text)return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
 const d=new Date(text);return Number.isNaN(d.getTime())?null:cairoDayFormat.format(d);
}
