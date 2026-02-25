/* ─── BATCH MODULE ───────────────────────────────────────────────────────── */

const Batch = (() => {
  let _files = [];
  let _mode  = 'deep';

  function onFiles(fileList) {
    _files = Array.from(fileList);
    renderFileList();
  }

  function renderFileList() {
    const el = document.getElementById('batch-file-list');
    if (!_files.length) { el.innerHTML = ''; return; }
    el.innerHTML = _files.map((f, i) => `
      <div class="batch-file">
        <span class="batch-file-name">${_esc(f.name)}</span>
        <span class="batch-file-status" id="batch-status-${i}">
          ${(f.size / 1024).toFixed(0)} KB
        </span>
      </div>
    `).join('');
  }

  function setMode(m) {
    _mode = m;
    document.querySelectorAll('#view-batch .mode-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === m);
    });
  }

  async function submit() {
    if (!_files.length) { alert('Please select images first.'); return; }
    const q = document.getElementById('batch-question').value.trim();
    if (!q) { alert('Please enter a question.'); return; }

    const btn = document.getElementById('btn-batch-submit');
    const lbl = document.getElementById('btn-batch-label');
    btn.disabled = true;
    lbl.textContent = 'Running…';

    const bar  = document.getElementById('batch-progress-bar');
    const fill = document.getElementById('batch-progress-fill');
    bar.style.display = '';
    fill.style.width  = '0%';

    const pid = document.getElementById('batch-project-select').value || undefined;

    try {
      const result = await API.batch({
        files: _files,
        questions: _files.map(() => q),
        mode: _mode,
        projectId: pid,
      });

      fill.style.width = '100%';
      renderResults(result.results || []);
      History.refresh();
      Projects.load();
    } catch (e) {
      document.getElementById('batch-results').innerHTML =
        `<div style="color:var(--red);font-size:11px;margin-top:8px;">${e.message}</div>`;
    }

    btn.disabled   = false;
    lbl.textContent = 'Run Batch';
    bar.style.display = 'none';
  }

  function renderResults(results) {
    const el = document.getElementById('batch-results');
    if (!results.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="sect-label" style="margin:8px 0 6px;">Results</div>' +
      results.map(r => `
        <div style="padding:8px;background:var(--surf);border:1px solid var(--border);
          border-radius:6px;margin-bottom:6px;">
          <div style="font-size:10px;font-family:var(--font-mono);color:var(--text-4);
            margin-bottom:4px;">${_esc(r.filename || '')}</div>
          ${r.error
            ? `<div style="color:var(--red);font-size:11px;">${_esc(r.error)}</div>`
            : `<div style="font-size:11px;color:var(--text-2);white-space:pre-wrap;
                word-break:break-word;max-height:100px;overflow:hidden;">${_esc((r.answer||'').slice(0,200))}</div>`
          }
        </div>
      `).join('');
  }

  async function refreshProjectSelect() {
    const sel = document.getElementById('batch-project-select');
    if (!sel) return;
    const projects = await API.getProjects();
    const cur = sel.value;
    sel.innerHTML = '<option value="">— None —</option>' +
      projects.map(p => `<option value="${p.id}">${p.emoji} ${p.name}</option>`).join('');
    if (cur) sel.value = cur;
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { onFiles, setMode, submit, renderResults, refreshProjectSelect };
})();
