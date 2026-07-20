
/* =====================================================================
   RRT path-planning demonstration
   ---------------------------------------------------------------------
   A JavaScript reimplementation of the MATLAB Rapidly-exploring Random
   Tree planner shown alongside on the Robotics and Automation page.
   No dependencies, no build step. Uses a seeded RNG so any given seed
   reproduces the same tree.
   ===================================================================== */
(function () {
  'use strict';
 
  const canvas   = document.getElementById('rrt-canvas');
  if (!canvas) return;
  const ctx      = canvas.getContext('2d');
  const statusEl = document.getElementById('rrt-status');
  const runBtn   = document.getElementById('rrt-run');
  const resetBtn = document.getElementById('rrt-reset');
  const speedEl  = document.getElementById('rrt-speed');
  const seedEl   = document.getElementById('rrt-seed');
  const mapEl    = document.getElementById('rrt-map');
 
  // ---------- World configuration ----------
  const WORLD = { width: 24, height: 16 };
  const CELL_PX = 34;
  const ROBOT_RADIUS = 0.30;
  const MAX_STEP = 0.7;
  const GOAL_TOLERANCE = 0.6;
  const MAX_NODES = 6000;
 
  // ---------- Canvas sizing (HiDPI aware) ----------
  const CSS_W = WORLD.width  * CELL_PX;
  const CSS_H = WORLD.height * CELL_PX;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = CSS_W * dpr;
  canvas.height = CSS_H * dpr;
  canvas.style.maxWidth = CSS_W + 'px';
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.aspectRatio = WORLD.width + ' / ' + WORLD.height;
  ctx.scale(dpr, dpr);
 
  // ---------- Obstacle sets ----------
  const MAPS = {
    office: [
      { x: 0,  y: 5,  w: 8,  h: 0.4 },
      { x: 10, y: 5,  w: 14, h: 0.4 },
      { x: 0,  y: 10, w: 5,  h: 0.4 },
      { x: 7,  y: 10, w: 6,  h: 0.4 },
      { x: 15, y: 10, w: 9,  h: 0.4 },
      { x: 5,  y: 0,  w: 0.4, h: 3 },
      { x: 12, y: 5,  w: 0.4, h: 5 },
      { x: 18, y: 10, w: 0.4, h: 6 },
      { x: 6,  y: 12, w: 0.4, h: 4 }
    ],
    slalom: [
      { x: 4,  y: 0, w: 1, h: 11 },
      { x: 10, y: 5, w: 1, h: 11 },
      { x: 16, y: 0, w: 1, h: 11 },
      { x: 20, y: 5, w: 1, h: 11 }
    ],
    pillars: [
      { x: 6,  y: 3,  w: 2, h: 10 },
      { x: 12, y: 3,  w: 2, h: 10 },
      { x: 18, y: 3,  w: 2, h: 10 }
    ]
  };
 
  // ---------- Seeded RNG (Mulberry32) ----------
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
 
  // ---------- State ----------
  const state = {
    obstacles: MAPS.office,
    start: { x: 2,  y: 14 },
    goal:  { x: 22, y: 2  },
    tree: [],
    solution: null,
    running: false,
    animationId: null,
    rng: null,
    iterations: 0,
    clickAssigns: 'start'
  };
 
  // ---------- Collision tests ----------
  function pointInObstacle(px, py, pad) {
    if (px - pad < 0 || px + pad > WORLD.width)  return true;
    if (py - pad < 0 || py + pad > WORLD.height) return true;
    for (let i = 0; i < state.obstacles.length; i++) {
      const o = state.obstacles[i];
      if (px + pad > o.x && px - pad < o.x + o.w &&
          py + pad > o.y && py - pad < o.y + o.h) return true;
    }
    return false;
  }
 
  function segmentCollides(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(3, Math.ceil(len / (ROBOT_RADIUS * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (pointInObstacle(ax + dx * t, ay + dy * t, ROBOT_RADIUS)) return true;
    }
    return false;
  }
 
  // ---------- RRT core ----------
  function sample() {
    if (state.rng() < 0.06) return { x: state.goal.x, y: state.goal.y };
    return { x: state.rng() * WORLD.width, y: state.rng() * WORLD.height };
  }
 
  function nearestIndex(px, py) {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < state.tree.length; i++) {
      const n = state.tree[i];
      const d = (n.x - px) * (n.x - px) + (n.y - py) * (n.y - py);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }
 
  function steer(fromX, fromY, toX, toY) {
    const dx = toX - fromX, dy = toY - fromY;
    const len = Math.hypot(dx, dy);
    if (len <= MAX_STEP) return { x: toX, y: toY };
    return { x: fromX + (dx / len) * MAX_STEP, y: fromY + (dy / len) * MAX_STEP };
  }
 
  function extendOnce() {
    const s = sample();
    const nI = nearestIndex(s.x, s.y);
    const near = state.tree[nI];
    const cand = steer(near.x, near.y, s.x, s.y);
    if (pointInObstacle(cand.x, cand.y, ROBOT_RADIUS)) return false;
    if (segmentCollides(near.x, near.y, cand.x, cand.y)) return false;
    state.tree.push({ x: cand.x, y: cand.y, parent: nI });
 
    const dg = Math.hypot(cand.x - state.goal.x, cand.y - state.goal.y);
    if (dg < GOAL_TOLERANCE &&
        !segmentCollides(cand.x, cand.y, state.goal.x, state.goal.y)) {
      state.tree.push({
        x: state.goal.x, y: state.goal.y,
        parent: state.tree.length - 1
      });
      buildSolution();
      return true;
    }
    return false;
  }
 
  function buildSolution() {
    const path = [];
    let idx = state.tree.length - 1;
    while (idx !== null && idx !== undefined) {
      const n = state.tree[idx];
      path.push({ x: n.x, y: n.y });
      idx = n.parent;
    }
    path.reverse();
    state.solution = path;
  }
 
  // ---------- Rendering ----------
  function w2p(v) { return v * CELL_PX; }
 
  function drawGrid() {
    ctx.strokeStyle = 'rgba(34, 43, 48, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x++) {
      ctx.moveTo(w2p(x), 0);
      ctx.lineTo(w2p(x), CSS_H);
    }
    for (let y = 0; y <= WORLD.height; y++) {
      ctx.moveTo(0, w2p(y));
      ctx.lineTo(CSS_W, w2p(y));
    }
    ctx.stroke();
  }
 
  function drawObstacles() {
    ctx.fillStyle = 'rgba(34, 43, 48, 0.82)';
    for (let i = 0; i < state.obstacles.length; i++) {
      const o = state.obstacles[i];
      ctx.fillRect(w2p(o.x), w2p(o.y), w2p(o.w), w2p(o.h));
    }
  }
 
  function drawTree() {
    ctx.strokeStyle = 'rgba(47, 100, 112, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < state.tree.length; i++) {
      const n = state.tree[i];
      if (n.parent === null || n.parent === undefined) continue;
      const p = state.tree[n.parent];
      ctx.moveTo(w2p(p.x), w2p(p.y));
      ctx.lineTo(w2p(n.x), w2p(n.y));
    }
    ctx.stroke();
 
    ctx.fillStyle = '#2f6470';
    for (let i = 0; i < state.tree.length; i++) {
      const n = state.tree[i];
      ctx.beginPath();
      ctx.arc(w2p(n.x), w2p(n.y), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
 
  function drawSolution() {
    if (!state.solution) return;
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < state.solution.length; i++) {
      const p = state.solution[i];
      if (i === 0) ctx.moveTo(w2p(p.x), w2p(p.y));
      else ctx.lineTo(w2p(p.x), w2p(p.y));
    }
    ctx.stroke();
  }
 
  function drawMarker(pt, fill, label) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(w2p(pt.x), w2p(pt.y), 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w2p(pt.x), w2p(pt.y));
  }
 
  function draw() {
    ctx.fillStyle = '#f4f5f2';
    ctx.fillRect(0, 0, CSS_W, CSS_H);
    drawGrid();
    drawObstacles();
    drawTree();
    drawSolution();
    drawMarker(state.start, '#1f8b4c', 'S');
    drawMarker(state.goal,  '#c0392b', 'G');
  }
 
  // ---------- Status ----------
  function updateStatus() {
    let pathLen = null;
    if (state.solution) {
      pathLen = 0;
      for (let i = 1; i < state.solution.length; i++) {
        const a = state.solution[i - 1], b = state.solution[i];
        pathLen += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    const iters = String(state.iterations).padStart(4, ' ');
    const nodes = String(state.tree.length).padStart(4, ' ');
    let line = 'iterations ' + iters + '   nodes ' + nodes;
    if (state.solution) {
      line += '   path length ' + pathLen.toFixed(2) + '   status: solved';
    } else if (state.running) {
      line += '   status: searching';
    } else {
      line += '   status: idle';
    }
    statusEl.textContent = line;
  }
 
  // ---------- Animation loop ----------
  function loop() {
    if (!state.running) return;
    const stepsPerFrame = Math.max(1, parseInt(speedEl.value, 10) || 5);
    for (let i = 0; i < stepsPerFrame; i++) {
      state.iterations++;
      if (extendOnce()) {
        state.running = false;
        break;
      }
      if (state.tree.length > MAX_NODES) {
        state.running = false;
        break;
      }
    }
    draw();
    updateStatus();
    if (state.running) state.animationId = requestAnimationFrame(loop);
  }
 
  // ---------- Control handlers ----------
  function reset() {
    state.running = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    state.obstacles = MAPS[mapEl.value] || MAPS.office;
 
    // If the current start or goal now sits inside an obstacle, nudge to a safe default.
    if (pointInObstacle(state.start.x, state.start.y, ROBOT_RADIUS)) {
      state.start = { x: 2, y: 14 };
    }
    if (pointInObstacle(state.goal.x, state.goal.y, ROBOT_RADIUS)) {
      state.goal = { x: 22, y: 2 };
    }
 
    state.tree = [{ x: state.start.x, y: state.start.y, parent: null }];
    state.solution = null;
    state.iterations = 0;
    const seed = parseInt(seedEl.value, 10);
    state.rng = makeRng(Number.isFinite(seed) && seed > 0 ? seed : 1);
    draw();
    updateStatus();
  }
 
  function run() {
    if (state.solution) reset();
    if (!state.rng) state.rng = makeRng(parseInt(seedEl.value, 10) || 1);
    state.running = true;
    state.animationId = requestAnimationFrame(loop);
  }
 
  // ---------- Canvas interaction ----------
  canvas.addEventListener('click', function (e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width)  * WORLD.width;
    const y = ((e.clientY - rect.top)  / rect.height) * WORLD.height;
    if (pointInObstacle(x, y, ROBOT_RADIUS)) return;
    if (state.clickAssigns === 'start') {
      state.start = { x: x, y: y };
      state.clickAssigns = 'goal';
    } else {
      state.goal = { x: x, y: y };
      state.clickAssigns = 'start';
    }
    reset();
  });
 
  runBtn.addEventListener('click', run);
  resetBtn.addEventListener('click', reset);
  seedEl.addEventListener('change', reset);
  mapEl.addEventListener('change', reset);
 
  // ---------- Boot ----------
  reset();
})();
 
