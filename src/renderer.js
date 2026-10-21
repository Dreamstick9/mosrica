// renderer.js — draws the room, the brain and the activity chart, wires controls.
const { World } = window.MosquitoWorld;
const bridge = window.mosrica; // exposed by app/preload.js

const $ = (id) => document.getElementById(id);
const arena = $('arena'), actx = arena.getContext('2d');
const brainCv = $('brain'), bctx = brainCv.getContext('2d');
const rasterCv = $('raster'), rctx = rasterCv.getContext('2d');

const C = { red: '#ff0000', purple: '#7a00ff', text: '#1d1d1f', muted: '#6e6e73', line: '#e4e4e4', paper: '#ffffff' };
const GROUP = { s: C.red, i: C.purple, m: '#3a3a3c' };
const FONT = (px, weight = 400) => `${weight} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const RASTER_MS = 4000;
const DT = 0.5;

const STATUS = {
  casting: ['Flying around, searching for a scent', '#8e8e93'],
  tracking: ['Picked up CO₂ — following the trail', C.red],
  landing: ['Close to skin — getting ready to bite', C.red],
  feeding: ['Biting', C.red],
  avoiding: ['Smelled repellent — turning away', C.purple],
};

let A = { w: 800, h: 600 }, B = { w: 340, h: 220 }, R = { w: 340, h: 175 };
let running = true, speed = 1, tool = 'host', simDebt = 0, msgTimer = null;
let nodePos = [];

function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: r.width, h: r.height };
}

A = fit(arena);
const world = new World(A.w, A.h);

function resize() {
  A = fit(arena);
  B = fit(brainCv);
  R = fit(rasterCv);
  world.resize(A.w, A.h);
  layoutBrain();
}

function layoutBrain() {
  const cols = { s: 0.27, i: 0.5, m: 0.73 };
  const groups = { s: [], i: [], m: [] };
  for (const n of world.brain.neurons) groups[n.group].push(n);
  nodePos = [];
  for (const g of Object.keys(groups)) {
    const list = groups[g], top = 30, span = B.h - top - 4;
    list.forEach((n, k) => {
      nodePos[n.idx] = { x: Math.round(cols[g] * B.w), y: Math.round(top + (span * (k + 0.5)) / list.length) };
    });
  }
}

function text(c, str, x, y, color, align = 'center', px = 11, weight = 400) {
  c.fillStyle = color;
  c.font = FONT(px, weight);
  c.textAlign = align;
  c.fillText(str, x, y);
}

function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

// ---------- the room ----------
function drawPerson(c, h) {
  // faint rings: how far the CO₂ carries, and the warm zone
  c.strokeStyle = 'rgba(255,0,0,0.18)';
  c.lineWidth = 1;
  c.setLineDash([3, 5]);
  circle(c, h.x, h.y, 200); c.stroke();
  c.setLineDash([]);
  c.strokeStyle = 'rgba(255,0,0,0.35)';
  circle(c, h.x, h.y, 34); c.stroke();

  // top-down person: shoulders and head
  c.fillStyle = C.red;
  c.beginPath(); c.ellipse(h.x, h.y + 4, 15, 8, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = C.paper;
  c.lineWidth = 2;
  circle(c, h.x, h.y - 3, 7); c.fill(); c.stroke();

  text(c, h.bites ? `Person · ${h.bites} bite${h.bites > 1 ? 's' : ''}` : 'Person', h.x, h.y + 28, C.muted);
}

function drawRepellent(c, r) {
  c.fillStyle = 'rgba(122,0,255,0.08)';
  circle(c, r.x, r.y, 55); c.fill();
  c.strokeStyle = C.purple;
  c.lineWidth = 1.5;
  c.setLineDash([4, 4]);
  circle(c, r.x, r.y, 55); c.stroke();
  c.setLineDash([]);
  text(c, 'Repellent', r.x, r.y + 4, C.purple, 'center', 11, 500);
}

function drawMosquito(c, b, now) {
  c.save();
  c.translate(b.x, b.y);
  c.rotate(b.a);

  // wings
  const flap = b.state === 'feeding' ? 0.2 : 0.55 + Math.sin(now * 0.09) * 0.45;
  c.fillStyle = 'rgba(60,60,67,0.18)';
  c.strokeStyle = 'rgba(60,60,67,0.45)';
  c.lineWidth = 0.8;
  for (const side of [-1, 1]) {
    c.beginPath();
    c.ellipse(-5, side * 6 * flap, 8, 2.6, side * (0.35 + flap * 0.4), 0, Math.PI * 2);
    c.fill(); c.stroke();
  }

  // legs
  c.strokeStyle = '#3a3a3c';
  c.lineWidth = 0.8;
  for (const lx of [-1, 1, 3]) {
    for (const side of [-1, 1]) {
      c.beginPath(); c.moveTo(lx, 0); c.lineTo(lx - 4, side * 7); c.lineTo(lx - 7, side * 9); c.stroke();
    }
  }

  // abdomen (turns red after a meal), thorax, head, proboscis
  c.fillStyle = b.satiety > 0.05 ? C.red : '#3a3a3c';
  c.beginPath(); c.ellipse(-8, 0, 7, 2.2, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3a3a3c';
  c.beginPath(); c.ellipse(1, 0, 3.2, 2.6, 0, 0, Math.PI * 2); c.fill();
  circle(c, 5.5, 0, 1.8); c.fill();
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(7, 0); c.lineTo(13, 0); c.stroke();
  c.restore();
}

function drawArena(now) {
  const c = actx, b = world.bug;
  c.fillStyle = C.paper;
  c.fillRect(0, 0, A.w, A.h);

  for (const r of world.repellents) drawRepellent(c, r);
  for (const h of world.hosts) drawPerson(c, h);

  // where it has bitten
  c.fillStyle = C.red;
  for (const e of world.events) { circle(c, e.x, e.y, 2.5); c.fill(); }

  // flight path
  if (b.trail.length > 1) {
    c.strokeStyle = '#c7c7cc';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(b.trail[0].x, b.trail[0].y);
    for (const p of b.trail) c.lineTo(p.x, p.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }

  // antennae turn red when they pick up CO₂
  const ant = world.antennae(), s = world.s;
  c.lineWidth = 1;
  for (const [tip, v] of [[ant.L, s.co2L], [ant.R, s.co2R]]) {
    c.strokeStyle = v > 0.15 ? C.red : '#3a3a3c';
    c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(tip.x, tip.y); c.stroke();
  }

  drawMosquito(c, b, now);

  if (!world.hosts.length) text(c, 'Click anywhere to add a person', A.w / 2, A.h / 2, C.muted, 'center', 14);
}

// ---------- brain ----------
function drawBrain() {
  const c = bctx, br = world.brain, r = 7;
  c.fillStyle = C.paper;
  c.fillRect(0, 0, B.w, B.h);

  text(c, 'Senses', 0.27 * B.w, 16, C.muted, 'right', 11, 600);
  text(c, 'Processing', 0.5 * B.w, 16, C.muted, 'center', 11, 600);
  text(c, 'Movement', 0.73 * B.w, 16, C.muted, 'left', 11, 600);

  // quiet connections in light grey, busy ones in colour on top
  for (const pass of [false, true]) {
    for (const syn of br.synapses) {
      const active = !syn.pre.lesioned && !syn.post.lesioned && br.rate(syn.pre.id) > 25;
      if (active !== pass) continue;
      const p = nodePos[syn.pre.idx], q = nodePos[syn.post.idx];
      c.strokeStyle = active ? (syn.w > 0 ? 'rgba(255,0,0,0.6)' : 'rgba(122,0,255,0.6)') : C.line;
      c.lineWidth = active ? 1.5 : 1;
      c.beginPath();
      c.moveTo(p.x, p.y);
      if (p.x === q.x) c.bezierCurveTo(p.x - 26, p.y, q.x - 26, q.y, q.x, q.y);
      else c.lineTo(q.x, q.y);
      c.stroke();
    }
  }

  for (const n of br.neurons) {
    const p = nodePos[n.idx], col = GROUP[n.group];
    const flash = n.spikes.length && br.t - n.spikes[n.spikes.length - 1] < 20;
    c.fillStyle = C.paper;
    circle(c, p.x, p.y, r); c.fill();
    if (!n.lesioned) {
      c.globalAlpha = flash ? 1 : Math.min(1, br.rate(n.id) / 80);
      c.fillStyle = col;
      circle(c, p.x, p.y, r); c.fill();
      c.globalAlpha = 1;
    }
    c.strokeStyle = n.lesioned ? '#c7c7cc' : col;
    c.lineWidth = 1.5;
    circle(c, p.x, p.y, r); c.stroke();
    if (n.lesioned) {
      c.beginPath(); c.moveTo(p.x - 4, p.y - 4); c.lineTo(p.x + 4, p.y + 4); c.stroke();
    }
    const left = n.group === 's';
    text(c, n.label, p.x + (left ? -12 : 12), p.y + 4, n.lesioned ? '#aeaeb2' : C.text, left ? 'right' : 'left');
  }
}

// ---------- activity chart ----------
function drawRaster() {
  const c = rctx, br = world.brain, n = br.neurons.length;
  const left = 96, rowH = (R.h - 4) / n;
  c.fillStyle = C.paper;
  c.fillRect(0, 0, R.w, R.h);
  br.neurons.forEach((nr, k) => {
    const y = 2 + k * rowH;
    if (k > 0 && br.neurons[k - 1].group !== nr.group) {
      c.fillStyle = C.line;
      c.fillRect(6, y, R.w - 12, 1);
    }
    text(c, nr.label, 8, y + rowH * 0.78, nr.lesioned ? '#aeaeb2' : C.muted, 'left', 9.5);
    text(c, nr.lesioned ? 'off' : `${br.rate(nr.id).toFixed(0)} Hz`, left - 6, y + rowH * 0.78, '#aeaeb2', 'right', 9.5);
    c.fillStyle = GROUP[nr.group];
    for (const t of nr.spikes) {
      const x = R.w - 6 - ((br.t - t) / RASTER_MS) * (R.w - 6 - left);
      if (x >= left) c.fillRect(Math.round(x), y + 2, 1, rowH - 3);
    }
  });
}

// ---------- toolbar + status bar ----------
function setMeter(id, v) { $(id).style.width = `${Math.round(Math.min(1, v) * 100)}%`; }

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateHud() {
  const s = world.s, b = world.bug;
  $('st-bites').textContent = world.bites;
  $('st-first').textContent = world.firstBiteAt === null ? '–' : `${(world.firstBiteAt / 1000).toFixed(1)}s`;
  $('st-time').textContent = clock(world.t);

  let [msg, dot] = STATUS[b.state] || STATUS.casting;
  if (b.state === 'casting' && b.satiety > 0.05) msg = 'Full — not interested in anyone for now';
  if (!running) msg = 'Paused';
  $('status-text').textContent = msg;
  $('status-dot').style.background = running ? dot : '#c7c7cc';

  setMeter('m-co2L', s.co2L * 2);
  setMeter('m-co2R', s.co2R * 2);
  setMeter('m-heat', Math.max(s.heatL, s.heatR));
  setMeter('m-odor', s.odor);
  setMeter('m-deet', Math.max(s.deetL, s.deetR));
  setMeter('m-sat', b.satiety);
}

// Short-lived message on the right of the status bar.
function setStatus(msg) {
  $('status-msg').textContent = msg;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('status-msg').textContent = ''; }, 6000);
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const real = Math.min(50, now - last);
  last = now;
  if (running) {
    simDebt += real * speed;
    while (simDebt >= DT) { world.step(DT); simDebt -= DT; }
    world.brain.prune(RASTER_MS);
    if (world.events.length > 40) world.events.shift();
  }
  drawArena(now);
  drawBrain();
  drawRaster();
  updateHud();
  requestAnimationFrame(frame);
}

// ---------- actions (shared by buttons, keys and the app menu) ----------
function setTool(t) {
  tool = t;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
}

function setSpeed(v) {
  speed = v;
  $('speed').value = String(v);
}

function togglePlay() {
  running = !running;
  $('btn-play').textContent = running ? 'Pause' : 'Resume';
}

function reset() {
  world.reset(true);
}

function knockout(ids) {
  for (const n of world.brain.neurons) n.lesioned = ids.includes(n.id);
  reset();
  const names = ids.map((id) => world.brain.byId[id].label);
  setStatus(names.length ? `Switched off: ${names.join(', ')}` : 'All neurons back on');
}

function syncSliders() {
  const P = world.params;
  $('p-co2').value = P.co2Gain; $('o-co2').textContent = P.co2Gain.toFixed(1);
  $('p-turb').value = P.turbulence; $('o-turb').textContent = P.turbulence.toFixed(1);
  $('p-noise').value = P.noise; $('o-noise').textContent = P.noise.toFixed(2);
}

function buildReport() {
  const br = world.brain;
  return {
    app: 'Mosrica',
    generatedAt: new Date().toISOString(),
    simTimeSec: +(world.t / 1000).toFixed(2),
    bites: world.bites,
    firstBiteSec: world.firstBiteAt === null ? null : +(world.firstBiteAt / 1000).toFixed(2),
    hosts: world.hosts.length,
    repellents: world.repellents.length,
    params: { ...world.params },
    knockedOut: br.neurons.filter((n) => n.lesioned).map((n) => n.id),
    neurons: br.neurons.map((n) => ({ id: n.id, label: n.label, rateHz: +br.rate(n.id).toFixed(1) })),
  };
}

function buildScenario() {
  const norm = (p) => ({ x: +(p.x / A.w).toFixed(4), y: +(p.y / A.h).toFixed(4) });
  return {
    app: 'Mosrica',
    version: 1,
    hosts: world.hosts.map(norm),
    repellents: world.repellents.map(norm),
    params: { ...world.params },
    knockedOut: world.brain.neurons.filter((n) => n.lesioned).map((n) => n.id),
  };
}

function applyScenario(sc) {
  const place = (p) => ({ x: p.x * A.w, y: p.y * A.h, bites: 0 });
  world.hosts = (sc.hosts || []).map(place);
  world.repellents = (sc.repellents || []).map(place);
  Object.assign(world.params, sc.params || {});
  syncSliders();
  knockout(sc.knockedOut || []);
}

function needsApp() {
  if (bridge) return false;
  setStatus('Only available in the desktop app');
  return true;
}

const actions = {
  'toggle-play': togglePlay,
  reset,
  clear: () => { world.hosts = []; world.repellents = []; world.events = []; },
  'speed-1': () => setSpeed(1),
  'speed-2': () => setSpeed(2),
  'speed-4': () => setSpeed(4),
  'ko-co2': () => knockout(['CO2_L', 'CO2_R']),
  'ko-arousal': () => knockout(['ARM']),
  'ko-heat': () => knockout(['HEAT_L', 'HEAT_R']),
  restore: () => knockout([]),
  snapshot: async () => {
    if (needsApp()) return;
    const file = await bridge.saveSnapshot();
    setStatus(file ? `Snapshot saved to ${file}` : 'Couldn’t save the snapshot — keep the window visible');
  },
  'export-report': async () => {
    if (needsApp()) return;
    const file = await bridge.exportReport(buildReport());
    if (file) setStatus(`Report saved to ${file}`);
  },
  'save-scenario': async () => {
    if (needsApp()) return;
    const file = await bridge.saveScenario(buildScenario());
    if (file) setStatus(`Saved to ${file}`);
  },
  'open-scenario': async () => {
    if (needsApp()) return;
    const sc = await bridge.openScenario();
    if (!sc) return;
    applyScenario(sc);
    setStatus('Scenario opened');
  },
};

if (bridge) bridge.registerListenerForMenuActionFromMain((action) => actions[action]?.());

document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action]()));
document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', resize));
$('speed').addEventListener('change', (e) => setSpeed(Number(e.target.value)));

arena.addEventListener('mousedown', (e) => {
  const r = arena.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (tool === 'host') world.hosts.push({ x, y, bites: 0 });
  else if (tool === 'deet') world.repellents.push({ x, y });
  else {
    const near = (p) => Math.hypot(p.x - x, p.y - y) < 40;
    world.hosts = world.hosts.filter((p) => !near(p));
    world.repellents = world.repellents.filter((p) => !near(p));
  }
});

brainCv.addEventListener('mousedown', (e) => {
  const r = brainCv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  for (const n of world.brain.neurons) {
    const p = nodePos[n.idx];
    if (Math.hypot(p.x - x, p.y - y) < 11) {
      n.lesioned = !n.lesioned;
      setStatus(`${n.label} switched ${n.lesioned ? 'off' : 'back on'}`);
    }
  }
});

for (const [input, out, key, digits] of [['p-co2', 'o-co2', 'co2Gain', 1], ['p-turb', 'o-turb', 'turbulence', 1], ['p-noise', 'o-noise', 'noise', 2]]) {
  $(input).addEventListener('input', (e) => {
    world.params[key] = Number(e.target.value);
    $(out).textContent = Number(e.target.value).toFixed(digits);
  });
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'r' || e.key === 'R') reset();
  else if (e.key === '1') setTool('host');
  else if (e.key === '2') setTool('deet');
  else if (e.key === '3') setTool('erase');
});

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
