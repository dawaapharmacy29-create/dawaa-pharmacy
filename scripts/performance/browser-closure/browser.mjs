import { chromium } from 'playwright-core';

const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('CHROME_BIN is required');
const url = process.env.BROWSER_CLOSURE_URL || 'http://127.0.0.1:4174/scripts/performance/browser-closure/index.html';
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const requests = [];
page.on('request', (request) => requests.push(request.url()));
page.on('pageerror', (error) => console.error('PAGE_ERROR', error));

const wallStart = performance.now();
await page.goto(url, { waitUntil: 'networkidle' });
await page.getByText('ذكاء المبيعات').first().waitFor();
const startupMs = performance.now() - wallStart;

const fakeBeforeSearch = await page.evaluate(() => ({ reads: globalThis.__DAWAA_FAKE_SUPABASE__?.reads ?? -1, rpcCalls: globalThis.__DAWAA_FAKE_SUPABASE__?.rpcCalls ?? -1 }));
await page.getByRole('button', { name: 'مراجعة الحالات' }).click();
const search = page.getByPlaceholder('بحث بالعميل أو الكود أو الهاتف أو رقم الفاتورة...');
await search.waitFor();
const searchStart = performance.now();
const searchInputFrameMs = [];
for (const value of ['ك', 'كر', 'كريم']) {
  searchInputFrameMs.push(await search.evaluate(async (input, nextValue) => {
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - start;
  }, value));
}
const searchMs = performance.now() - searchStart;
const fakeAfterSearch = await page.evaluate(() => ({ reads: globalThis.__DAWAA_FAKE_SUPABASE__?.reads ?? -1, rpcCalls: globalThis.__DAWAA_FAKE_SUPABASE__?.rpcCalls ?? -1 }));

const brainNavStart = performance.now();
await page.getByTestId('nav-brain').click();
await page.getByTestId('brain-shell').waitFor();
const warmNavigationMs = performance.now() - brainNavStart;
const brainStart = performance.now();
await page.getByTestId('toggle-brain').click();
await page.getByTestId('case-intelligence-workspace').waitFor();
await page.getByText('ملخص الحالة').first().waitFor();
const brainOpenMs = performance.now() - brainStart;

const evalStart = performance.now();
await page.getByRole('tab', { name: 'تحليل المحادثة' }).click();
await page.getByTestId('conversation-evaluation-tab').waitFor();
const evaluationFirstMs = performance.now() - evalStart;
await page.getByRole('tab', { name: 'الأصناف' }).click();
await page.getByTestId('trusted-invoice-products').waitFor();
const cachedStart = performance.now();
await page.getByRole('tab', { name: 'تحليل المحادثة' }).click();
await page.getByTestId('conversation-evaluation-tab').waitFor();
const evaluationCachedMs = performance.now() - cachedStart;

const tabTimings = {};
for (const name of ['المحادثة', 'طلب العميل', 'الأصناف', 'الطلب والبيع', 'الفرصة', 'المتابعة', 'الأدلة والمراجعة']) {
  const start = performance.now();
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForTimeout(0);
  tabTimings[name] = Number((performance.now() - start).toFixed(3));
}

const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
const memoryBefore = await page.evaluate(() => ({ usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null, totalJSHeapSize: performance.memory?.totalJSHeapSize ?? null }));
for (let i = 0; i < 20; i += 1) {
  await page.getByTestId('toggle-brain').click();
  await page.getByTestId('case-intelligence-workspace').waitFor({ state: 'detached' });
  await page.getByTestId('toggle-brain').click();
  await page.getByTestId('case-intelligence-workspace').waitFor();
}
await cdp.send('HeapProfiler.collectGarbage');
const memoryAfter = await page.evaluate(() => ({ usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null, totalJSHeapSize: performance.memory?.totalJSHeapSize ?? null }));
const appMetrics = await page.evaluate(() => globalThis.__DAWAA_BROWSER_PERF__);
const supabaseNetworkRequests = requests.filter((value) => /supabase\.(co|com)|supabase\.in/i.test(value));
const memoryDelta = memoryBefore.usedJSHeapSize != null && memoryAfter.usedJSHeapSize != null ? memoryAfter.usedJSHeapSize - memoryBefore.usedJSHeapSize : null;
const result = {
  model: 'GitHub-hosted system Chrome + production-built synthetic fixture; not Production latency',
  chrome,
  startupMs: Number(startupMs.toFixed(3)), warmNavigationMs: Number(warmNavigationMs.toFixed(3)),
  masterBrainOpenMs: Number(brainOpenMs.toFixed(3)), evaluationFirstMs: Number(evaluationFirstMs.toFixed(3)), evaluationCachedMs: Number(evaluationCachedMs.toFixed(3)),
  searchRapidInputMs: Number(searchMs.toFixed(3)), searchInputFrameMs, searchReadDelta: fakeAfterSearch.reads - fakeBeforeSearch.reads, searchRpcDelta: fakeAfterSearch.rpcCalls - fakeBeforeSearch.rpcCalls,
  tabTimings, requests: requests.length, supabaseNetworkRequests: supabaseNetworkRequests.length,
  memoryBefore, memoryAfter, memoryDelta, appMetrics,
};
console.log('BROWSER_CLOSURE_METRICS', JSON.stringify(result));

const failures = [];
if (brainOpenMs > 1000) failures.push(`master brain open ${brainOpenMs.toFixed(1)}ms > 1000ms`);
if (evaluationCachedMs > 300) failures.push(`cached evaluation ${evaluationCachedMs.toFixed(1)}ms > 300ms`);
if (Math.max(...searchInputFrameMs) > 150) failures.push(`single input feedback ${Math.max(...searchInputFrameMs).toFixed(1)}ms > 150ms`);
if (result.searchReadDelta !== 0 || result.searchRpcDelta !== 0) failures.push('local search triggered data reads/RPCs');
if (result.supabaseNetworkRequests !== 0) failures.push('browser harness made external Supabase network requests');
if ((appMetrics?.detailOpenPipelineRuns ?? -1) !== 0) failures.push('detail open triggered full pipeline');
if ((appMetrics?.profiler?.brain?.commits ?? 0) === 0) failures.push('brain profiler observed no commits');
if (memoryDelta != null && memoryBefore.usedJSHeapSize && memoryDelta > Math.max(5_000_000, memoryBefore.usedJSHeapSize * 0.25)) failures.push(`clear retained heap growth ${memoryDelta} bytes`);
await browser.close();
if (failures.length) throw new Error(`browser closure failed: ${failures.join('; ')}`);
