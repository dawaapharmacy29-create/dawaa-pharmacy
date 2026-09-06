const fs = require('fs');
const p = 'src/pages/HRComplianceCenter.tsx';
let s = fs.readFileSync(p, 'utf8');

s = s.replace(
  "import { useCallback, useEffect, useMemo, useState } from 'react';",
  "import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';"
);

const old = `        ].map(([label, value, Icon]) => <div key={String(label)} className="dawaa-card p-4"><div className="flex items-center gap-2"><Icon size={17} className="dawaa-muted" /><span className="dawaa-muted text-xs font-bold">{String(label)}</span></div><div className="dawaa-title mt-2 text-2xl">{String(value)}</div></div>)}`;
const next = `        ] as Array<[string, string | number, ElementType]>).map(([label, value, Icon]) => <div key={String(label)} className="dawaa-card p-4"><div className="flex items-center gap-2"><Icon size={17} className="dawaa-muted" /><span className="dawaa-muted text-xs font-bold">{String(label)}</span></div><div className="dawaa-title mt-2 text-2xl">{String(value)}</div></div>)}`;
if (!s.includes(old) && !s.includes(next)) throw new Error('metric map anchor not found');
if (s.includes(old)) s = s.replace(old, next);

fs.writeFileSync(p, s);
console.log('patched HR metric icon typing');
