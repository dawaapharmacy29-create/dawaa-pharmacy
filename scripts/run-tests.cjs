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

const ARRAY_CONTAINING = Symbol('arrayContaining');

function deepEqual(a, b) {
  if (b && typeof b === 'object' && b[ARRAY_CONTAINING]) {
    if (!Array.isArray(a)) return false;
    return b.expected.every((expectedItem) => a.some((item) => deepEqual(item, expectedItem)));
  }
  if (a && typeof a === 'object' && a[ARRAY_CONTAINING]) return deepEqual(b, a);
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function expect(actual) {
  const api = {
    toBe(expected) {
      if (!Object.is(actual, expected)) throw new Error(`Expected ${actual} to be ${expected}`);
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
    },
    toBeDefined() {
      if (actual === undefined) throw new Error('Expected value to be defined');
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected ${actual} to be null`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected ${actual} to be truthy`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected ${actual} to be falsy`);
    },
    toHaveProperty(prop) {
      if (actual == null || !(prop in Object(actual))) {
        throw new Error(`Expected value to have property ${String(prop)}`);
      }
    },
    toHaveLength(length) {
      if (actual?.length !== length) throw new Error(`Expected length ${actual?.length} to be ${length}`);
    },
    toContain(value) {
      if (!actual?.includes?.(value)) throw new Error(`Expected value to contain ${value}`);
    },
    toMatch(pattern) {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      if (!re.test(String(actual))) throw new Error(`Expected ${actual} to match ${pattern}`);
    },
    toBeGreaterThan(value) {
      if (!(actual > value)) throw new Error(`Expected ${actual} to be greater than ${value}`);
    },
    toBeGreaterThanOrEqual(value) {
      if (!(actual >= value)) throw new Error(`Expected ${actual} to be >= ${value}`);
    },
    toBeLessThan(value) {
      if (!(actual < value)) throw new Error(`Expected ${actual} to be less than ${value}`);
    },
    toBeLessThanOrEqual(value) {
      if (!(actual <= value)) throw new Error(`Expected ${actual} to be <= ${value}`);
    },
    toBeUndefined() {
      if (actual !== undefined) throw new Error(`Expected ${actual} to be undefined`);
    },
    toBeCloseTo(value, precision = 2) {
      const diff = Math.abs(actual - value);
      if (diff >= Math.pow(10, -precision) / 2) throw new Error(`Expected ${actual} to be close to ${value}`);
    },
    toThrow(match) {
      if (typeof actual !== 'function') throw new Error('Expected value to be a function for toThrow()');
      let threw = false;
      let error;
      try { actual(); } catch (err) { threw = true; error = err; }
      if (!threw) throw new Error('Expected function to throw');
      if (match) {
        const re = match instanceof RegExp ? match : new RegExp(String(match));
        const message = error instanceof Error ? error.message : String(error);
        if (!re.test(message)) throw new Error(`Expected thrown error to match ${match}, got: ${message}`);
      }
    },
  };
  return {
    ...api,
    not: {
      toBe(expected) {
        if (Object.is(actual, expected)) throw new Error(`Expected ${actual} not to be ${expected}`);
      },
      toEqual(expected) {
        if (deepEqual(actual, expected)) throw new Error(`Expected value not to equal ${JSON.stringify(expected)}`);
      },
      toBeNull() {
        if (actual === null) throw new Error('Expected value not to be null');
      },
      toBeTruthy() {
        if (actual) throw new Error(`Expected ${actual} not to be truthy`);
      },
      toContain(value) {
        if (actual?.includes?.(value)) throw new Error(`Expected value not to contain ${value}`);
      },
      toMatch(pattern) {
        const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        if (re.test(String(actual))) throw new Error(`Expected ${actual} not to match ${pattern}`);
      },
      toThrow() {
        if (typeof actual !== 'function') throw new Error('Expected value to be a function for not.toThrow()');
        let threw = false;
        try { actual(); } catch { threw = true; }
        if (threw) throw new Error('Expected function not to throw');
      },
    },
  };
}

expect.arrayContaining = function arrayContaining(expectedItems) {
  return { [ARRAY_CONTAINING]: true, expected: expectedItems };
};

const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vitest') return { describe, it, expect, beforeEach, afterEach };
  return originalLoad.call(this, request, parent, isMain);
};

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const target = path.join(root, 'src', request.slice(2));
    // الامتدادات بالأول عمدًا: لو فيه ملف زي performance.ts ومجلد performance/ في نفس
    // الوقت (زي الحال هنا فعليًا)، لازم الملف المحدد بالاسم ياخد الأولوية بالظبط زي
    // سلوك Vite/TS الحقيقي - مش أول مسار "موجود" حرفيًا حتى لو كان مجلد.
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = target + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
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
  'src/lib/__tests__/targetAchievementBonus.test.ts',
  'src/lib/__tests__/incentiveEligibility.test.ts',
  'src/lib/__tests__/customerCohortIntelligence.test.ts',
  'src/lib/staff/__tests__/staffPerformanceProfileService.test.ts',
  'src/lib/__tests__/customerFollowupCore.test.ts',
  'src/lib/__tests__/customerFollowupGuards.test.ts',
  'src/lib/__tests__/customerFollowupStatus.integration.test.ts',
  'src/lib/__tests__/customerFollowupExport.test.ts',
  'src/lib/__tests__/customerDownwardCorrectionGuard.test.ts',
  'src/lib/__tests__/pointsLedgerIdentity.test.ts',
  'src/lib/__tests__/attendanceReadNormalization.test.ts',
  'src/lib/__tests__/notificationLifecycleDomain.test.ts',
  'src/lib/security/__tests__/publicViewInvokerBoundaryMigration.test.ts',
  'src/lib/security/__tests__/securityDefinerPublicExecuteMigration.test.ts',
  'src/lib/security/__tests__/internalTriggerFunctionSurfaceMigration.test.ts',
  'src/lib/security/__tests__/scheduledMaintenanceSurfaceMigration.test.ts',
  'src/lib/security/__tests__/monthlyEvaluationSelfGuardMigration.test.ts',
  'src/lib/__tests__/whatsappFollowupSignalDetector.test.ts',
  'src/lib/__tests__/whatsappFollowupSalesVerification.test.ts',
  'src/lib/__tests__/whatsappFollowupGovernance.test.ts',
  'src/lib/__tests__/conversationReviewTranscript.test.ts',
  'src/lib/__tests__/whatsappSmartReviewCore.test.ts',
  'src/lib/__tests__/whatsappSmartReviewOwnership.test.ts',
  'src/lib/__tests__/whatsappSmartReviewResult.test.ts',
  'src/lib/__tests__/whatsappSmartReviewScope.test.ts',
  'src/lib/__tests__/whatsappSmartReviewDecision.test.ts',
  'src/lib/__tests__/whatsappSmartReviewPipeline.test.ts',
  'src/lib/__tests__/whatsappSmartReviewPipelineIntelligence.test.ts',
  'src/lib/__tests__/whatsappSmartConversationIntelligence.test.ts',
  'src/lib/__tests__/whatsappSmartConversationIntelligence.realRegression.test.ts',
  'src/lib/__tests__/whatsappSmartConversationRefinement.test.ts',
  'src/lib/__tests__/whatsappSmartReviewActions.test.ts',
  'src/lib/__tests__/whatsappSmartReviewGoldenCases.test.ts',
  // كانت موجودة على القرص من دمج feature/whatsapp-smart-review-v2-test لكن لم تكن
  // مضافة هنا فعليًا، فكانت لا تُنفَّذ إطلاقًا رغم وجودها - تمت إضافتها هنا بعد التأكد
  // إنها لا تحتاج vi.mock/vi.fn (المُحرِّك المبسّط هنا لا يدعمهم بعد).
  'src/lib/__tests__/conversationReviewSnapshotRoundTrip.test.ts',
  'src/lib/__tests__/salesJourneyReviewV2.test.ts',
  'src/lib/__tests__/whatsappCaseContextV27.test.ts',
  'src/lib/__tests__/whatsappConversationEvaluationV2.test.ts',
  'src/lib/__tests__/whatsappConversationFocusV30.test.ts',
  'src/lib/__tests__/whatsappConversationParser.richExport.test.ts',
  'src/lib/__tests__/whatsappConversationTimingV28.test.ts',
  'src/lib/__tests__/whatsappCustomerCaseEngineV22.test.ts',
  'src/lib/__tests__/whatsappDeepConversationIntelligenceV26.test.ts',
  'src/lib/__tests__/whatsappDelayAttributionV29.test.ts',
  'src/lib/__tests__/whatsappEvaluationConversationV31.test.ts',
  'src/lib/__tests__/whatsappExportCustomerHint.test.ts',
  'src/lib/__tests__/whatsappMessageTemplateNormalization.test.ts',
  'src/lib/__tests__/whatsappOutboundMessageBursts.test.ts',
  'src/lib/__tests__/whatsappSmartIntelligenceSnapshot.test.ts',
  'src/lib/__tests__/whatsappSmartOfficialReviewDraft.test.ts',
  'src/lib/__tests__/whatsappAutomaticReviewScoring.test.ts',
  'src/lib/__tests__/whatsappUnifiedIntelligenceV4.test.ts',
  'src/lib/__tests__/conversationReviewsReviewerDisplay.test.ts',
  'src/lib/__tests__/reviewWorkspaceAccess.test.ts',
  'src/lib/__tests__/doctorCompetitionReviewLinking.test.ts',
  'src/lib/__tests__/whatsappGoldenCaseIbrahimAlSayyad.test.ts',
  'src/lib/__tests__/whatsappConversationUnderstandingV32.test.ts',
  'src/lib/__tests__/whatsappResponseSpeedEvidenceV32.test.ts',
  'src/lib/__tests__/whatsappUnderstandingEvidenceV32.test.ts',
  'src/lib/__tests__/whatsappOrderConfirmationEvidenceV32.test.ts',
  'src/lib/__tests__/whatsappUnderstandingEvidenceV32GoldenExpansion.test.ts',
  'src/lib/__tests__/whatsappOrderConfirmationEvidenceV32GoldenExpansion.test.ts',
  'src/lib/__tests__/whatsappSemanticSignalsV32.test.ts',
  'src/lib/__tests__/whatsappProductDemandBackfillQualityGateV22.test.ts',
  'src/lib/salesIntelligence/__tests__/conversationCaseEngine.test.ts',
  'src/lib/salesIntelligence/__tests__/caseBasketEngine.test.ts',
  'src/lib/salesIntelligence/__tests__/commercialConfirmationEngine.test.ts',
  'src/lib/salesIntelligence/__tests__/saleAttributionEngine.test.ts',
  'src/lib/salesIntelligence/__tests__/basketInvoiceMatchingEngine.test.ts',
  'src/lib/salesIntelligence/__tests__/salesIntegrityEngine.test.ts',
  'src/lib/salesIntelligence/__tests__/salesIntelligencePipeline.test.ts',
  'src/lib/salesIntelligence/__tests__/historicalCommercialClosureEngine.test.ts',
  'src/lib/salesIntelligence/persistence/__tests__/hashing.test.ts',
  'src/lib/salesIntelligence/persistence/__tests__/writerFailures.test.ts',
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
