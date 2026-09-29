// Nucleation and hysteresis in the 2D Ising model.
//
// Below T_c, a lattice magnetized against the field is metastable: flipping
// a droplet of radius R gains bulk energy 2h per spin but pays surface
// tension σ(T) along its edge. In the continuum (classical nucleation
// theory) ΔF(R) = 2πRσ − 2πhR², so droplets larger than R* = σ / 2h grow
// and smaller ones shrink, with barrier ΔF* = πσ² / 2h. σ(T) is Onsager's
// exact interface tension along a lattice axis, σ = 2J + T ln tanh(J/T);
// the estimate ignores lattice anisotropy and is only a guide.
//
// Markup: <figure data-ising-nucleation hidden> containing
// canvas[data-panel="lattice"], canvas[data-panel="overlay"],
// canvas[data-panel="chart"], a [data-tooltip] element, controls with
// data-control="temperature|field|radius|sweep|play|reset", and outputs with
// data-out="temperature|field|radius|m|rstar".

import {
  Lattice, View, themeColors, onThemeChange, animate, prefersReducedMotion,
} from "./ising-core.js";

const W = 160, H = 100;
const SWEEPS_PER_FRAME = 3;
const H_MAX = 0.8;          // field slider and chart range
const SWEEP_PERIOD = 40;    // seconds of simulation per field cycle
const TRACE = 2400;         // points kept in the m(h) trace

const surfaceTension = (T) => 2 + T * Math.log(Math.tanh(1 / T)); // J = 1

