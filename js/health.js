// ============================================================
//  HEALTH.JS — Auto maintenance redirect
//  Included in every HTML page (except maintenance.html)
//  Pings Supabase health endpoint silently on load.
//  If Supabase is unreachable → redirects to maintenance.html
// ============================================================
(async function healthCheck() {
  // Don't run on maintenance page itself
  if (window.location.pathname.includes('maintenance')) return;

  // Don't run on login/index — let them load first (auth handles errors)
  // Only run on dashboard and setup where DB is critical
  const critical = ['/dashboard', '/setup'];
  const isCritical = critical.some(p => window.location.pathname.includes(p));
  if (!isCritical) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const res = await fetch(
      'https://yccxlyghjrbpchryrtl.supabase.co/rest/v1/',
      {
        method: 'HEAD',
        headers: { 'apikey': SUPABASE_ANON_KEY },
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    // 503 or network failure = down
    if (res.status === 503 || res.status === 0) {
      goMaintenance();
    }
  } catch (e) {
    // AbortError = timeout, TypeError = network error — both mean down
    goMaintenance();
  }

  function goMaintenance() {
    sessionStorage.setItem('bf_return', window.location.href);
    window.location.href = '/maintenance.html';
  }
})();
