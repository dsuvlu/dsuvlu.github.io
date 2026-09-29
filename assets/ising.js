// Biased 2D Ising model whose external field spells words (homepage band,
// 404 page). Engine in ising-core.js; load this as <script type="module">.
//
// Markup: <figure data-ising hidden> with a <canvas> inside. The figure
// starts hidden so there is no empty box without JavaScript. Options, all
// optional, as data attributes on the figure:
//   data-text="404"                 one word, or
//   data-words="ONE|TWO|THREE"      words the field steps through in turn
//   data-cells="192x64"             lattice size (width x height)
//   data-field="0.5"                |h| in units of J
//   data-hold="6"                   seconds each word is held
//   data-weight="800"               Mulish weight for the glyphs
// Optional children: [data-ising-readout] shows the temperature,
// [data-ising-word] the current word, [data-ising-reheat] restarts the anneal.
// Colours come from --ising-up / --ising-down on the figure, falling back to
// the site's --ink / --paper-deep tokens.
//
// h_i = +h where the glyphs are drawn and -h elsewhere; the lattice anneals
// from hot to below T_c, and the pointer is a local heat source.
// Choosing h: a stroke survives only if it is wider than ~2J/h cells, and an
// enclosed counter (the hole in a 4 or an O) is swallowed by domain-wall
// tension unless its area/perimeter exceeds ~J/h.

import {
  TC, Lattice, View, textMasks, themeColors, onThemeChange,
  trackPointer, animate, prefersReducedMotion,
} from "./ising-core.js";

const T_HOT = 8;            // starting temperature
const T_COLD = 1.6;         // where the anneal settles (below T_c)
const TAU = 1.6;            // anneal time constant (s)
// A word change reverses the field under the old and new glyphs. At T_COLD
// the old word is metastable, so a short pulse toward T_c lets it melt
// while the new word nucleates.
const T_PULSE = 2.4;
const TAU_PULSE = 0.9;
const SWEEPS_PER_FRAME = 2;
const HEAT = 5;             // extra temperature at the pointer
const HEAT_RADIUS = 7;      // Gaussian width of the hot spot (cells)

async function setup(fig) {
  const canvas = fig.querySelector("canvas");
  const readout = fig.querySelector("[data-ising-readout]");
  const wordOut = fig.querySelector("[data-ising-word]");
  const reheat = fig.querySelector("[data-ising-reheat]");

  const [W, H] = (fig.dataset.cells || "192x64").split("x").map(Number);
  const words = (fig.dataset.words || fig.dataset.text || "404").split("|");
  const hold = Number(fig.dataset.hold || 6);
  const h = Number(fig.dataset.field || 0.5);
  const weight = Number(fig.dataset.weight || 800);

  const lattice = new Lattice(W, H);
  const view = new View(canvas, W, H);
  const masks = await textMasks(words, W, H, weight);
  let wordIndex = 0;
  const useWord = (k) => {
    wordIndex = k;
    const m = masks[k];
    for (let i = 0; i < m.length; i++) lattice.field[i] = m[i] * h;
  };
  useWord(0);

  let colors = themeColors(fig, ["--ising-up", "--ink"], ["--ising-down", "--paper-deep"]);
  const draw = () => view.spins(lattice.spin, colors);
  onThemeChange(() => {
    colors = themeColors(fig, ["--ising-up", "--ink"], ["--ising-down", "--paper-deep"]);
    draw();
  });

  let T = T_HOT;
  const show = () => {
    if (readout) {
      readout.textContent = `T = ${T.toFixed(2)}`;
      readout.dataset.phase = T > TC ? "disordered" : "ordered";
    }
    if (wordOut) wordOut.textContent = words[wordIndex];
  };

  fig.hidden = false;

  if (prefersReducedMotion()) {
    // Static equilibrium frame: start from the field's own pattern and relax.
    for (let i = 0; i < lattice.n; i++) lattice.spin[i] = lattice.field[i] > 0 ? 1 : -1;
    T = T_COLD;
    lattice.setTemperature(T);
    for (let k = 0; k < 200; k++) lattice.sweep();
    draw();
    show();
    if (reheat) reheat.hidden = true;
    return;
  }

  // Simulation clock: advances only while animating, so schedules pause
  // with the animation instead of jumping ahead after it was off-screen.
  let simTime = 0;
  let eventTime = 0, eventT = T_HOT, eventTau = TAU;
  const kick = (peak, tau) => { eventTime = simTime; eventT = Math.max(T, peak); eventTau = tau; };
  const melt = () => { lattice.randomize(); kick(T_HOT, TAU); };

  const pointer = trackPointer(canvas, W, H);
  canvas.addEventListener("click", melt);
  if (reheat) reheat.addEventListener("click", melt);

  let frames = 0;
  animate(canvas, (dt) => {
    simTime += dt;
    if (masks.length > 1 && simTime - eventTime > hold) {
      useWord((wordIndex + 1) % masks.length);
      kick(T_PULSE, TAU_PULSE);
    }
    T = T_COLD + (eventT - T_COLD) * Math.exp(-(simTime - eventTime) / eventTau);
    lattice.setTemperature(T, pointer.pos && { ...pointer.pos, heat: HEAT, radius: HEAT_RADIUS });
    for (let k = 0; k < SWEEPS_PER_FRAME; k++) lattice.sweep();
    draw();
    if ((frames++ & 7) === 0) show();
  });

  lattice.randomize();
  draw();
  show();
}

document.querySelectorAll("[data-ising]").forEach(setup);