function setup(fig) {
  const $ = (sel) => fig.querySelector(sel);
  const control = (name) => $(`[data-control="${name}"]`);
  const out = (name, text) => { const el = $(`[data-out="${name}"]`); if (el) el.textContent = text; };

  const latticeCanvas = $('[data-panel="lattice"]');
  const overlay = $('[data-panel="overlay"]');
  const chart = $('[data-panel="chart"]');
  const tooltip = $("[data-tooltip]");

  const lattice = new Lattice(W, H);
  const view = new View(latticeCanvas, W, H);
  lattice.fill(-1);

  let colors, chartStyle;
  const readColors = () => {
    colors = themeColors(fig, ["--ising-up", "--ink"], ["--ising-down", "--paper-deep"]);
    const s = getComputedStyle(fig);
    const v = (name) => s.getPropertyValue(name).trim();
    chartStyle = {
      series: v("--chart-series"), grid: v("--chart-grid"), text: v("--ink-soft"),
      surface: v("--paper"), font: `12px ${s.fontFamily}`,
    };
  };
  readColors();

  let T = Number(control("temperature").value);
  let h = Number(control("field").value);
  let radius = Number(control("radius").value);
  let sweeping = false, playing = !prefersReducedMotion();
  let simTime = 0, sweepStart = 0;
  const trace = []; // [h, m]

  const report = () => {
    out("temperature", T.toFixed(2));
    out("field", (h >= 0 ? "+" : "−") + Math.abs(h).toFixed(2));
    out("radius", String(radius));
    out("m", lattice.magnetization().toFixed(2));
    const sigma = surfaceTension(T);
    out("rstar", Math.abs(h) < 0.005 ? "∞" : (sigma / (2 * Math.abs(h))).toFixed(1));
  };

  // ------------------------------------------------------------ chart
  const chartCtx = chart.getContext("2d");
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  let box = null;
  const layoutChart = () => {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = chart.getBoundingClientRect();
    chart.width = Math.round(width * dpr);
    chart.height = Math.round(height * dpr);
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    box = { width, height, x0: pad.l, x1: width - pad.r, y0: pad.t, y1: height - pad.b };
  };
  const X = (hv) => box.x0 + ((hv + H_MAX) / (2 * H_MAX)) * (box.x1 - box.x0);
  const Y = (m) => box.y1 - ((m + 1) / 2) * (box.y1 - box.y0);

  const drawChart = () => {
    if (!box) return;
    const c = chartCtx;
    c.clearRect(0, 0, box.width, box.height);
    // recessive hairline grid: the zero lines and the frame's ticks
    c.strokeStyle = chartStyle.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (const hv of [-H_MAX, 0, H_MAX]) { c.moveTo(Math.round(X(hv)) + 0.5, box.y0); c.lineTo(Math.round(X(hv)) + 0.5, box.y1); }
    for (const m of [-1, 0, 1]) { c.moveTo(box.x0, Math.round(Y(m)) + 0.5); c.lineTo(box.x1, Math.round(Y(m)) + 0.5); }
    c.stroke();
    // tick labels and axis titles in text tokens
    c.fillStyle = chartStyle.text;
    c.font = chartStyle.font;
    c.textAlign = "center";
    c.textBaseline = "top";
    for (const hv of [-H_MAX, 0, H_MAX]) c.fillText(hv === 0 ? "0" : hv.toFixed(1).replace("-", "−"), X(hv), box.y1 + 5);
    c.fillText("field h (J)", (box.x0 + box.x1) / 2, box.y1 + 19);
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (const m of [-1, 0, 1]) c.fillText(m === -1 ? "−1" : String(m), box.x0 - 6, Y(m));
    c.save();
    c.translate(12, (box.y0 + box.y1) / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = "center";
    c.fillText("magnetization m", 0, 0);
    c.restore();
    if (!trace.length) return;
    // the trace: one series, 2px, round joins
    c.strokeStyle = chartStyle.series;
    c.lineWidth = 2;
    c.lineJoin = c.lineCap = "round";
    c.beginPath();
    trace.forEach(([hv, m], k) => (k ? c.lineTo(X(hv), Y(m)) : c.moveTo(X(hv), Y(m))));
    c.stroke();
    // current state: 9px dot with a 2px surface ring
    const [hv, m] = trace[trace.length - 1];
    c.beginPath();
    c.arc(X(hv), Y(m), 6.5, 0, 2 * Math.PI);
    c.fillStyle = chartStyle.surface;
    c.fill();
    c.beginPath();
    c.arc(X(hv), Y(m), 4.5, 0, 2 * Math.PI);
    c.fillStyle = chartStyle.series;
    c.fill();
  };

  // hover: nearest point on the trace (a loop is not a function of h, so
  // snap to the closest point rather than to an x position)
  chart.addEventListener("pointermove", (e) => {
    if (!box || !trace.length) return;
    const r = chart.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, bestD = Infinity;
    for (const pt of trace) {
      const d = (X(pt[0]) - px) ** 2 + (Y(pt[1]) - py) ** 2;
      if (d < bestD) { bestD = d; best = pt; }
    }
    if (!best || bestD > 40 * 40) { tooltip.hidden = true; return; }
    tooltip.hidden = false;
    tooltip.querySelector("[data-tip-m]").textContent = best[1].toFixed(2);
    tooltip.querySelector("[data-tip-h]").textContent = best[0].toFixed(2).replace("-", "−");
    tooltip.style.left = `${X(best[0])}px`;
    tooltip.style.top = `${Y(best[1])}px`;
  });
  chart.addEventListener("pointerleave", () => { tooltip.hidden = true; });

  // ------------------------------------------------------------ lattice
  const overlayCtx = overlay.getContext("2d");
  let hover = null;
  const drawOverlay = () => {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = overlay.getBoundingClientRect();
    if (overlay.width !== Math.round(width * dpr)) { overlay.width = Math.round(width * dpr); overlay.height = Math.round(height * dpr); }
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayCtx.clearRect(0, 0, width, height);
    if (!hover) return;
    const cell = width / W;
    overlayCtx.strokeStyle = chartStyle.series;
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.arc(hover.x * cell, hover.y * cell, radius * cell, 0, 2 * Math.PI);
    overlayCtx.stroke();
  };
  const cellAt = (e) => {
    const r = latticeCanvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  latticeCanvas.addEventListener("pointermove", (e) => { hover = cellAt(e); drawOverlay(); });
  latticeCanvas.addEventListener("pointerleave", () => { hover = null; drawOverlay(); });
  // Plant a droplet magnetized along the field (periodic boundaries).
  latticeCanvas.addEventListener("click", (e) => {
    const { x: cx, y: cy } = cellAt(e);
    const s = h >= 0 ? 1 : -1;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = (Math.floor(cx) + dx + W) % W, y = (Math.floor(cy) + dy + H) % H;
        lattice.spin[y * W + x] = s;
      }
    view.spins(lattice.spin, colors);
    report();
  });

  // ------------------------------------------------------------ controls
  const setField = (v) => { h = v; lattice.field.fill(h); };
  setField(h);
  lattice.setTemperature(T);

  const setSweeping = (on) => {
    sweeping = on;
    control("sweep").setAttribute("aria-pressed", String(on));
    control("sweep").textContent = on ? "Stop sweep" : "Sweep field";
    // start the triangle wave at the current field so there's no jump
    if (on) sweepStart = simTime - ((h + H_MAX) / (2 * H_MAX)) * (SWEEP_PERIOD / 2);
  };
  const setPlaying = (on) => {
    playing = on;
    control("play").setAttribute("aria-pressed", String(on));
    control("play").textContent = on ? "Pause" : "Play";
  };

  control("temperature").addEventListener("input", (e) => {
    T = Number(e.target.value);
    lattice.setTemperature(T);
    trace.length = 0; // a new temperature is a new loop
    report();
    drawChart();
  });
  control("field").addEventListener("input", (e) => { setSweeping(false); setField(Number(e.target.value)); report(); });
  control("radius").addEventListener("input", (e) => { radius = Number(e.target.value); report(); drawOverlay(); });
  control("sweep").addEventListener("click", () => setSweeping(!sweeping));
  control("play").addEventListener("click", () => setPlaying(!playing));
  control("reset").addEventListener("click", () => {
    lattice.fill(h >= 0 ? -1 : 1); // magnetized against the field: metastable
    trace.length = 0;
    view.spins(lattice.spin, colors);
    report();
    drawChart();
  });

  onThemeChange(() => { readColors(); view.spins(lattice.spin, colors); drawChart(); drawOverlay(); });
  new ResizeObserver(() => { layoutChart(); drawChart(); drawOverlay(); }).observe(chart);

  fig.hidden = false;
  layoutChart();
  setPlaying(playing);

  let frames = 0;
  animate(fig, (dt) => {
    if (!playing) return;
    simTime += dt;
    if (sweeping) {
      // triangle wave between −H_MAX and +H_MAX
      const phase = (((simTime - sweepStart) / SWEEP_PERIOD) % 1 + 1) % 1;
      const v = phase < 0.5 ? -H_MAX + 4 * H_MAX * phase : 3 * H_MAX - 4 * H_MAX * phase;
      setField(v);
      control("field").value = v.toFixed(2);
    }
    for (let k = 0; k < SWEEPS_PER_FRAME; k++) lattice.sweep();
    trace.push([h, lattice.magnetization()]);
    if (trace.length > TRACE) trace.shift();
    view.spins(lattice.spin, colors);
    drawChart();
    if ((frames++ & 3) === 0) report();
  });

  view.spins(lattice.spin, colors);
  report();
  drawChart();
}

document.querySelectorAll("[data-ising-nucleation]").forEach(setup);
