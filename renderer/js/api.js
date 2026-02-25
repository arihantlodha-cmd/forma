/* ─── FORMA API CLIENT ───────────────────────────────────────────────────── */

const API = (() => {
  let _port   = null;
  let _pw     = '';
  let _apiKey = '';   // user-provided OpenAI key (browser mode)
  const _electron = !!(window.forma);

  async function getPort() {
    if (!_port && _electron) _port = await window.forma.getFlaskPort();
    return _port;
  }

  function base() {
    return _electron ? `http://127.0.0.1:${_port}` : '';
  }

  function headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (_pw)     h['X-Forma-Key']   = _pw;
    if (_apiKey) h['X-OpenAI-Key']  = _apiKey;
    return h;
  }

  function multipartHeaders() {
    const h = {};
    if (_pw)     h['X-Forma-Key']  = _pw;
    if (_apiKey) h['X-OpenAI-Key'] = _apiKey;
    return h;
  }

  async function init() {
    if (_electron) await getPort();
    _pw     = localStorage.getItem('forma_pw')      || '';
    _apiKey = localStorage.getItem('forma_api_key') || '';
  }

  function setPassword(pw) {
    _pw = pw;
    localStorage.setItem('forma_pw', pw);
  }

  function setApiKey(key) {
    _apiKey = key;
    if (key) localStorage.setItem('forma_api_key', key);
    else     localStorage.removeItem('forma_api_key');
  }

  function getApiKey() { return _apiKey; }

  async function ping() {
    const r = await fetch(`${base()}/ping`);
    return r.json();
  }

  async function stats() {
    const r = await fetch(`${base()}/stats`, { headers: headers() });
    return r.json();
  }

  async function auth(key) {
    const r = await fetch(`${base()}/auth`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ key })
    });
    return r.json();
  }

  async function search(q = '', mode = '', from = 0, to = 0) {
    const params = new URLSearchParams({ q, limit: 100 });
    if (mode) params.set('mode', mode);
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    const r = await fetch(`${base()}/search?${params}`, { headers: headers() });
    return r.json();
  }

  async function save(data) {
    const r = await fetch(`${base()}/save`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify(data)
    });
    return r.json();
  }

  async function getProjects() {
    const r = await fetch(`${base()}/projects`, { headers: headers() });
    return r.json();
  }

  async function createProject(name, emoji = '📁') {
    const r = await fetch(`${base()}/projects`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name, emoji })
    });
    return r.json();
  }

  async function deleteProject(pid) {
    const r = await fetch(`${base()}/projects/${pid}`, {
      method: 'DELETE', headers: headers()
    });
    return r.json();
  }

  async function updateProject(pid, data) {
    const r = await fetch(`${base()}/projects/${pid}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify(data)
    });
    return r.json();
  }

  async function projectAnalyses(pid) {
    const r = await fetch(`${base()}/projects/${pid}/analyses`, { headers: headers() });
    return r.json();
  }

  async function moveAnalysis(aid, project_id) {
    const r = await fetch(`${base()}/analyses/${aid}/move`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ project_id })
    });
    return r.json();
  }

  function exportPdfUrl(sid) { return `${base()}/export/${sid}/pdf`; }
  function projectPdfUrl(pid) { return `${base()}/projects/${pid}/export/pdf`; }

  // Streaming analyze
  async function analyze({ imageFile, question, mode, history = [], onToken, onError }) {
    if (_electron) await getPort();
    const fd = new FormData();
    fd.append('image',    imageFile);
    fd.append('question', question);
    fd.append('mode',     mode);
    fd.append('history',  JSON.stringify(history));

    const res = await fetch(`${base()}/analyze`, {
      method: 'POST', headers: multipartHeaders(), body: fd
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      onError(err.error || 'Request failed');
      return '';
    }

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';
    let   full   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return full;
        try {
          const obj = JSON.parse(raw);
          if (obj.error) { onError(obj.error); return full; }
          if (obj.token) { full += obj.token; onToken(obj.token); }
        } catch {}
      }
    }
    return full;
  }

  async function batch({ files, questions, mode, projectId }) {
    if (_electron) await getPort();
    const fd = new FormData();
    for (const f of files)   fd.append('images',    f);
    for (const q of questions) fd.append('questions', q);
    fd.append('mode', mode);
    if (projectId) fd.append('project_id', projectId);

    const res = await fetch(`${base()}/batch`, {
      method: 'POST', headers: multipartHeaders(), body: fd
    });
    return res.json();
  }

  async function saveConfig(apiKey, password) {
    if (_electron) await getPort();
    const r = await fetch(`${base()}/config`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ api_key: apiKey, password })
    });
    return r.ok;
  }

  return {
    init, setPassword, setApiKey, getApiKey,
    ping, stats, auth,
    search, save, getProjects, createProject, deleteProject,
    updateProject, projectAnalyses, moveAnalysis,
    exportPdfUrl, projectPdfUrl,
    analyze, batch, saveConfig,
    get pw()   { return _pw; },
    get port() { return _port; },
    get hasKey() { return !!(_apiKey || _electron); },
  };
})();
