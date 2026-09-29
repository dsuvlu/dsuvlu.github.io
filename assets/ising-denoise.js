// Bayesian image denoising with an Ising prior (Geman & Geman 1984).
//
// A binary picture x (±1 per pixel) is observed through a binary symmetric
// channel: each pixel is flipped independently with probability p. With an
// Ising prior p(x) ∝ exp(J Σ⟨ij⟩ x_i x_j), Bayes' rule gives
//
//   p(x | y) ∝ exp( J Σ⟨ij⟩ x_i x_j + Σ_i h_i x_i ),  h_i = ½ ln((1-p)/p) · y_i
//
// which is a biased Ising model at β = 1 whose field is the data. Heat-bath
// sweeps are Gibbs sampling from this posterior; averaging the samples gives
// the posterior mean, and its sign is the maximiser of the posterior
// marginals.
//
// Markup: <figure data-ising-denoise hidden> containing canvases with
// data-panel="truth|data|sample|mean", controls with data-control=
// "target|noise|coupling|resample", and outputs with data-out=
// "data-error|mean-error|sweeps|noise|coupling".

import {
  Lattice, View, themeColors, onThemeChange, animate, prefersReducedMotion,
  loadImage, imageDarkness, sketch,
} from "./ising-core.js";

const SWEEPS_PER_FRAME = 3;
const BURN_IN = 8;          // sweeps discarded after any change

const TARGETS = {
  gibbs: { src: "portraits/gibbs.jpg", cells: [128, 160], sketch: true },
  boltzmann: { src: "portraits/boltzmann.jpg", cells: [128, 160], sketch: true },
  helix: { src: "video/helix-coil-remd-poster.jpg", cells: [168, 64], crop: [360, 318, 480, 183] },
};

// Resolve asset paths against this module, so the widget works from any page.
const asset = (path) => new URL(`./${path}`, import.meta.url).href;

async function truthFor(key) {
  const t = TARGETS[key];
  const [W, H] = t.cells;
  let img = await loadImage(asset(t.src));
  if (t.crop) {
    const [sx, sy, sw, sh] = t.crop;
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    img = c;
  }
  const dark = imageDarkness(img, W, H);
  if (t.sketch) return { W, H, x: sketch(dark, W, H) };
  const x = new Int8Array(W * H);
  for (let i = 0; i < x.length; i++) x[i] = dark[i] > 0.5 ? 1 : -1;
  return { W, H, x };
}

async function setup(fig) {
  const panel = (name) => fig.querySelector(`[data-panel="${name}"]`);
  const control = (name) => fig.querySelector(`[data-control="${name}"]`);
  const out = (name, text) => {
    const el = fig.querySelector(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };

  let colors;
  const readColors = () => {
    colors = themeColors(fig, ["--ising-up", "--ink"], ["--ising-down", "--paper-deep"]);
  };
  readColors();

  let truth, lattice, observed, mean, sweeps, views;
  const noise = () => Number(control("noise").value);
  const coupling = () => Number(control("coupling").value);

  const pct = (k, n) => `${((100 * k) / n).toFixed(1)}%`;

  const drawAll = () => {
    views.truth.spins(truth.x, colors);
    views.data.spins(observed, colors);
    views.sample.spins(lattice.spin, colors);
    if (sweeps > 0) views.mean.values(mean, colors);
    else views.mean.spins(observed, colors);
  };

  const report = () => {
    const n = truth.x.length;
    let dataWrong = 0, meanWrong = 0;
    for (let i = 0; i < n; i++) {
      if (observed[i] !== truth.x[i]) dataWrong++;
      const est = sweeps > 0 ? (mean[i] >= 0 ? 1 : -1) : observed[i];
      if (est !== truth.x[i]) meanWrong++;
    }
    out("data-error", pct(dataWrong, n));
    out("mean-error", pct(meanWrong, n));
    out("sweeps", String(sweeps));
    out("noise", noise().toFixed(2));
    out("coupling", coupling().toFixed(2));
  };

  // Posterior changed: reset the running average (the chain itself carries on).
  let burn = 0;
  const resetAverage = () => {
    mean.fill(0);
    sweeps = 0;
    burn = BURN_IN;
  };

  const setField = () => {
    const p = noise();
    const h = 0.5 * Math.log((1 - p) / p);
    for (let i = 0; i < observed.length; i++) lattice.field[i] = h * observed[i];
    lattice.J = coupling();
    resetAverage();
  };

  const observe = () => {
    const p = noise();
    for (let i = 0; i < observed.length; i++) observed[i] = Math.random() < p ? -truth.x[i] : truth.x[i];
    lattice.spin.set(observed); // start the chain at the data
    setField();
  };

  const loadTarget = async (key) => {
    truth = await truthFor(key);
    const { W, H } = truth;
    lattice = new Lattice(W, H);
    lattice.setTemperature(1); // posterior sampling is at β = 1
    observed = new Int8Array(W * H);
    mean = new Float32Array(W * H);
    views = {};
    for (const name of ["truth", "data", "sample", "mean"]) views[name] = new View(panel(name), W, H);
    fig.style.setProperty("--ising-lab-aspect", `${W} / ${H}`);
    fig.dataset.shape = W > H ? "wide" : "tall";
    observe();
  };

  const step = (n) => {
    for (let k = 0; k < n; k++) {
      lattice.sweep();
      if (burn > 0) { burn--; continue; }
      const s = lattice.spin;
      sweeps++;
      const w = 1 / sweeps; // running mean
      for (let i = 0; i < s.length; i++) mean[i] += (s[i] - mean[i]) * w;
    }
  };

  await loadTarget(control("target").value);
  fig.hidden = false;

  const reduced = prefersReducedMotion();
  // Without animation, each change runs a fixed number of sweeps at once.
  const settle = () => { if (reduced) { step(BURN_IN + 120); drawAll(); report(); } };

  control("target").addEventListener("change", async (e) => { await loadTarget(e.target.value); settle(); drawAll(); report(); });
  control("noise").addEventListener("input", () => { observe(); settle(); report(); });
  control("coupling").addEventListener("input", () => { setField(); settle(); report(); });
  control("resample").addEventListener("click", () => { observe(); settle(); report(); });
  onThemeChange(() => { readColors(); drawAll(); });

  if (reduced) { settle(); return; }

  let frames = 0;
  animate(fig, () => {
    step(SWEEPS_PER_FRAME);
    drawAll();
    if ((frames++ & 7) === 0) report();
  });
  drawAll();
  report();
}

document.querySelectorAll("[data-ising-denoise]").forEach(setup);
