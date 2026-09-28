// Biased 2D Ising model whose external field spells words.
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
// Physics: H = -J Σ⟨ij⟩ s_i s_j - Σ_i h_i s_i on a periodic square lattice,
// with h_i = +h where the glyphs are drawn and -h elsewhere. Heat-bath
// updates on a checkerboard; the lattice anneals from hot to below
// T_c = 2 / ln(1 + √2) ≈ 2.269 J/k_B, and the pointer is a local heat source.
// Choosing h: a stroke survives only if it is wider than ~2J/h cells, and an
// enclosed counter (the hole in a 4 or an O) is swallowed by domain-wall
// tension unless its area/perimeter exceeds ~J/h.

(() => {
  const J = 1;
  const TC = 2 / Math.log(1 + Math.SQRT2);

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
  const FONT = '"Mulish", "Avenir Next", Helvetica, Arial, sans-serif';

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Rasterise words into ±h fields at lattice resolution, all at one size so
  // the band doesn't jump in scale between words.
  function fieldsFromWords(words, W, H, h, weight) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const font = (px) => `${weight} ${px}px ${FONT}`;

    // Size to the tallest glyphs and widest word, with a margin.
    let size = H;
    ctx.font = font(size);
    let ascent = 0, descent = 0, width = 0;
    for (const w of words) {
      const m = ctx.measureText(w);
      ascent = Math.max(ascent, m.actualBoundingBoxAscent);
      descent = Math.max(descent, m.actualBoundingBoxDescent);
      width = Math.max(width, m.width);
    }
    size *= Math.min((H * 0.74) / (ascent + descent), (W * 0.84) / width);
    ctx.font = font(size);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const scale = size / H;
    const baseline = H / 2 + ((ascent - descent) * scale) / 2;

    return words.map((w) => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.fillText(w, W / 2, baseline);
      const px = ctx.getImageData(0, 0, W, H).data;
      const f = new Float32Array(W * H);
      for (let i = 0; i < f.length; i++) f[i] = px[4 * i + 3] > 127 ? h : -h;
      return f;
    });
  }

  // Any CSS colour -> packed little-endian RGBA for a Uint32Array ImageData view.
  function packColor(css) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

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

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(W, H);
    const pixels = new Uint32Array(image.data.buffer);

    // The glyphs must be drawn in the webfont, not a fallback.
    try { await document.fonts.load(`${weight} ${H}px Mulish`); } catch (_) { /* fallback is fine */ }

    const fields = fieldsFromWords(words, W, H, h, weight);
    let wordIndex = 0;
    let field = fields[0];
    const spin = new Int8Array(W * H);
    const beta = new Float32Array(W * H);

    let up = 0, down = 0;
    const readColors = () => {
      const style = getComputedStyle(fig);
      const token = (a, b, fallback) =>
        style.getPropertyValue(a).trim() || style.getPropertyValue(b).trim() || fallback;
      up = packColor(token("--ising-up", "--ink", "#10233f"));
      down = packColor(token("--ising-down", "--paper-deep", "#eee9de"));
    };

    // Simulation clock: advances only while animating, so schedules pause
    // with the animation instead of jumping ahead after it was off-screen.
    let simTime = 0;
    let T = T_HOT;
    let eventTime = 0, eventT = T_HOT, eventTau = TAU;
    let pointer = null;       // lattice coordinates of the hot spot

    const randomize = () => {
      for (let i = 0; i < spin.length; i++) spin[i] = Math.random() < 0.5 ? 1 : -1;
    };

    const updateBeta = () => {
      const b = 1 / T;
      if (!pointer) { beta.fill(b); return; }
      const inv2s2 = 1 / (2 * HEAT_RADIUS * HEAT_RADIUS);
      for (let y = 0; y < H; y++) {
        const dy = y - pointer.y;
        for (let x = 0; x < W; x++) {
          const dx = x - pointer.x;
          beta[y * W + x] = 1 / (T + HEAT * Math.exp(-(dx * dx + dy * dy) * inv2s2));
        }
      }
    };

    // One heat-bath sweep: P(s_i = +1) = 1 / (1 + exp(-2β(J·Σ s_j + h_i))).
    const sweep = () => {
      for (let parity = 0; parity < 2; parity++) {
        for (let y = 0; y < H; y++) {
          const row = y * W;
          const above = (y === 0 ? H - 1 : y - 1) * W;
          const below = (y === H - 1 ? 0 : y + 1) * W;
          for (let x = (y + parity) & 1; x < W; x += 2) {
            const i = row + x;
            const l = row + (x === 0 ? W - 1 : x - 1);
            const r = row + (x === W - 1 ? 0 : x + 1);
            const local = J * (spin[l] + spin[r] + spin[above + x] + spin[below + x]) + field[i];
            spin[i] = Math.random() * (1 + Math.exp(-2 * beta[i] * local)) < 1 ? 1 : -1;
          }
        }
      }
    };

    const draw = () => {
      for (let i = 0; i < spin.length; i++) pixels[i] = spin[i] > 0 ? up : down;
      ctx.putImageData(image, 0, 0);
    };

    const show = () => {
      if (readout) {
        readout.textContent = `T = ${T.toFixed(2)}`;
        readout.dataset.phase = T > TC ? "disordered" : "ordered";
      }
      if (wordOut) wordOut.textContent = words[wordIndex];
    };

    readColors();
    // Quarto's theme toggle flips a class on <body>.
    new MutationObserver(() => { readColors(); draw(); })
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });

    fig.hidden = false;

    if (reducedMotion) {
      // Static equilibrium frame: start from the field's own pattern and relax.
      for (let i = 0; i < spin.length; i++) spin[i] = field[i] > 0 ? 1 : -1;
      T = T_COLD;
      updateBeta();
      for (let k = 0; k < 200; k++) sweep();
      draw();
      show();
      if (reheat) reheat.hidden = true;
      return;
    }

    const kick = (peak, tau) => { eventTime = simTime; eventT = Math.max(T, peak); eventTau = tau; };
    const melt = () => { randomize(); kick(T_HOT, TAU); };

    let visible = false, raf = 0, last = null, frames = 0;
    const frame = (now) => {
      // cap the step so a stalled tab doesn't fast-forward the schedule
      if (last !== null) simTime += Math.min(now - last, 50) / 1000;
      last = now;

      if (fields.length > 1 && simTime - eventTime > hold) {
        wordIndex = (wordIndex + 1) % fields.length;
        field = fields[wordIndex];
        kick(T_PULSE, TAU_PULSE);
      }
      T = T_COLD + (eventT - T_COLD) * Math.exp(-(simTime - eventTime) / eventTau);

      updateBeta();
      for (let k = 0; k < SWEEPS_PER_FRAME; k++) sweep();
      draw();
      if ((frames++ & 7) === 0) show();
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      const should = visible && !document.hidden;
      if (should && !raf) { last = null; raf = requestAnimationFrame(frame); }
      if (!should && raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(canvas);
    document.addEventListener("visibilitychange", run);

    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: ((e.clientX - rect.left) / rect.width) * W,
        y: ((e.clientY - rect.top) / rect.height) * H,
      };
    });
    canvas.addEventListener("pointerleave", () => { pointer = null; });

    canvas.addEventListener("click", melt);
    if (reheat) reheat.addEventListener("click", melt);

    randomize();
    draw();
    show();
  }

  const start = () => document.querySelectorAll("[data-ising]").forEach(setup);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
