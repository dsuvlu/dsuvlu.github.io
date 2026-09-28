// Biased 2D Ising model whose external field spells a word.
//
// Markup: <figure data-ising data-text="404" hidden> with a <canvas> inside,
// plus optional [data-ising-readout] and [data-ising-reheat] elements. The
// figure starts hidden so there is no empty box without JavaScript.
//
// Physics: H = -J Σ⟨ij⟩ s_i s_j - Σ_i h_i s_i on a periodic square lattice,
// with h_i = +h where the glyphs are drawn and -h elsewhere. Heat-bath
// updates on a checkerboard; the lattice anneals from hot to below
// T_c = 2 / ln(1 + √2) ≈ 2.269 J/k_B, and the pointer is a local heat source.

(() => {
  const J = 1;
  const TC = 2 / Math.log(1 + Math.SQRT2);

  const W = 192;              // lattice width (cells)
  const H = 64;               // lattice height (cells)
  // |h| in units of J. Two competing limits: a stroke survives only if it is
  // wider than ~2J/h cells, and an enclosed counter (the hole in a 4) is
  // swallowed by domain-wall tension unless its area/perimeter exceeds ~J/h.
  const FIELD = 0.5;
  const T_HOT = 8;            // starting temperature
  const T_COLD = 1.6;         // where the anneal settles (below T_c)
  const TAU = 1.6;            // anneal time constant (s)
  const SWEEPS_PER_FRAME = 2;
  const HEAT = 5;             // extra temperature at the pointer
  const HEAT_RADIUS = 7;      // Gaussian width of the hot spot (cells)

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Rasterise the text into a ±1 mask at lattice resolution.
  function fieldFromText(text) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const family = '700 SIZEpx Mulish, "Avenir Next", Helvetica, Arial, sans-serif';
    let size = H * 0.95;
    ctx.font = family.replace("SIZE", size);
    const fit = (W * 0.8) / ctx.measureText(text).width;
    if (fit < 1) size *= fit;
    ctx.font = family.replace("SIZE", size);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(text);
    const y = H / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillStyle = "#fff";
    ctx.fillText(text, W / 2, y);
    const px = ctx.getImageData(0, 0, W, H).data;
    const h = new Float32Array(W * H);
    for (let i = 0; i < h.length; i++) h[i] = px[4 * i + 3] > 127 ? FIELD : -FIELD;
    return h;
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
    const reheat = fig.querySelector("[data-ising-reheat]");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(W, H);
    const pixels = new Uint32Array(image.data.buffer);

    // The glyphs must be drawn in the webfont, not a fallback.
    try { await document.fonts.load(`700 ${H}px Mulish`); } catch (_) { /* fallback font is fine */ }

    const field = fieldFromText(fig.dataset.text || "404");
    const spin = new Int8Array(W * H);
    const beta = new Float32Array(W * H);

    let up = 0, down = 0;
    const readColors = () => {
      const style = getComputedStyle(fig);
      up = packColor(style.getPropertyValue("--ink").trim() || "#10233f");
      down = packColor(style.getPropertyValue("--paper-deep").trim() || "#eee9de");
    };
    readColors();
    // Quarto's theme toggle flips a class on <body>.
    new MutationObserver(() => { readColors(); draw(); })
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });

    let T = T_HOT;
    let pointer = null;       // lattice coordinates of the hot spot
    let t0 = null;           // set on the first animated frame

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
          const up_ = (y === 0 ? H - 1 : y - 1) * W;
          const dn_ = (y === H - 1 ? 0 : y + 1) * W;
          for (let x = (y + parity) & 1; x < W; x += 2) {
            const i = row + x;
            const l = row + (x === 0 ? W - 1 : x - 1);
            const r = row + (x === W - 1 ? 0 : x + 1);
            const local = J * (spin[l] + spin[r] + spin[up_ + x] + spin[dn_ + x]) + field[i];
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
    };

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

    let visible = false, raf = 0, frames = 0;
    const frame = (now) => {
      if (t0 === null) t0 = now;
      T = T_COLD + (T_HOT - T_COLD) * Math.exp(-(now - t0) / 1000 / TAU);
      updateBeta();
      for (let k = 0; k < SWEEPS_PER_FRAME; k++) sweep();
      draw();
      if ((frames++ & 7) === 0) show();
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      const should = visible && !document.hidden;
      if (should && !raf) raf = requestAnimationFrame(frame);
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

    const melt = () => { randomize(); t0 = null; };
    canvas.addEventListener("click", melt);
    if (reheat) reheat.addEventListener("click", melt);

    randomize();
    draw();
  }

  const start = () => document.querySelectorAll("[data-ising]").forEach(setup);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
