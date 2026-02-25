/* ─── ANALYZER MODULE ────────────────────────────────────────────────────── */

const Analyzer = (() => {
  let _file    = null;
  let _mode    = 'deep';
  let _running = false;
  let _savedId = null;
  let _savedUrl = null;
  let _fullText = '';
  let _tokenCount = 0;
  let _history = [];   // conversation turns [{role,text}]

  // ── State helpers ────────────────────────────────────────────────────────

  function showEl(id)  { const e = document.getElementById(id); if (e) e.style.display = ''; }
  function hideEl(id)  { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  function flexEl(id)  { const e = document.getElementById(id); if (e) e.style.display = 'flex'; }
  function blockEl(id) { const e = document.getElementById(id); if (e) e.style.display = 'block'; }

  function setIdle() {
    _running = false;
    const lbl = document.getElementById('btn-submit-label');
    const btn = document.getElementById('btn-submit');
    if (lbl) lbl.textContent = 'Analyse';
    if (btn) btn.disabled = false;
  }

  function setBusy() {
    _running = true;
    const lbl = document.getElementById('btn-submit-label');
    const btn = document.getElementById('btn-submit');
    if (lbl) lbl.textContent = 'Analysing…';
    if (btn) btn.disabled = true;
  }

  // ── Upload / preview ────────────────────────────────────────────────────

  function onFile(file) {
    if (!file) return;
    _file = file;
    _history = [];

    const reader = new FileReader();
    reader.onload = e => {
      const img = document.getElementById('preview-img');
      if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);

    document.getElementById('upload-zone').style.display   = 'none';
    document.getElementById('preview-wrap').style.display  = 'block';
    document.getElementById('preview-name').textContent    = file.name;
    document.getElementById('compress-info').textContent   =
      `${(file.size / 1024).toFixed(0)} KB`;

    Ann.hide();

    // Wait for image to load then resize annotation canvas
    const img2 = document.getElementById('preview-img');
    img2.onload = () => Ann.resize();
  }

  function setQ(q) {
    const el = document.getElementById('question');
    if (el) { el.value = q; el.focus(); }
  }

  function setMode(m) {
    _mode = m;
    document.querySelectorAll('.mode-tab[data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === m);
    });
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  function reset() {
    _file     = null;
    _history  = [];
    _savedId  = null;
    _savedUrl = null;
    _fullText = '';
    _tokenCount = 0;

    document.getElementById('question').value = '';
    document.getElementById('upload-zone').style.display  = '';
    document.getElementById('preview-wrap').style.display = 'none';

    // Output reset
    hideEl('out-meta'); hideEl('skel-wrap'); hideEl('resp-body');
    hideEl('out-foot'); hideEl('share-bar'); hideEl('followup-section');
    hideEl('err-bar');  hideEl('btn-copy'); hideEl('btn-save');
    hideEl('btn-export-pdf'); hideEl('out-mode-badge');
    blockEl('empty-state');
    document.getElementById('conv-thread').innerHTML = '';
    document.getElementById('conv-thread').style.display = 'none';
    document.getElementById('resp-body').textContent = '';

    Ann.hide();
    setIdle();
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function submit() {
    if (_running) return;
    const q = document.getElementById('question').value.trim();
    if (!q)     { alert('Please enter a question.'); return; }
    if (!_file) { alert('Please select an image.'); return; }

    // Get annotated file if annotations exist
    let fileToSend = _file;
    const annBlob = await Ann.getAnnotatedBlob(_file);
    if (annBlob) fileToSend = new File([annBlob], _file.name, { type: 'image/png' });

    setBusy();
    _savedId = null; _savedUrl = null; _fullText = ''; _tokenCount = 0;

    // Hide empty state, show skeleton
    hideEl('empty-state'); hideEl('err-bar');
    flexEl('skel-wrap');   hideEl('resp-body');
    hideEl('out-foot');    hideEl('share-bar');
    hideEl('followup-section');
    hideEl('btn-copy'); hideEl('btn-save'); hideEl('btn-export-pdf');

    const badge = document.getElementById('out-mode-badge');
    badge.textContent = _mode.toUpperCase();
    badge.style.display = '';

    // Show meta
    document.getElementById('meta-mode').textContent   = _mode;
    document.getElementById('meta-tokens').textContent = '0 tokens';
    document.getElementById('meta-dot').classList.add('pulse');
    flexEl('out-meta');

    try {
      await API.analyze({
        imageFile: fileToSend,
        question: q,
        mode: _mode,
        history: _history,
        onToken: (tok) => {
          // Switch from skeleton to response on first token
          if (document.getElementById('skel-wrap').style.display !== 'none') {
            hideEl('skel-wrap');
            const rb = document.getElementById('resp-body');
            rb.textContent = '';
            rb.style.display = 'block';
          }
          _fullText   += tok;
          _tokenCount += 1;
          document.getElementById('meta-tokens').textContent = `${_tokenCount} tokens`;
          renderOutput(_fullText);
        },
        onError: (msg) => {
          hideEl('skel-wrap');
          const bar = document.getElementById('err-bar');
          bar.style.display = 'flex';
          document.getElementById('err-text').textContent = msg;
          hideEl('out-meta');
        },
      });
    } catch (e) {
      hideEl('skel-wrap');
      const bar = document.getElementById('err-bar');
      bar.style.display = 'flex';
      document.getElementById('err-text').textContent = e.message || 'Unknown error';
      hideEl('out-meta');
      setIdle();
      return;
    }

    // Done streaming
    document.getElementById('meta-dot').classList.remove('pulse');
    hideEl('out-meta');

    // Show footer
    document.getElementById('foot-mode').textContent   = _mode.toUpperCase();
    document.getElementById('foot-tokens').textContent = `${_tokenCount} tokens`;
    flexEl('out-foot');

    // Show action buttons
    showEl('btn-copy'); showEl('btn-save');

    // Show follow-up
    flexEl('followup-section');
    document.getElementById('fu-input').value = '';

    // Add to conversation history
    _history.push({ role: 'user',      text: q });
    _history.push({ role: 'assistant', text: _fullText });

    // Render conversation thread for subsequent turns
    renderThread();

    setIdle();
  }

  // ── Render output ────────────────────────────────────────────────────────

  function renderOutput(text) {
    const el = document.getElementById('resp-body');
    // Highlight step numbers
    el.innerHTML = text.replace(
      /^(Step\s+\d+[:.)]?|\d+[.)]\s)/gm,
      '<span class="step-num">$1</span>'
    );
    // Keep scroll at bottom while streaming
    el.scrollTop = el.scrollHeight;
  }

  function renderThread() {
    const th = document.getElementById('conv-thread');
    if (_history.length <= 2) { th.style.display = 'none'; th.innerHTML = ''; return; }

    // Show all but the latest turn (which is in resp-body)
    const prior = _history.slice(0, -2);
    th.innerHTML = prior.reduce((html, t, i) => {
      if (t.role === 'user') {
        return html + `<div class="conv-turn">
          <div class="conv-q"><div class="conv-q-label">You</div>${_esc(t.text)}</div>`;
      } else {
        const snip = t.text.length > 120 ? t.text.slice(0, 120) + '…' : t.text;
        return html + `<div class="conv-a">${_esc(snip)}</div></div>`;
      }
    }, '');
    th.style.display = 'block';
  }

  function _esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Follow-up ────────────────────────────────────────────────────────────

  async function followUp() {
    const inp = document.getElementById('fu-input');
    const q   = inp.value.trim();
    if (!q || _running) return;
    inp.value = '';
    document.getElementById('question').value = q;
    await submit();
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function copy() {
    try {
      await navigator.clipboard.writeText(_fullText);
      const btn = document.getElementById('btn-copy');
      btn.classList.add('ok');
      setTimeout(() => btn.classList.remove('ok'), 1200);
    } catch {}
  }

  async function save() {
    if (!_fullText) return;
    const q   = document.getElementById('question').value.trim();
    const pid = document.getElementById('project-select').value || null;

    // Thumbnail: first 50KB of image base64
    let imgB64 = null;
    try {
      const reader = new FileReader();
      imgB64 = await new Promise(res => {
        reader.onload = e => {
          const b64 = e.target.result.split(',')[1];
          res(b64.slice(0, 1024 * 68)); // ~50KB
        };
        reader.readAsDataURL(_file);
      });
    } catch {}

    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    const result = await API.save({
      question: q, answer: _fullText, mode: _mode,
      project_id: pid, image_b64: imgB64
    });

    if (result.id) {
      _savedId  = result.id;
      _savedUrl = result.url;
      btn.classList.add('ok');
      showEl('btn-export-pdf');
      document.getElementById('share-url').textContent = _savedUrl;
      flexEl('share-bar');
      History.refresh();
    } else {
      btn.disabled = false;
      alert(result.error || 'Save failed');
    }
  }

  async function copyShareUrl() {
    if (!_savedUrl) return;
    await navigator.clipboard.writeText(_savedUrl);
    const btn = document.getElementById('btn-copy-url');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
  }

  async function exportPdf() {
    if (!_savedId) return;
    const url = API.exportPdfUrl(_savedId);
    if (window.forma) await window.forma.openExternal(url);
    else window.open(url, '_blank');
  }

  // ── Populate project select ──────────────────────────────────────────────

  async function refreshProjectSelect() {
    const sel = document.getElementById('project-select');
    if (!sel) return;
    const projects = await API.getProjects();
    const cur = sel.value;
    sel.innerHTML = '<option value="">— None —</option>' +
      projects.map(p => `<option value="${p.id}">${p.emoji} ${p.name}</option>`).join('');
    if (cur) sel.value = cur;
  }

  return {
    onFile, setQ, setMode, reset, submit, followUp,
    copy, save, copyShareUrl, exportPdf,
    refreshProjectSelect,
  };
})();
