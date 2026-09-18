import { zeta, cabs, KNOWN_ZERO_T } from './zeta.js';

// ---------------------------------------------------------------------
// Fixed coordinate domains. These never change with content or window
// size (window resize only changes pixels-per-unit, never the range),
// which is what keeps the axes "fixed" per the brief. The input range
// covers the critical strip through t=41, comfortably past the sixth
// zero (t≈37.59); the output range comfortably contains |ζ(1/2+it)|
// for that whole sweep (its max there is ≈2.94).
// ---------------------------------------------------------------------
const INPUT_DOMAIN = { reMin: -1.5, reMax: 2.5, imMin: -3, imMax: 43 };
const OUTPUT_DOMAIN = { reMin: -3.5, reMax: 3.5, imMin: -3.5, imMax: 3.5 };
const ANIM_T_MAX = 41;
const ANIM_DT = 0.02;

// A point whose |re| or |im| exceeds this is treated as "at infinity" —
// happens near the pole s=1 — and breaks the drawn path instead of being
// plotted or smoothed toward.
const TRACE_BOUND = 1e5;

// Adaptive smoothing for the output trace: recursively bisects the input
// segment between two consecutively-sampled points whenever the output
// curve between them isn't flat — either the endpoints are more than this
// many pixels apart, or (the case a plain endpoint-distance check misses)
// the midpoint's image bows away from the straight chord between the
// endpoints by more than half that — so curvature hiding between two
// coincidentally-close endpoints still gets refined.
const SMOOTH_MAX_PX_GAP = 3;
const SMOOTH_MAX_DEPTH = 12;

const inputCanvas = document.getElementById('canvas-input');
const outputCanvas = document.getElementById('canvas-output');
const btnClear = document.getElementById('btn-clear');
const btnPlay = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const speedSlider = document.getElementById('speed');
const speedValue = document.getElementById('speed-value');
const tReadout = document.getElementById('t-readout');
const zeroTrack = document.getElementById('zero-track');
const zeroCount = document.getElementById('zero-count');

function getColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    ink: v('--ink'),
    inkSecondary: v('--ink-secondary'),
    inkMuted: v('--ink-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    stripFill: v('--strip-fill'),
    criticalLine: v('--critical-line'),
    good: v('--good'),
    critical: v('--critical'),
    // slot 7 (violet) is skipped here — reserved for the critical line.
    series: [v('--series-1'), v('--series-2'), v('--series-3'), v('--series-4'),
      v('--series-5'), v('--series-6'), v('--series-8')],
  };
}

// ---- canvas sizing (device-pixel-ratio aware, CSS-pixel drawing space) ----

function fitCanvas(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: w, height: h };
}

function makeTransform(domain, width, height) {
  const sx = width / (domain.reMax - domain.reMin);
  const sy = height / (domain.imMax - domain.imMin);
  return {
    toPx(re, im) {
      return { x: (re - domain.reMin) * sx, y: height - (im - domain.imMin) * sy };
    },
    toDomain(x, y) {
      return { re: domain.reMin + x / sx, im: domain.imMin + (height - y) / sy };
    },
  };
}

// ---- state ----

let inputInfo = fitCanvas(inputCanvas);
let outputInfo = fitCanvas(outputCanvas);
let inputT = makeTransform(INPUT_DOMAIN, inputInfo.width, inputInfo.height);
let outputT = makeTransform(OUTPUT_DOMAIN, outputInfo.width, outputInfo.height);

const strokes = []; // { color, points:[{re,im}], trace:[{re,im}|null] }
let currentStroke = null;
let colorIdx = 0;
let dirty = true;

const anim = {
  playing: false,
  t: 0,
  crossed: new Array(KNOWN_ZERO_T.length).fill(false),
  pulses: [], // { t0, w }
  path: null, // precomputed [{t, w}]
};

// Precompute the full critical-line image once — it never changes.
function precomputeCriticalLine() {
  const path = [];
  const steps = Math.round(ANIM_T_MAX / ANIM_DT);
  for (let i = 0; i <= steps; i++) {
    const t = i * ANIM_DT;
    const w = zeta({ re: 0.5, im: t });
    path.push({ t, w });
  }
  return path;
}
anim.path = precomputeCriticalLine();

