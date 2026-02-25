/* ─── SETTINGS MODULE ────────────────────────────────────────────────────── */

const Settings = (() => {

  async function load() {
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
      el.textContent = p.ok ? '● Connected' : '✕ Not connected';
      el.className   = `api-status ${p.ok ? 'ok' : 'err'}`;
    } catch {
      const el = document.getElementById('api-status');
      el.textContent = '✕ Flask offline';
      el.className   = 'api-status err';
    }
  }

  async function saveKey() {
    const key = document.getElementById('settings-key').value.trim();
    if (!key) return;
    const ok = await API.saveConfig(key, document.getElementById('settings-pw').value.trim());
    if (ok) {
      document.getElementById('settings-key').value = '';
      alert('API key saved. Restart Forma to apply.');
    } else {
      alert('Failed to save. Check that the Flask server is running.');
    }
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
