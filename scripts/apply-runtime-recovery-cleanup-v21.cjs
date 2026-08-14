const fs = require('fs');

function replaceOnce(src, oldText, newText, label) {
  if (!src.includes(oldText)) throw new Error(label + ' anchor not found');
  return src.replace(oldText, newText);
}

{
  const file = 'src/lib/appRecovery.ts';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "export function logRuntimeError(source: string, error: unknown) {\n  console.error(`[Dawaa ${source}]`, error);\n  if (typeof window !== 'undefined') recordRuntimeError(source, error);\n}\n",
    "export function logRuntimeError(source: string, error: unknown) {\n  console.error(`[Dawaa ${source}]`, error);\n  if (typeof window !== 'undefined') recordRuntimeError(source, error);\n}\n\nexport function clearRecoveredRuntimeError() {\n  if (typeof window === 'undefined') return false;\n  try {\n    const raw = window.sessionStorage.getItem(LAST_RUNTIME_ERROR_KEY);\n    if (!raw) return false;\n    const parsed = JSON.parse(raw) as { source?: string; message?: string };\n    const source = String(parsed?.source || '');\n    const message = String(parsed?.message || '');\n    const recoverable =\n      source === 'index recovery' ||\n      source === 'bootstrap App import failed' ||\n      /asset load failed|chunk|dynamically imported module|failed to fetch dynamically imported module/i.test(message);\n    if (!recoverable) return false;\n    window.sessionStorage.removeItem(LAST_RUNTIME_ERROR_KEY);\n    window.sessionStorage.removeItem('dawaa_health_banner_dismissed_error');\n    return true;\n  } catch {\n    return false;\n  }\n}\n",
    'appRecovery helper',
  );
  fs.writeFileSync(file, src);
}

{
  const file = 'src/main.tsx';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "import { logRuntimeError } from '@/lib/appRecovery';",
    "import { clearRecoveredRuntimeError, logRuntimeError } from '@/lib/appRecovery';",
    'main import',
  );
  src = replaceOnce(
    src,
    "    window.__DAWAA_REACT_BOOTSTRAPPED = true;\n    return normalizeDefault(module);",
    "    window.__DAWAA_REACT_BOOTSTRAPPED = true;\n    clearRecoveredRuntimeError();\n    try { sessionStorage.removeItem('dawaa_stale_chunk_reload_at'); } catch { /* ignore storage failures */ }\n    return normalizeDefault(module);",
    'main bootstrap success',
  );
  fs.writeFileSync(file, src);
}

{
  const file = 'src/components/system/AppHealthBanner.tsx';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "import { LAST_RUNTIME_ERROR_KEY } from '@/lib/appRecovery';",
    "import { clearRecoveredRuntimeError, LAST_RUNTIME_ERROR_KEY } from '@/lib/appRecovery';",
    'banner import',
  );
  src = replaceOnce(
    src,
    "      const lastError = window.sessionStorage.getItem(LAST_RUNTIME_ERROR_KEY);\n      const dismissed = window.sessionStorage.getItem(DISMISSED_KEY);\n      if (lastError && dismissed !== lastError) setError(lastError);",
    "      if (window.__DAWAA_REACT_BOOTSTRAPPED && clearRecoveredRuntimeError()) {\n        setError(null);\n        return;\n      }\n      const lastError = window.sessionStorage.getItem(LAST_RUNTIME_ERROR_KEY);\n      const dismissed = window.sessionStorage.getItem(DISMISSED_KEY);\n      if (lastError && dismissed !== lastError) setError(lastError);",
    'banner stale recovery',
  );
  fs.writeFileSync(file, src);
}

{
  const file = 'index.html';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "          var target = event.target;\n          var isAssetFailure = target && target !== window && (target.tagName === 'SCRIPT' || target.tagName === 'LINK');\n          var message = event.message || (isAssetFailure ? 'asset load failed' : '');\n          if (/module|script|chunk|CSP|Content Security Policy|asset load failed/i.test(message)) {\n            showRecovery('module_error', message);\n          }",
    "          var target = event.target;\n          var isScriptFailure = target && target !== window && target.tagName === 'SCRIPT';\n          var isCriticalStylesheetFailure = target && target !== window && target.tagName === 'LINK' && String(target.rel || '').toLowerCase() === 'stylesheet' && String(target.href || '').indexOf(window.location.origin) === 0;\n          var isAssetFailure = isScriptFailure || isCriticalStylesheetFailure;\n          var message = event.message || (isAssetFailure ? 'asset load failed' : '');\n          if (isAssetFailure || /module|script|chunk|CSP|Content Security Policy/i.test(message)) {\n            showRecovery('module_error', message || 'critical asset load failed');\n          }",
    'index asset filter',
  );
  fs.writeFileSync(file, src);
}
