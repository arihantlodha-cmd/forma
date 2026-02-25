/* ─── APP BOOTSTRAP ──────────────────────────────────────────────────────── */

const App = (() => {
  let _currentView = 'analyzer';

  function showView(name) {
    _currentView = name;
    // Toggle views
    document.querySelectorAll('.view').forEach(v => {
      v.style.display = v.id === `view-${name}` ? (name === 'analyzer' ? 'flex' : 'flex') : 'none';
    });
    // Toggle sidebar active
    document.querySelectorAll('.nav-item[data-view]').forEach(b => {
      b.classList.toggle('active', b.dataset.view === name);
    });

    // Lazy-load view data
    if (name === 'history')  History.search();
    if (name === 'projects') Projects.load();
    if (name === 'settings') Settings.load();
  }

  async function init() {
    const isElectron = !!(window.forma);

    // Title bar: hide entirely in browser, show platform-correct controls in Electron
    if (!isElectron) {
      document.getElementById('titlebar').style.display = 'none';
      // Adjust grid so there's no titlebar row
      document.getElementById('app').style.gridTemplateRows = '1fr var(--statusbar-h)';
      document.getElementById('app').style.gridTemplateAreas = '"sidebar main" "statusbar statusbar"';
    } else {
      const isMac = navigator.platform.includes('Mac') ||
                    (navigator.userAgent.includes('Electron') && process?.platform === 'darwin');
      if (!isMac) {
        document.getElementById('traffic').style.display = 'none';
        document.getElementById('win-controls').classList.add('visible');
      }
    }

    // Init API
    await API.init();

    // Connect to Flask and check status
    checkStatus();
    setInterval(checkStatus, 30000);

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Init annotation module
    Ann.init();

    // Drag-and-drop on upload zone
    const zone = document.getElementById('upload-zone');
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) Analyzer.onFile(f);
    });

    // Also drag-and-drop on whole window (for convenience)
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/') && _currentView === 'analyzer') {
        Analyzer.onFile(f);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') { e.preventDefault(); Analyzer.reset(); showView('analyzer'); }
      if (mod && e.key === '/') { e.preventDefault(); document.getElementById('shortcuts-overlay').classList.add('open'); }
      if (e.key === 'Escape')  { document.getElementById('shortcuts-overlay').classList.remove('open'); }
    });

    // Electron-only: menu events
    if (isElectron) {
      window.forma.on('new-analysis',   () => { Analyzer.reset(); showView('analyzer'); });
      window.forma.on('open-image',     () => document.getElementById('file-input').click());
      window.forma.on('open-settings',  () => showView('settings'));
      window.forma.on('toggle-history', () => showView(_currentView === 'history' ? 'analyzer' : 'history'));
      window.forma.on('show-shortcuts', () => document.getElementById('shortcuts-overlay').classList.add('open'));
    }

    // Load initial project list for selects
    Analyzer.refreshProjectSelect();
  }

  async function checkStatus() {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    try {
      const p = await API.ping();
      dot.className  = 'status-dot connected';
      text.textContent = p.protected ? 'Connected · Protected' : 'Connected';
      document.getElementById('status-uses').textContent = '';
      // Update stats in status bar
      try {
        const s = await API.stats();
        document.getElementById('status-uses').textContent =
          `${s.uses_this_minute}/${s.rate_limit} rpm`;
        document.getElementById('status-sep').style.display = '';
      } catch {}
    } catch {
      dot.className  = 'status-dot error';
      text.textContent = 'Flask offline';
      document.getElementById('status-sep').style.display = 'none';
    }
  }

  function updateClock() {
    const el = document.getElementById('status-time');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  // Expose to global
  return { showView, init };
})();

// Bootstrap on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => App.init());