function buildZeroTrack() {
  zeroTrack.innerHTML = '';
  KNOWN_ZERO_T.forEach((t) => {
    const dot = document.createElement('span');
    dot.className = 'zero-dot';
    dot.title = `t ≈ ${t.toFixed(2)}`;
    zeroTrack.appendChild(dot);
  });
}
buildZeroTrack();

function updateZeroUI() {
  const dots = zeroTrack.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle('crossed', anim.crossed[i]);
  }
  const n = anim.crossed.filter(Boolean).length;
  zeroCount.textContent = `${n} / ${KNOWN_ZERO_T.length} zeros found`;
  tReadout.textContent = `t = ${anim.t.toFixed(2)}`;
}

// ---- drawing helpers ----

function drawGridAndAxes(ctx, width, height, domain, transform, colors, { labelStep, labelAxis }) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = colors.inkMuted;

  const reStart = Math.ceil(domain.reMin);
  const reEnd = Math.floor(domain.reMax);
  for (let re = reStart; re <= reEnd; re++) {
    const { x } = transform.toPx(re, 0);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }

  const imStep = labelStep;
  const imStart = Math.ceil(domain.imMin / imStep) * imStep;
  for (let im = imStart; im <= domain.imMax; im += imStep) {
    const { y } = transform.toPx(0, im);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  // axis lines (Re=0 and Im=0), heavier weight
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5;
  if (domain.reMin < 0 && domain.reMax > 0) {
    const { x } = transform.toPx(0, 0);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  if (domain.imMin < 0 && domain.imMax > 0) {
    const { y } = transform.toPx(0, 0);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // tick labels
  ctx.fillStyle = colors.inkMuted;
  for (let re = reStart; re <= reEnd; re++) {
    if (re === 0) continue;
    const { x } = transform.toPx(re, domain.imMin);
    ctx.fillText(String(re), x + 3, height - 6);
  }
  for (let im = imStart; im <= domain.imMax; im += imStep) {
    if (im === 0) continue;
    const { y } = transform.toPx(domain.reMin, im);
    ctx.fillText(String(im), 3, y - 3);
  }
}

function drawInputBackground(ctx, width, height, colors) {
  drawGridAndAxes(ctx, width, height, INPUT_DOMAIN, inputT, colors, { labelStep: 5 });

  // critical strip 0 <= Re(s) <= 1
  const p0 = inputT.toPx(0, 0);
  const p1 = inputT.toPx(1, 0);
  ctx.fillStyle = colors.stripFill;
  ctx.fillRect(Math.min(p0.x, p1.x), 0, Math.abs(p1.x - p0.x), height);

  // critical line Re(s) = 1/2
  const { x } = inputT.toPx(0.5, 0);
  ctx.save();
  ctx.strokeStyle = colors.criticalLine;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();

  // pole marker at s = 1
  if (1 >= INPUT_DOMAIN.reMin && 1 <= INPUT_DOMAIN.reMax && 0 >= INPUT_DOMAIN.imMin) {
    const pole = inputT.toPx(1, 0);
    ctx.save();
    ctx.strokeStyle = colors.critical;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pole.x, pole.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = colors.critical;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('pole s=1', pole.x + 7, pole.y + 3);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = colors.criticalLine;
  ctx.globalAlpha = 0.8;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('σ = 1/2', x + 4, 12);
  ctx.restore();
}

function drawOutputBackground(ctx, width, height, colors) {
  drawGridAndAxes(ctx, width, height, OUTPUT_DOMAIN, outputT, colors, { labelStep: 1 });

  // reference circle |w| = 1
  const center = outputT.toPx(0, 0);
  const edge = outputT.toPx(1, 0);
  const r = Math.abs(edge.x - center.x);
  ctx.save();
  ctx.strokeStyle = colors.inkMuted;
  ctx.globalAlpha = 0.35;
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // origin marker
  ctx.save();
  ctx.fillStyle = colors.inkMuted;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function isUsablePoint(p) {
  return !!p && isFinite(p.re) && isFinite(p.im) && Math.abs(p.re) <= TRACE_BOUND && Math.abs(p.im) <= TRACE_BOUND;
}

// Draw a polyline of domain points onto ctx using `transform`, skipping
// (breaking the path) at any non-finite or absurdly large point — this
// happens near the pole s=1 where |ζ| → ∞.
function strokePolyline(ctx, points, transform, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    if (!isUsablePoint(p)) {
      started = false;
      continue;
    }
    const { x, y } = transform.toPx(p.re, p.im);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function render() {
  const colors = getColors();
  const { ctx: ictx, width: iw, height: ih } = inputInfo;
  const { ctx: octx, width: ow, height: oh } = outputInfo;

  drawInputBackground(ictx, iw, ih, colors);
  drawOutputBackground(octx, ow, oh, colors);

  // user strokes + their zeta traces
  for (const s of strokes) {
    strokePolyline(ictx, s.points, inputT, s.color, 2.25);
    strokePolyline(octx, s.trace, outputT, s.color, 2.25);
  }

  // critical-line animation
  if (anim.t > 0) {
    const idx = Math.min(anim.path.length - 1, Math.round(anim.t / ANIM_DT));

    // input side: straight vertical segment along σ=1/2
    ictx.save();
    ictx.strokeStyle = colors.criticalLine;
    ictx.lineWidth = 2.5;
    ictx.lineCap = 'round';
    const a = inputT.toPx(0.5, 0);
    const b = inputT.toPx(0.5, anim.t);
    ictx.beginPath();
    ictx.moveTo(a.x, a.y);
    ictx.lineTo(b.x, b.y);
    ictx.stroke();
    ictx.restore();

    // markers for zeros already crossed, on the input critical line
    KNOWN_ZERO_T.forEach((zt, i) => {
      if (anim.crossed[i]) {
        const p = inputT.toPx(0.5, zt);
        ictx.save();
        ictx.fillStyle = colors.good;
        ictx.beginPath();
        ictx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ictx.fill();
        ictx.restore();
      }
    });

    // moving dot on the input plane
    drawDot(ictx, b, colors.criticalLine);

    // output side: the ζ(1/2+it) trace revealed so far
    const revealed = anim.path.slice(0, idx + 1).map((p) => p.w);
    strokePolyline(octx, revealed, outputT, colors.criticalLine, 2.25);
    const lastW = anim.path[idx].w;
    const animDotPx = outputT.toPx(lastW.re, lastW.im);
    drawDot(octx, animDotPx, colors.criticalLine);

    // pulses at zero crossings
    const now = performance.now();
    anim.pulses = anim.pulses.filter((p) => now - p.start < 700);
    for (const p of anim.pulses) {
      const age = (now - p.start) / 700;
      const px = outputT.toPx(0, 0);
      octx.save();
      octx.strokeStyle = colors.good;
      octx.globalAlpha = 1 - age;
      octx.lineWidth = 2;
      octx.beginPath();
      octx.arc(px.x, px.y, 4 + age * 22, 0, Math.PI * 2);
      octx.stroke();
      octx.restore();
    }
    if (anim.pulses.length) dirty = true;
  }
}

function drawDot(ctx, px, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// ---- drawing interaction ----

const strokeColors = () => getColors().series;

function nextColor() {
  const palette = strokeColors();
  const c = palette[colorIdx % palette.length];
  colorIdx++;
  return c;
}

function clampToCanvas(x, y, width, height) {
  return { x: Math.min(Math.max(x, 0), width), y: Math.min(Math.max(y, 0), height) };
}

function samplePoint(clientX, clientY) {
  const rect = inputCanvas.getBoundingClientRect();
  const raw = clampToCanvas(clientX - rect.left, clientY - rect.top, inputInfo.width, inputInfo.height);
  const domainPt = inputT.toDomain(raw.x, raw.y);
  return domainPt;
}

// Perpendicular distance from point p to the segment a-b, in the same
// (pixel) units as p/a/b.
function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}

// Recursively bisects the input segment (pPrev -> pNew) whenever its output
// image (wPrev -> wNew) isn't visually flat, pushing the resulting finer
// chain of points/traces onto `stroke`. Assumes pPrev (and wPrev) is
// already the last entry in stroke.points/trace; pushes everything from
// just after pPrev through pNew, inclusive.
function subdivideAndPush(stroke, pPrev, wPrev, pNew, wNew, depth) {
  if (depth < SMOOTH_MAX_DEPTH && isUsablePoint(wPrev) && isUsablePoint(wNew)) {
    const mid = { re: (pPrev.re + pNew.re) / 2, im: (pPrev.im + pNew.im) / 2 };
    const wMid = zeta(mid);
    const a = outputT.toPx(wPrev.re, wPrev.im);
    const b = outputT.toPx(wNew.re, wNew.im);
    const needsSplit = !isUsablePoint(wMid)
      || Math.hypot(b.x - a.x, b.y - a.y) > SMOOTH_MAX_PX_GAP
      || pointToSegmentDistance(outputT.toPx(wMid.re, wMid.im), a, b) > SMOOTH_MAX_PX_GAP / 2;
    if (needsSplit) {
      subdivideAndPush(stroke, pPrev, wPrev, mid, wMid, depth + 1);
      subdivideAndPush(stroke, mid, wMid, pNew, wNew, depth + 1);
      return;
    }
  }
  stroke.points.push(pNew);
  stroke.trace.push(wNew);
}

let drawing = false;
let lastPx = null;

function onPointerDown(e) {
  inputCanvas.setPointerCapture(e.pointerId);
  drawing = true;
  const p = samplePoint(e.clientX, e.clientY);
  currentStroke = { color: nextColor(), points: [p], trace: [zeta(p)] };
  strokes.push(currentStroke);
  lastPx = { x: e.clientX, y: e.clientY };
  dirty = true;
}

function onPointerMove(e) {
  if (!drawing || !currentStroke) return;
  if (lastPx) {
    const d = Math.hypot(e.clientX - lastPx.x, e.clientY - lastPx.y);
    if (d < 2) return; // throttle dense samples
  }
  lastPx = { x: e.clientX, y: e.clientY };
  const p = samplePoint(e.clientX, e.clientY);
  const prevIdx = currentStroke.points.length - 1;
  const pPrev = currentStroke.points[prevIdx];
  const wPrev = currentStroke.trace[prevIdx];
  const wNew = zeta(p);
  subdivideAndPush(currentStroke, pPrev, wPrev, p, wNew, 0);
  dirty = true;
}

function endStroke() {
  drawing = false;
  currentStroke = null;
  lastPx = null;
}

inputCanvas.addEventListener('pointerdown', onPointerDown);
inputCanvas.addEventListener('pointermove', onPointerMove);
inputCanvas.addEventListener('pointerup', endStroke);
inputCanvas.addEventListener('pointercancel', endStroke);

btnClear.addEventListener('click', () => {
  strokes.length = 0;
  colorIdx = 0;
  resetAnim();
  setPlaying(false);
  dirty = true;
});

// ---- animation controls ----

function setPlaying(playing) {
  anim.playing = playing;
  btnPlay.textContent = playing ? 'Pause' : (anim.t >= ANIM_T_MAX ? 'Replay' : 'Play');
}

btnPlay.addEventListener('click', () => {
  if (anim.playing) {
    setPlaying(false);
    return;
  }
  if (anim.t >= ANIM_T_MAX) {
    resetAnim();
  }
  setPlaying(true);
});

btnReset.addEventListener('click', () => {
  resetAnim();
  setPlaying(false);
  dirty = true;
});

function resetAnim() {
  anim.t = 0;
  anim.crossed.fill(false);
  anim.pulses = [];
  updateZeroUI();
}

speedSlider.addEventListener('input', () => {
  speedValue.textContent = speedSlider.value;
});

// ---- main loop ----

let lastTs = null;
function frame(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (anim.playing) {
    const speed = parseFloat(speedSlider.value);
    const prevT = anim.t;
    anim.t = Math.min(ANIM_T_MAX, anim.t + speed * dt);

    KNOWN_ZERO_T.forEach((zt, i) => {
      if (!anim.crossed[i] && prevT < zt && anim.t >= zt) {
        anim.crossed[i] = true;
        anim.pulses.push({ start: performance.now() });
      }
    });

    updateZeroUI();
    dirty = true;

    if (anim.t >= ANIM_T_MAX) {
      setPlaying(false);
    }
  }

  if (dirty) {
    render();
    dirty = false;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- resize handling ----

function handleResize() {
  inputInfo = fitCanvas(inputCanvas);
  outputInfo = fitCanvas(outputCanvas);
  inputT = makeTransform(INPUT_DOMAIN, inputInfo.width, inputInfo.height);
  outputT = makeTransform(OUTPUT_DOMAIN, outputInfo.width, outputInfo.height);
  dirty = true;
}

window.addEventListener('resize', handleResize);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { dirty = true; });
}

updateZeroUI();
dirty = true;
