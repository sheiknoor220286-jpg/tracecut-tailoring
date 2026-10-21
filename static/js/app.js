const $ = id => document.getElementById(id);
const v = id => { const e = $(id); return e.type === 'checkbox' ? e.checked : e.value; };
const cv = $('cv'), ctx = cv.getContext('2d');
let img = null, file = null, data = null, timer = null;

const TIPS = {
  cotton: 'Press the fabric first and pre-wash if it will shrink.',
  denim: 'Use sharp heavy shears and cut one layer at a time; denim dulls blades fast.',
  silk: 'Place tissue paper under the fabric and use fine pins or weights to stop slipping.',
  knit: 'Do not stretch the fabric while cutting. Use weights, and rotary-cut if you can.',
  wool: 'Check for a nap or pattern direction and cut every piece the same way.'
};

// ---------- loading ----------
function load(f) {
  if (!f || !(f.type || '').startsWith('image/')) return toast('Choose an image file (JPG, PNG or WebP).');
  const im = new Image(), url = URL.createObjectURL(f);
  im.onerror = () => toast('This browser cannot read that image. Try a JPG or PNG (HEIC is not supported).');
  im.onload = () => {
    img = im; const s = Math.min(1, 900 / Math.max(im.width, im.height));
    iw = Math.round(im.width * s); ih = Math.round(im.height * s); cv.width = iw + 2 * PAD; cv.height = ih + 2 * PAD;
    // Shrink before upload so big phone photos never hit the server size limit.
    const tmp = document.createElement('canvas'); tmp.width = iw; tmp.height = ih;
    const t = tmp.getContext('2d'); t.fillStyle = '#fff'; t.fillRect(0, 0, iw, ih); t.drawImage(im, 0, 0, iw, ih);
    tmp.toBlob(b => { file = b; $('stage').classList.add('has'); analyze(); }, 'image/jpeg', 0.92);
  };
  im.src = url;
}
async function analyze() {
  if (!file) return;
  const fd = new FormData();
  fd.append('image', file, 'garment.jpg'); fd.append('ref', v('ref')); fd.append('seam', v('seam'));
  $('busy').hidden = false; toast('');
  try {
    let r; try { r = await fetch('/api/analyze', { method: 'POST', body: fd }); }
    catch { throw new Error('Cannot reach the server. Run "python app.py" and open http://127.0.0.1:5000 in the browser (do not open index.html as a file).'); }
    const txt = await r.text(); let j;
    try { j = JSON.parse(txt); } catch { throw new Error(r.status === 413 ? 'Image is too large.' : 'Server error (' + r.status + '). Check the terminal running app.py for details.'); }
    if (!r.ok) throw new Error(j.error || 'Could not trace this image.');
    data = j; $('download').disabled = false;
  } catch (e) { toast(e.message); }
  $('busy').hidden = true; draw(); steps();
}
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = !m; }

// ---------- drawing ----------
const PAD = 60;  // empty margin so arrows, notches and labels never get cropped
let iw = 0, ih = 0;
const X = p => PAD + p[0] * iw, Y = p => PAD + p[1] * ih;
function path(pts, close = true) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))); if (close) ctx.closePath(); }
function dash(w) { const s = v('style'); return s === 'dashed' ? [w * 4, w * 2.5] : s === 'dotted' ? [1, w * 2.2] : []; }
function arrow(x1, y1, x2, y2, col) {
  ctx.strokeStyle = ctx.fillStyle = col; ctx.setLineDash([]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  [[x2, y2, a], [x1, y1, a + Math.PI]].forEach(([x, y, t]) => {
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x - 11 * Math.cos(t - .4), y - 11 * Math.sin(t - .4));
    ctx.lineTo(x - 11 * Math.cos(t + .4), y - 11 * Math.sin(t + .4)); ctx.fill();
  });
}
function label(txt, x, y, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = '600 13px "DM Sans",sans-serif'; const w = ctx.measureText(txt).width + 14;
  ctx.fillStyle = '#14211f'; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-w / 2, -12, w, 24, 8); else ctx.rect(-w / 2, -12, w, 24);
  ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, 0, 1); ctx.restore();
}
function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!img) return;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalAlpha = +v('opacity'); ctx.drawImage(img, PAD, PAD, iw, ih); ctx.globalAlpha = 1;
  if (!data) return;
  const lw = +v('width'), cut = v('color'); ctx.lineJoin = ctx.lineCap = 'round';

  if (v('fill')) { path(data.outline); ctx.globalAlpha = .16; ctx.fillStyle = cut; ctx.fill(); ctx.globalAlpha = 1; }
  if (data.seam.length) { path(data.seam); ctx.setLineDash([lw * 3, lw * 2]); ctx.strokeStyle = v('seamColor'); ctx.lineWidth = lw; ctx.stroke(); }
  if (v('details')) { ctx.setLineDash([]); ctx.strokeStyle = v('detailColor'); ctx.lineWidth = Math.max(1.5, lw * .6); data.details.forEach(d => { path(d, false); ctx.stroke(); }); }
  path(data.outline); ctx.setLineDash(dash(lw)); ctx.strokeStyle = cut; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);

  const [bx, by, bw, bh] = data.bbox, x0 = PAD + bx * iw, y0 = PAD + by * ih, w = bw * iw, h = bh * ih, cx = x0 + w / 2;

  if (v('guides')) data.guides.forEach(g => {
    const gy = PAD + g.y * ih, gx0 = PAD + g.x0 * iw, gx1 = PAD + g.x1 * iw;
    ctx.setLineDash([8, 5]); ctx.strokeStyle = '#14211f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx1, gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#14211f'; [gx0, gx1].forEach(x => { ctx.beginPath(); ctx.arc(x, gy, 4, 0, 7); ctx.fill(); });
    label(`${g.width_cm} cm wide · ${g.down_cm} cm down`, (gx0 + gx1) / 2, gy);
  });
  if (v('grain')) { arrow(cx, y0 + h * .12, cx, y0 + h * .2, '#14211f'); arrow(cx, y0 + h * .86, cx, y0 + h * .94, '#14211f'); label('Grainline ↕', cx, y0 + h * .9); }
  if (v('notch')) {
    [[.5, 0], [.5, 1], [0, .5], [1, .5]].forEach(([fx, fy]) => {
      const tx = x0 + fx * w, ty = y0 + fy * h; let best = null, d = 1e9;
      data.outline.forEach(p => { const dd = (X(p) - tx) ** 2 + (Y(p) - ty) ** 2; if (dd < d) { d = dd; best = p; } });
      const px = X(best), py = Y(best), dx = px - cx, dy = py - (y0 + h / 2), n = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = cut; ctx.lineWidth = lw + 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + dx / n * 11, py + dy / n * 11); ctx.stroke();
    });
  }
  if (v('dims')) {
    const yb = y0 + h + 24, xl = x0 - 26;
    arrow(x0, yb, x0 + w, yb, '#14211f'); label(data.width_cm + ' cm', cx, yb + 18);
    arrow(xl, y0, xl, y0 + h, '#14211f'); label(data.length_cm + ' cm', xl - 18, y0 + h / 2, -Math.PI / 2);
  }
}

