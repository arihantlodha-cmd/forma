/* ─── PROJECTS MODULE ────────────────────────────────────────────────────── */

const Projects = (() => {

  async function load() {
    const list = document.getElementById('proj-list');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--text-4);font-size:11px;padding:8px 0;">Loading…</div>';

    try {
      const projects = await API.getProjects();
      render(projects);
      // Also refresh project dropdowns in analyzer and batch
      Analyzer.refreshProjectSelect();
      Batch.refreshProjectSelect();
    } catch (e) {
      list.innerHTML = `<div style="color:var(--red);font-size:11px;">${e.message}</div>`;
    }
  }

  function render(projects) {
    const list = document.getElementById('proj-list');
    if (!projects.length) {
      list.innerHTML = '<div style="color:var(--text-4);font-size:11px;padding:8px 0;">No projects yet. Create one above.</div>';
      return;
    }
    list.innerHTML = projects.map(p => `
      <div class="project-item">
        <span class="project-emoji">${p.emoji}</span>
        <span class="project-name">${_esc(p.name)}</span>
        <span class="project-count">${p.analysis_count} analyses</span>
        <button class="btn btn-ghost" style="padding:2px 6px;font-size:10px;"
          onclick="Projects.exportPdf('${p.id}')" title="Export PDF">PDF</button>
        <button class="btn btn-danger" style="padding:2px 6px;font-size:10px;"
          onclick="Projects.remove('${p.id}', this)" title="Delete project">✕</button>
      </div>
    `).join('');
  }

  function showCreate() {
    document.getElementById('project-create-form').style.display = '';
    document.getElementById('new-proj-name').focus();
  }

  function hideCreate() {
    document.getElementById('project-create-form').style.display = 'none';
    document.getElementById('new-proj-name').value  = '';
    document.getElementById('new-proj-emoji').value = '📁';
  }

  async function create() {
    const name  = document.getElementById('new-proj-name').value.trim();
    const emoji = document.getElementById('new-proj-emoji').value.trim() || '📁';
    if (!name) { alert('Project name is required.'); return; }

    const result = await API.createProject(name, emoji);
    if (result.id) {
      hideCreate();
      await load();
    } else {
      alert(result.error || 'Failed to create project.');
    }
  }

  async function remove(pid, btn) {
    if (!confirm('Delete this project? Analyses will be kept but unassigned.')) return;
    btn.disabled = true;
    await API.deleteProject(pid);
    await load();
  }

  async function exportPdf(pid) {
    const url = API.projectPdfUrl(pid);
    if (window.forma) await window.forma.openExternal(url);
    else window.open(url, '_blank');
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { load, render, showCreate, hideCreate, create, remove, exportPdf };
})();
