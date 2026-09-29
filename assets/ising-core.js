// Shared engine for the site's Ising-model widgets: the lattice and its
// heat-bath dynamics, field builders (text, images), rendering in the site's
// colour tokens, and an animation loop that only runs while visible.
//
// Model: H = -J Σ⟨ij⟩ s_i s_j - Σ_i h_i s_i on a periodic square lattice.
// Temperature enters as a per-site β so a pointer can act as a local heat
// source; sampling at β = 1 with h = data log-likelihood is Gibbs sampling
// from a Bayesian posterior (see ising-denoise.js).

export const TC = 2 / Math.log(1 + Math.SQRT2); // Onsager: 2.269 J/k_B

export const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Lattice {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.n = W * H;
    this.J = 1;
    this.spin = new Int8Array(this.n);
    this.field = new Float32Array(this.n);
    this.beta = new Float32Array(this.n).fill(1);
  }

  randomize() {
    const s = this.spin;
    for (let i = 0; i < s.length; i++) s[i] = Math.random() < 0.5 ? 1 : -1;
  }

  fill(value) {
    this.spin.fill(value);
  }

  // Uniform temperature, plus an optional Gaussian hot spot
  // { x, y, heat, radius } in lattice units.
  setTemperature(T, spot = null) {
    const { W, H, beta } = this;
    if (!spot) { beta.fill(1 / T); return; }
    const inv2s2 = 1 / (2 * spot.radius * spot.radius);
    for (let y = 0; y < H; y++) {
      const dy = y - spot.y;
      for (let x = 0; x < W; x++) {
        const dx = x - spot.x;
        beta[y * W + x] = 1 / (T + spot.heat * Math.exp(-(dx * dx + dy * dy) * inv2s2));
      }
    }
  }

  // One heat-bath sweep on a checkerboard:
  // P(s_i = +1) = 1 / (1 + exp(-2β(J·Σ s_j + h_i))).
  sweep() {
    const { W, H, J, spin, field, beta } = this;
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
  }

  magnetization() {
    let m = 0;
    for (let i = 0; i < this.n; i++) m += this.spin[i];
    return m / this.n;
  }
}

// ---------------------------------------------------------------- fields

const FONT = '"Mulish", "Avenir Next", Helvetica, Arial, sans-serif';

// ±1 masks for words at lattice resolution, all at one size so a sequence of
// words doesn't jump in scale.
export async function textMasks(words, W, H, weight = 800) {
  try { await document.fonts.load(`${weight} ${H}px Mulish`); } catch (_) { /* fallback is fine */ }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const font = (px) => `${weight} ${px}px ${FONT}`;

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
    const mask = new Int8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = px[4 * i + 3] > 127 ? 1 : -1;
    return mask;
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Darkness in [0, 1] (1 = black) at lattice resolution, contrast-stretched
// between the 2nd and 98th percentiles so faded prints still use the range.
export function imageDarkness(img, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) {
    d[i] = 1 - (0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2]) / 255;
  }
  const sorted = Float32Array.from(d).sort();
  const lo = sorted[Math.floor(0.02 * d.length)];
  const hi = sorted[Math.floor(0.98 * d.length)];
  const span = Math.max(hi - lo, 1e-3);
  for (let i = 0; i < d.length; i++) d[i] = Math.min(1, Math.max(0, (d[i] - lo) / span));
  return d;
}

// Separable Gaussian blur of a W×H float image (edges clamped).
function blur(src, W, H, sigma) {
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let j = -r; j <= r; j++) sum += k[j + r] = Math.exp(-(j * j) / (2 * sigma * sigma));
  for (let j = 0; j < k.length; j++) k[j] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += k[j + r] * src[y * W + clamp(x + j, W)];
      tmp[y * W + x] = acc;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += k[j + r] * tmp[clamp(y + j, H) * W + x];
      out[y * W + x] = acc;
    }
  return out;
}

// Binary "pen sketch" of a darkness map: a global threshold plus a boosted
// difference of Gaussians, so eyes, glasses and beard texture survive where
// a plain 50% threshold would give a silhouette. sigma is in cells.
export function sketch(dark, W, H, sigma = W / 16, boost = 3) {
  const smooth = blur(dark, W, H, sigma);
  const x = new Int8Array(W * H);
  for (let i = 0; i < x.length; i++) x[i] = dark[i] - 0.5 + boost * (dark[i] - smooth[i]) > 0 ? 1 : -1;
  return x;
}

// ---------------------------------------------------------------- drawing

function rgbOf(css) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const pack = ([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r; // little-endian RGBA

// Two-colour palette from CSS custom properties on `el`, e.g.
// themeColors(fig, ["--ising-up", "--ink"], ["--ising-down", "--paper-deep"]).
// Each list is tried in order. Returns a 256-step ramp for continuous values.
export function themeColors(el, upVars, downVars) {
  const style = getComputedStyle(el);
  const pick = (vars, fallback) => {
    for (const v of vars) {
      const val = style.getPropertyValue(v).trim();
      if (val) return val;
    }
    return fallback;
  };
  const up = rgbOf(pick(upVars, "#10233f"));
  const down = rgbOf(pick(downVars, "#eee9de"));
  const ramp = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    const t = k / 255;
    ramp[k] = pack(down.map((d, j) => Math.round(d + (up[j] - d) * t)));
  }
  return { up: pack(up), down: pack(down), ramp };
}

// Quarto's light/dark toggle flips a class on <body>.
export function onThemeChange(callback) {
  new MutationObserver(callback).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

export class View {
  constructor(canvas, W, H) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.image = this.ctx.createImageData(W, H);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  // Int8Array of ±1
  spins(spin, colors) {
    const { pixels } = this;
    for (let i = 0; i < spin.length; i++) pixels[i] = spin[i] > 0 ? colors.up : colors.down;
    this.ctx.putImageData(this.image, 0, 0);
  }

  // values in [-1, 1] (e.g. a posterior mean), drawn on the colour ramp
  values(values, colors) {
    const { pixels } = this;
    for (let i = 0; i < values.length; i++) {
      const k = Math.round((values[i] + 1) * 127.5);
      pixels[i] = colors.ramp[k < 0 ? 0 : k > 255 ? 255 : k];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

// ---------------------------------------------------------------- running

// Pointer position over a canvas, in lattice coordinates (null when away).
export function trackPointer(canvas, W, H) {
  const state = { pos: null };
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    state.pos = {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  });
  canvas.addEventListener("pointerleave", () => { state.pos = null; });
  return state;
}

// Calls step(dt) once per animation frame while `target` is on screen and
// the tab is visible. dt is capped so a stalled tab doesn't fast-forward
// time-based schedules; the widgets keep their own simulation clocks.
export function animate(target, step) {
  let visible = false, raf = 0, last = null;
  const frame = (now) => {
    const dt = last === null ? 0 : Math.min(now - last, 50) / 1000;
    last = now;
    step(dt);
    raf = requestAnimationFrame(frame);
  };
  const run = () => {
    const should = visible && !document.hidden;
    if (should && !raf) { last = null; raf = requestAnimationFrame(frame); }
    if (!should && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(target);
  document.addEventListener("visibilitychange", run);
}
