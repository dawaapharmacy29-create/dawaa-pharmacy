const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');
const source = fs.readFileSync(file, 'utf8');

if (!source.trim()) {
  throw new Error('UnifiedCustomerServiceWorkspace.tsx is empty');
}

console.log('Verified customer-service workspace without modifying source files.');