// ---------- instructions ----------
function steps() {
  const ol = $('instr'); ol.innerHTML = '';
  if (!data) return;
  const seam = +v('seam'), q = v('qty'), sw = c => `<i class="sw" style="background:${c}"></i>`;
  $('summary').textContent = `Piece size ${data.width_cm} × ${data.length_cm} cm (width × length).`;
  const list = [
    ['Prepare the fabric', `${TIPS[v('fabric')]} Lay it flat on the table, right side down.`],
    v('grain') ? ['Align the grain', 'Keep the grainline arrow parallel to the selvedge (the finished fabric edge).'] : null,
    q === 'fold' ? ['Fold the fabric', 'Fold right sides together and put the center edge of the piece on the fold. Cut one piece; it opens to a full piece.']
      : q === '2' ? ['Cut two mirrored pieces', 'Fold right sides together so you cut a left and a right at once, or flip the pattern for the second piece.']
      : ['Place the pattern', 'Position the piece with at least 2 cm of fabric around it.'],
    ['Trace the stitch line', `Mark the ${sw(v('color'))} ${v('style')} line (${v('width')} px on screen) with chalk or a tracing wheel. This is where you will sew.`],
    seam > 0 ? ['Mark the seam allowance', `Draw the ${sw(v('seamColor'))} line ${seam} cm outside the stitch line all the way round. Use a ruler or seam gauge.`] : null,
    v('details') && data.details.length ? ['Transfer inner details', `Copy the ${sw(v('detailColor'))} lines (collar, placket, pockets, panel seams) with chalk. They are sewing guides, not cut lines.`] : null,
    v('guides') ? ['Mark width guides', 'Draw the dashed cross-lines and check each width against the cm labels before cutting.'] : null,
    v('notch') ? ['Mark notches', 'Make small snips about 0.3 cm deep at the four marked points so you can match pieces when sewing.'] : null,
    v('dims') ? ['Check measurements', `Width should read ${data.width_cm} cm and length ${data.length_cm} cm at the stitch line${seam > 0 ? ' (add ' + (seam * 2).toFixed(1) + ' cm to each when measuring the cut edges)' : ''}.`] : null,
    ['Cut', seam > 0 ? 'Cut along the seam allowance line, not the stitch line. Use long, steady strokes and keep the fabric flat.' : 'Cut along the line using long, steady strokes and keep the fabric flat.'],
    ['Finish', 'Keep the pattern marks until the piece is pinned to its neighbour, then sew along the stitch line.']
  ].filter(Boolean);
  list.forEach(([t, d]) => {
    const li = document.createElement('li');
    li.innerHTML = `<input type="checkbox" aria-label="Done: ${t}"><div><b>${t}</b><span>${d}</span></div>`;
    li.querySelector('input').onchange = e => li.classList.toggle('done', e.target.checked);
    ol.appendChild(li);
  });
}

// ---------- events ----------
$('file').onchange = e => { load(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
['dragover', 'dragenter'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => load(e.dataTransfer.files[0]));
document.addEventListener('paste', e => { const f = [...e.clipboardData.files][0]; if (f) load(f); });

['ref', 'seam'].forEach(id => $(id).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(analyze, 350); }));
['color', 'seamColor', 'detailColor', 'fill', 'details', 'guides', 'width', 'style', 'opacity', 'grain', 'notch', 'dims'].forEach(id => $(id).addEventListener('input', () => { $('widthOut').textContent = v('width'); draw(); steps(); }));
['fabric', 'qty'].forEach(id => $(id).addEventListener('input', steps));

$('download').onclick = () => { const a = document.createElement('a'); a.download = 'tracecut-marked.png'; a.href = cv.toDataURL('image/png'); a.click(); };
$('reset').onclick = () => { img = file = data = null; $('file').value = ''; $('stage').classList.remove('has'); $('download').disabled = true; $('instr').innerHTML = ''; $('summary').textContent = 'Instructions appear here once an image is traced.'; toast(''); };