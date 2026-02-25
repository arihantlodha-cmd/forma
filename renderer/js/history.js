/* ─── HISTORY MODULE ─────────────────────────────────────────────────────── */

const History = (() => {
  let _mode = '';

  function filterMode(btn, mode) {
    _mode = mode;
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    search();
  }

  async function search() {
    const q   = document.getElementById('hist-search').value.trim();
    const list = document.getElementById('hist-list');
    list.innerHTML = '<div style="color:var(--text-4);font-size:11px;padding:8px 0;">Loading…</div>';

    try {
      const items = await API.search(q, _mode);
      render(items);
    } catch (e) {
      list.innerHTML = `<div style="color:var(--red);font-size:11px;">${e.message}</div>`;
    }
  }

  function render(items) {
    const list = document.getElementById('hist-list');
    if (!items.length) {
      list.innerHTML = '<div style="color:var(--text-4);font-size:11px;padding:8px 0;">No results.</div>';
      return;
    }
    list.innerHTML = items.map(item => `
      <div class="h-item" onclick="History.load(${JSON.stringify(JSON.stringify(item))})">
        <div class="h-item-top">
          <span class="h-mode">${item.mode}</span>
          <span class="h-time">${_ago(item.created_at)}</span>
        </div>
        <div class="h-q">${_esc(item.question)}</div>
        <div class="h-a">${_esc(item.answer.slice(0, 80))}</div>
      </div>
    `).join('');
  }

  function load(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    // Switch to analyzer view and show result
    App.showView('analyzer');
    // Show the saved analysis in the output panel
    const rb = document.getElementById('resp-body');
    rb.innerHTML = item.answer.replace(
      /^(Step\s+\d+[:.)]?|\d+[.)]\s)/gm,
      '<span class="step-num">$1</span>'
    );
    rb.style.display = 'block';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('question').value = item.question;

    const badge = document.getElementById('out-mode-badge');
    badge.textContent = item.mode.toUpperCase();
    badge.style.display = '';

    document.getElementById('foot-mode').textContent = item.mode.toUpperCase();
    document.getElementById('out-foot').style.display = 'flex';
    document.getElementById('btn-copy').style.display = '';
  }

  async function refresh() {
    if (document.getElementById('view-history').style.display !== 'none') {
      await search();
    }
  }

  async function exportAll() {
    if (!confirm('Export all history to PDF?')) return;
    // Get all analyses and export each
    const items = await API.search('', '', 0, 0);
    if (!items.length) { alert('No analyses to export.'); return; }
    // For individual exports we open the project export (all)
    await window.forma.openExternal(API.exportPdfUrl('all'));
  }

  async function clearAll() {
    if (!confirm('Delete all analysis history? This cannot be undone.')) return;
    // No bulk delete endpoint — inform user
    alert('To clear history, delete forma.db from the app folder and restart.');
  }

  function _ago(ts) {
    const d = Date.now() / 1000 - ts;
    if (d < 60)   return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { filterMode, search, render, load, refresh, exportAll, clearAll };
})();
