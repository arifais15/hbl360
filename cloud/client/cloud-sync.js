(() => {
  const tokenKey = 'pbs_loan_token';
  const cursorKey = 'hbl360_cloud_audit_cursor';
  let running = false;
  let timer;

  async function checkForChanges() {
    if (running) return;
    const token = localStorage.getItem(tokenKey);
    if (!token) return;

    running = true;
    try {
      const response = await fetch(`/api/sync/changes?since=${encodeURIComponent(localStorage.getItem(cursorKey) || '')}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (response.status === 401) {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem('pbs_loan_user');
        window.dispatchEvent(new CustomEvent('auth-expired'));
        return;
      }
      if (!response.ok) {
        throw new Error(`Cloud sync check failed with HTTP ${response.status}`);
      }
      const result = await response.json();
      if (result.latest) localStorage.setItem(cursorKey, result.latest);
      if (result.changed && window.CLOUD_EDITION && typeof window.switchTab === 'function') {
        const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
        if (activeTab) window.switchTab(activeTab);
        window.dispatchEvent(new CustomEvent('cloud-data-changed', { detail: { latest: result.latest } }));
      }
    } catch (error) {
      console.error('Cloud sync check failed:', error);
    } finally {
      running = false;
    }
  }

  function start() {
    clearInterval(timer);
    checkForChanges();
    timer = setInterval(checkForChanges, 5000);
  }

  window.addEventListener('storage', event => {
    if (event.key === tokenKey) start();
  });
  window.addEventListener('auth-expired', () => clearInterval(timer));
  start();
})();
