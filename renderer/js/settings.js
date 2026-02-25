/* ─── SETTINGS MODULE ────────────────────────────────────────────────────── */

const Settings = (() => {

  async function load() {
    // Pre-fill key input with stored key (masked)
    const stored = API.getApiKey();
    if (stored) document.getElementById('settings-key').placeholder = '••••••••••• (key saved)';

    // Load stats
    try {
      const s = await API.stats();
      document.getElementById('stat-total').textContent = s.total_analyses ?? '—';
      document.getElementById('stat-db').textContent    = s.db_size_kb != null ? `${s.db_size_kb} KB` : '—';
      document.getElementById('stat-rate').textContent  = s.rate_limit != null
        ? `${s.uses_this_minute} / ${s.rate_limit} per min` : '—';
    } catch {}

    // Show API key status
    try {
      const p = await API.ping();
      const el = document.getElementById('api-status');
      const hasKey = p.has_key || API.hasKey;
      el.textContent = hasKey ? '● Key configured' : '✕ No API key set';
      el.className   = `api-status ${hasKey ? 'ok' : 'err'}`;
    } catch {
      const el = document.getElementById('api-status');
      el.textContent = '✕ Flask offline';
      el.className   = 'api-status err';
    }
  }

  async function saveKey() {
    const key = document.getElementById('settings-key').value.trim();
    if (!key) return;
    // Store in browser for per-request use
    API.setApiKey(key);
    // Also push to server (for Electron or server-side key)
    await API.saveConfig(key, '').catch(() => {});
    document.getElementById('settings-key').value = '';
    // Update status indicator
    const el = document.getElementById('api-status');
    el.textContent = '● Key saved';
    el.className   = 'api-status ok';
    App.checkStatus();
  }

  async function savePw() {
    const pw = document.getElementById('settings-pw').value;
    API.setPassword(pw);
    alert(pw ? 'Password set.' : 'Password cleared.');
  }

  async function clearHistory() {
    if (!confirm('This will delete forma.db. Forma will restart. Continue?')) return;
    alert('Close Forma, delete forma.db from the app folder, then reopen.');
  }

  return { load, saveKey, savePw, clearHistory };
})();
