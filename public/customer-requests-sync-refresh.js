/* Lightweight page-scoped refresh helper.
   It never talks to Supabase directly and never writes data. It simply triggers the existing
   Customer Requests refresh control while that page is open, so newly synchronized Base44
   requests appear without requiring a manual browser refresh. */
(function () {
  var INTERVAL_MS = 45000;
  var timer = null;

  function onCustomerRequestsPage() {
    return window.location.pathname === '/customer-requests' || window.location.pathname.startsWith('/customer-requests/');
  }

  function triggerExistingRefresh() {
    if (!onCustomerRequestsPage() || document.hidden) return;
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var refresh = buttons.find(function (button) {
      var text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      return text === 'تحديث' && !button.disabled;
    });
    if (refresh) refresh.click();
  }

  function start() {
    if (timer) window.clearInterval(timer);
    if (!onCustomerRequestsPage()) return;
    timer = window.setInterval(triggerExistingRefresh, INTERVAL_MS);
  }

  window.addEventListener('popstate', start);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) triggerExistingRefresh();
  });
  window.addEventListener('focus', triggerExistingRefresh);
  start();
})();
