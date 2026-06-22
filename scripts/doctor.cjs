/* Dawaa Pharmacy deploy sanity check */
const fs = require('fs');
const path = require('path');

const required = ['package.json', 'vercel.json', 'index.html', 'src/App.tsx'];
let ok = true;
for (const file of required) {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    console.error(`Missing required file: ${file}`);
    ok = false;
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Invalid JSON in ${file}: ${error.message}`);
    ok = false;
    return {};
  }
};

const pkg = readJson('package.json');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22) {
  console.warn(`Warning: recommended Node.js is 22.x, current is ${process.versions.node}`);
}
if (pkg.engines?.node !== '22.x') {
  console.error('package.json engines.node must be 22.x');
  ok = false;
}

const packageManager = String(pkg.packageManager || '');
const hasPackageLock = fs.existsSync('package-lock.json');
const hasYarnLock = fs.existsSync('yarn.lock');
const hasPnpmLock = fs.existsSync('pnpm-lock.yaml');

if (!packageManager.startsWith('pnpm@')) {
  console.error('package.json packageManager must be pnpm@...');
  ok = false;
}
if (packageManager.startsWith('pnpm@') && !hasPnpmLock) {
  console.error('packageManager is pnpm but pnpm-lock.yaml is missing');
  ok = false;
}
if (hasPackageLock || hasYarnLock) {
  console.warn('Warning: old lockfiles (package-lock.json or yarn.lock) exist. Use pnpm-lock.yaml only.');
}

const vercel = readJson('vercel.json');
const installCommand = String(vercel.installCommand || '');
if (packageManager.startsWith('pnpm@') && !installCommand.includes('pnpm install')) {
  console.error('vercel.json installCommand should use pnpm install');
  ok = false;
}
if (vercel.outputDirectory !== 'dist') {
  console.error('vercel.json outputDirectory must be dist');
  ok = false;
}
if (!String(vercel.buildCommand || '').includes('build')) {
  console.error('vercel.json buildCommand must run the build script');
  ok = false;
}

if (!ok) process.exit(1);
console.log('Dawaa deploy sanity check passed ✅');
