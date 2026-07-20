#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const tests = [];
let currentSuite = null;

globalThis.__VITE_IMPORT_META_ENV__ = {
  DEV: false,
  PROD: true,
  MODE: 'test',
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
};

function makeSuite(name) {
  return { name, tests: [], beforeEach: [], afterEach: [] };
}

function describe(name, fn) {
  const parent = currentSuite;
  const suite = makeSuite(name);
  currentSuite = suite;
  tests.push(suite);
  fn();
  currentSuite = parent;
}

function it(name, fn) {
  if (!currentSuite) currentSuite = makeSuite('default');
  currentSuite.tests.push({ name, fn });
}

function beforeEach(fn) {
  currentSuite?.beforeEach.push(fn);
}

function afterEach(fn) {
  currentSuite?.afterEach.push(fn);
}

function expect(actual) {
  const api = {
    toBe(expected) {
      if (!Object.is(actual, expected)) throw new Error(`Expected ${actual} to be ${expected}`);
    },
    toBeDefined() {
      if (actual === undefined) throw new Error('Expected value to be defined');
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected ${actual} to be null`);
    },
    toHaveProperty(prop) {
      if (actual == null || !(prop in Object(actual))) {
        throw new Error(`Expected value to have property ${String(prop)}`);
      }
    },
    toContain(value) {
      if (!actual?.includes?.(value)) throw new Error(`Expected value to contain ${value}`);
    },
    toBeGreaterThan(value) {
      if (!(actual > value)) throw new Error(`Expected ${actual} to be greater than ${value}`);
    },
    toBeGreaterThanOrEqual(value) {
      if (!(actual >= value)) throw new Error(`Expected ${actual} to be >= ${value}`);
    },
    toBeLessThanOrEqual(value) {
      if (!(actual <= value)) throw new Error(`Expected ${actual} to be <= ${value}`);
    },
  };
  return {
    ...api,
    not: {
      toBeNull() {
        if (actual === null) throw new Error('Expected value not to be null');
      },
    },
  };
}

const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vitest') return { describe, it, expect, beforeEach, afterEach };
  return originalLoad.call(this, request, parent, isMain);
};

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const target = path.join(root, 'src', request.slice(2));
    for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
      const candidate = target + ext;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = function compileTypeScript(module, filename) {
    const source = fs
      .readFileSync(filename, 'utf8')
      .replaceAll('import.meta.env', 'globalThis.__VITE_IMPORT_META_ENV__');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

const testFiles = [
  'src/lib/staff/__tests__/staffPerformanceProfileService.test.ts',
  'src/lib/__tests__/customerFollowupCore.test.ts',
  'src/lib/__tests__/customerFollowupGuards.test.ts',
  'src/lib/__tests__/customerFollowupStatus.integration.test.ts',
  'src/lib/__tests__/customerFollowupExport.test.ts',
];
for (const relativePath of testFiles) {
  const testFile = path.join(root, relativePath);
  if (!fs.existsSync(testFile)) throw new Error(`Missing configured test file: ${relativePath}`);
  require(testFile);
}

(async () => {
  let passed = 0;
  let failed = 0;

  for (const suite of tests) {
    console.log(`\n${suite.name}`);
    for (const test of suite.tests) {
      try {
        for (const hook of suite.beforeEach) await hook();
        await test.fn();
        for (const hook of suite.afterEach) await hook();
        passed += 1;
        console.log(`  ✓ ${test.name}`);
      } catch (error) {
        failed += 1;
        console.error(`  ✗ ${test.name}`);
        console.error(error instanceof Error ? error.stack || error.message : error);
      }
    }
  }

  console.log(`\nTest result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
