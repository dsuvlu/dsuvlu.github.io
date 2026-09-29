// A portrait as the ground state of an Ising lattice.
//
// The field on each site follows the photograph's darkness d_i ∈ [0, 1]:
// h_i = h0 (2 d_i − 1). At T → 0 (with J small next to h0) the ground state
// is the thresholded photo; at finite T with weak coupling the spins are
// nearly independent and ⟨s_i⟩ ≈ tanh(h_i / T), so the density of dark spins
// follows the tone (a stochastic halftone). Strong coupling below T_c
// collapses tone into flat domains.
//
// Markup: <figure data-ising-portrait hidden> containing
//   .ising-portrait-arch with canvas[data-panel="main"] and img[data-photo]
//   controls with data-control="who|display|temperature|coupling|field|ending|replay"
//   outputs with data-out="temperature|coupling|field|status"
//   optional canvas[data-preset="J,T,h0"] panels that run continuously.

import {
  Lattice, View, loadImage, imageDarkness, themeColors, onThemeChange,
  animate, prefersReducedMotion,
} from "./ising-core.js";

const W = 128, H = 160;
const T_HOT = 6, TAU = 1.8;
const REVEAL_AT = 7;        // seconds into the intro before the photo fades in
const EMA = 0.08;           // weight of the newest frame in the averaged display

const photoSrc = (who) => new URL(`./portraits/${who}.jpg`, import.meta.url).href;
const cache = new Map();
async function darkness(who) {
  if (!cache.has(who)) cache.set(who, imageDarkness(await loadImage(photoSrc(who)), W, H));
  return cache.get(who);
}

function setField(lattice, dark, h0) {
  for (let i = 0; i < lattice.n; i++) lattice.field[i] = h0 * (2 * dark[i] - 1);
}

const colorsFor = (el) => themeColors(el, ["--ising-up", "--ink"], ["--ising-down", "--paper-deep"]);

async function preset(canvas, dark, reduced) {
  const [J, T, h0] = canvas.dataset.preset.split(",").map(Number);
  const lattice = new Lattice(W, H);
  lattice.J = J;
  lattice.setTemperature(T);
  setField(lattice, dark, h0);
  lattice.randomize();
  const view = new View(canvas, W, H);
  let colors = colorsFor(canvas);
  onThemeChange(() => { colors = colorsFor(canvas); view.spins(lattice.spin, colors); });
  // Settle before the first paint: the animation only starts once the panel
  // scrolls into view, and it should never show up blank.
  for (let k = 0; k < (reduced ? 150 : 40); k++) lattice.sweep();
  view.spins(lattice.spin, colors);
  if (reduced) return;
  animate(canvas, () => { lattice.sweep(); view.spins(lattice.spin, colors); });
}

async function setup(fig) {
  const $ = (sel) => fig.querySelector(sel);
  const control = (name) => $(`[data-control="${name}"]`);
  const out = (name, text) => { const el = $(`[data-out="${name}"]`); if (el) el.textContent = text; };
  const reduced = prefersReducedMotion();

  const arch = $(".ising-portrait-arch");
  const photo = $("[data-photo]");
  const lattice = new Lattice(W, H);
  const view = new View($('[data-panel="main"]'), W, H);
  const avg = new Float32Array(W * H);
  let colors = colorsFor(arch);

  const settings = () => ({
    who: control("who").value,
    T: Number(control("temperature").value),
    J: Number(control("coupling").value),
    h0: Number(control("field").value),
    display: control("display").value,
    ending: control("ending").value,
  });

  let dark = await darkness(settings().who);
  let simTime = 0;

  const showSettings = () => {
    const s = settings();
    out("temperature", s.T.toFixed(2));
    out("coupling", s.J.toFixed(2));
    out("field", s.h0.toFixed(2));
  };

  const draw = () => {
    if (settings().display === "average") view.values(avg, colors);
    else view.spins(lattice.spin, colors);
  };

  const applyParams = () => {
    const s = settings();
    lattice.J = s.J;
    setField(lattice, dark, s.h0);
  };

  // Without animation: jump straight to the settled state at the final T.
  const settleStatic = () => {
    applyParams();
    lattice.setTemperature(settings().T);
    for (let i = 0; i < lattice.n; i++) lattice.spin[i] = lattice.field[i] > 0 ? 1 : -1;
    avg.fill(0);
    for (let k = 0; k < 150; k++) {
      lattice.sweep();
      for (let i = 0; i < lattice.n; i++) avg[i] += (lattice.spin[i] - avg[i]) * EMA;
    }
    draw();
    out("status", `T = ${settings().T.toFixed(2)}`);
  };

  const replay = () => {
    applyParams();
    lattice.randomize();
    avg.fill(0);
    simTime = 0;
    arch.classList.remove("is-revealed");
    if (reduced) settleStatic();
  };

  control("who").addEventListener("change", async () => {
    dark = await darkness(settings().who);
    photo.src = photoSrc(settings().who);
    replay();
  });
  for (const name of ["temperature", "coupling", "field"]) {
    control(name).addEventListener("input", () => { showSettings(); applyParams(); if (reduced) settleStatic(); });
  }
  control("display").addEventListener("change", draw);
  control("ending").addEventListener("change", replay);
  control("replay").addEventListener("click", replay);
  onThemeChange(() => { colors = colorsFor(arch); draw(); });

  photo.src = photoSrc(settings().who);
  showSettings();
  fig.hidden = false;

  const presetDark = await darkness("boltzmann");
  fig.querySelectorAll("[data-preset]").forEach((c) => preset(c, presetDark, reduced));

  replay();
  if (reduced) return;

  animate(arch, (dt) => {
    simTime += dt;
    const s = settings();
    const T = s.T + (T_HOT - s.T) * Math.exp(-simTime / TAU);
    lattice.setTemperature(T);
    lattice.sweep();
    for (let i = 0; i < lattice.n; i++) avg[i] += (lattice.spin[i] - avg[i]) * EMA;
    draw();
    if (s.ending === "reveal" && simTime > REVEAL_AT) arch.classList.add("is-revealed");
    out("status", `t = ${simTime.toFixed(1)} s · T = ${T.toFixed(2)}`);
  });
}

document.querySelectorAll("[data-ising-portrait]").forEach(setup);
