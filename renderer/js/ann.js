/* ─── ANNOTATION MODULE ──────────────────────────────────────────────────── */

const Ann = (() => {
  let canvas, ctx, img;
  let tool   = 'arrow';
  let shapes = [];  // saved shapes
  let drawing = false;
  let start  = { x: 0, y: 0 };
  let penPath = [];

  function init() {
    canvas = document.getElementById('ann-canvas');
    img    = document.getElementById('preview-img');
    ctx    = canvas.getContext('2d');

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup',   onUp);
    canvas.addEventListener('mouseleave', () => { drawing = false; });
  }

  function resize() {
    canvas.width  = img.clientWidth;
    canvas.height = img.clientHeight;
    redraw();
  }

  function rel(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    drawing = true;
    start   = rel(e);
    if (tool === 'pen') penPath = [start];
  }

  function onMove(e) {
    if (!drawing) return;
    const p = rel(e);
    if (tool === 'pen') {
      penPath.push(p);
      redraw();
      drawPenPreview();
    } else {
      redraw();
      drawPreview(start, p);
    }
  }

  function onUp(e) {
    if (!drawing) return;
    drawing = false;
    const p = rel(e);
    if (tool === 'pen') {
      if (penPath.length > 1) shapes.push({ type: 'pen', path: [...penPath] });
    } else {
      const dx = p.x - start.x, dy = p.y - start.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      shapes.push({ type: tool, x: start.x, y: start.y, ex: p.x, ey: p.y });
    }
    redraw();
    penPath = [];
  }

  function drawPreview(s, e) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 2;

    if (tool === 'arrow') {
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const al = 10, aw = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x - al * Math.cos(angle - aw), e.y - al * Math.sin(angle - aw));
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x - al * Math.cos(angle + aw), e.y - al * Math.sin(angle + aw));
      ctx.stroke();
    } else if (tool === 'rect') {
      ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y);
    } else if (tool === 'circle') {
      const rx = Math.abs(e.x - s.x) / 2, ry = Math.abs(e.y - s.y) / 2;
      const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPenPreview() {
    if (penPath.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(penPath[0].x, penPath[0].y);
    for (let i = 1; i < penPath.length; i++) ctx.lineTo(penPath[i].x, penPath[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of shapes) {
      ctx.save();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 2;
      if (s.type === 'arrow') {
        const angle = Math.atan2(s.ey - s.y, s.ex - s.x);
        const al = 10, aw = Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y); ctx.lineTo(s.ex, s.ey);
        ctx.moveTo(s.ex, s.ey);
        ctx.lineTo(s.ex - al * Math.cos(angle - aw), s.ey - al * Math.sin(angle - aw));
        ctx.moveTo(s.ex, s.ey);
        ctx.lineTo(s.ex - al * Math.cos(angle + aw), s.ey - al * Math.sin(angle + aw));
        ctx.stroke();
      } else if (s.type === 'rect') {
        ctx.strokeRect(s.x, s.y, s.ex - s.x, s.ey - s.y);
      } else if (s.type === 'circle') {
        const rx = Math.abs(s.ex - s.x) / 2, ry = Math.abs(s.ey - s.y) / 2;
        const cx = (s.x + s.ex) / 2, cy = (s.y + s.ey) / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (s.type === 'pen') {
        ctx.beginPath(); ctx.moveTo(s.path[0].x, s.path[0].y);
        for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i].x, s.path[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function setTool(t) {
    tool = t;
    document.querySelectorAll('.ann-tool[id^="tool-"]').forEach(b => {
      b.classList.toggle('active', b.id === `tool-${t}`);
    });
    canvas.style.cursor = t === 'pen' ? 'crosshair' : 'crosshair';
  }

  function undo() {
    shapes.pop();
    redraw();
  }

  function clear() {
    shapes = [];
    redraw();
  }

  function toggleToolbar() {
    const tb = document.getElementById('ann-toolbar');
    const show = !tb.classList.contains('visible');
    tb.classList.toggle('visible', show);
    canvas.style.display = show ? 'block' : 'none';
    if (show) {
      resize();
      setTool('arrow');
    }
  }

  function hide() {
    const tb = document.getElementById('ann-toolbar');
    tb.classList.remove('visible');
    canvas.style.display = 'none';
    clear();
  }

  // Returns a blob with annotations merged onto the image, or null if no annotations
  async function getAnnotatedBlob(originalFile) {
    if (shapes.length === 0) return null;
    const offscreen = document.createElement('canvas');
    offscreen.width  = canvas.width;
    offscreen.height = canvas.height;
    const oc = offscreen.getContext('2d');
    oc.drawImage(img, 0, 0, canvas.width, canvas.height);
    oc.drawImage(canvas, 0, 0);
    return new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
  }

  return { init, resize, setTool, undo, clear, toggleToolbar, hide, getAnnotatedBlob };
})();
