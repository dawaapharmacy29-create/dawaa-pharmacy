const fs = require('node:fs');

const path = 'src/pages/ExecutiveDashboard2027.tsx';
let source = fs.readFileSync(path, 'utf8');

const oldDefaults = `  const targetDefaults: Record<string, number> = {\n    'فرع الشامي': 1000000,\n    'فرع شكري': 1500000,\n  };`;
const newDefaults = `  const targetDefaults: Record<string, number> = {\n    'فرع الشامي': 1200000,\n    'فرع شكري': 1550000,\n  };`;

if (source.includes(oldDefaults)) {
  source = source.replace(oldDefaults, newDefaults);
  console.log('Executive dashboard target fallback updated to current branch targets.');
} else if (source.includes(newDefaults)) {
  console.log('Executive dashboard target fallback already current.');
} else {
  throw new Error('Executive dashboard target fallback block not found. Refusing unsafe patch.');
}

if (!source.includes("'فرع الشامي': 1200000") || !source.includes("'فرع شكري': 1550000")) {
  throw new Error('Executive dashboard target fallback verification failed.');
}

fs.writeFileSync(path, source);
console.log('Executive dashboard target fallback truth verified.');
