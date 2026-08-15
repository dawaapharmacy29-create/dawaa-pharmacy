/* Lightweight page-scoped refresh + compatibility helper.
   It never talks to Supabase directly and never writes data. It keeps the Customer Requests
   page refreshed and normalizes the legacy branch option values used by the UI to the canonical
   branch names stored in the management database. */
(function () {
  var INTERVAL_MS = 45000;
  var timer = null;
  var observer = null;

  function onCustomerRequestsPage() {
    return window.location.pathname === '/customer-requests' || window.location.pathname.startsWith('/customer-requests/');
  }

  function canonicalBranch(value) {
    var text = String(value || '').trim();
    if (text === 'دواء شكري' || text === 'شكري' || text === 'فرع شكري') return 'فرع شكري';
    if (text === 'دواء الشامي' || text === 'الشامي' || text === 'فرع الشامي') return 'فرع الشامي';
    return text;
  }

  function normalizeBranchUrlBeforeAppBoot() {
    if (!onCustomerRequestsPage()) return;
    try {
      var url = new URL(window.location.href);
      var current = url.searchParams.get('branch');
      var normalized = canonicalBranch(current);
      if (current && normalized && current !== normalized) {
        url.searchParams.set('branch', normalized);
        window.history.replaceState(window.history.state, '', url.toString());
      }
    } catch (_) {}
  }

  function normalizeBranchOptions() {
    if (!onCustomerRequestsPage()) return;
    var options = document.querySelectorAll('select option');
    options.forEach(function (option) {
      var normalized = canonicalBranch(option.value);
      if (normalized && normalized !== option.value && (normalized === 'فرع شكري' || normalized === 'فرع الشامي')) {
        option.value = normalized;
      }
    });
  }

  function triggerExistingRefresh() {
    if (!onCustomerRequestsPage() || document.hidden) return;
    normalizeBranchOptions();
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var refresh = buttons.find(function (button) {
      var text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      return text === 'تحديث' && !button.disabled;
    });
    if (refresh) refresh.click();
  }

  function start() {
    if (timer) window.clearInterval(timer);
    if (observer) observer.disconnect();
    if (!onCustomerRequestsPage()) return;
    normalizeBranchOptions();
    timer = window.setInterval(triggerExistingRefresh, INTERVAL_MS);
    observer = new MutationObserver(normalizeBranchOptions);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  normalizeBranchUrlBeforeAppBoot();
  window.addEventListener('popstate', start);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) triggerExistingRefresh();
  });
  window.addEventListener('focus', triggerExistingRefresh);
  start();
})();
