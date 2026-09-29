// Regenerate the demo gallery thumbnails in assets/thumbnails/.
//
//   quarto render
//   cd _scripts && npm install && node thumbnails.mjs
//
// Serves _site locally, opens each demo in headless Chromium, stages a
// representative moment, then composes the demo's canvases side by side onto
// one card-shaped image (the gallery crops to 1.68:1) and saves it. Thumbnails
// are committed; CI does not run this. To add a demo, append to DEMOS and point
// the page's `image:` front matter at the output file.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = join(root, "_site");
const outDir = join(root, "assets", "thumbnails");

const DEMOS = [
  {
    page: "/demos/portrait.html",
    canvases: ["[data-preset]"],
    shape: "arch",
    stage: async (page) => page.waitForTimeout(6000),
    out: "portrait.png",
  },
  {
    page: "/blog/posts/2026-09-29-ising-inference.html",
    canvases: ['[data-panel="data"]', '[data-panel="mean"]'],
    stage: async (page) => page.waitForTimeout(6000),
    out: "ising-inference.png",
  },
  {
    page: "/blog/posts/2026-09-29-ising-nucleation.html",
    canvases: ['[data-panel="lattice"]'],
    // plant a few supercritical droplets and catch them early in their growth
    stage: async (page) => {
      await page.locator('[data-panel="lattice"]').scrollIntoViewIfNeeded();
      const box = await page.locator('[data-panel="lattice"]').boundingBox();
      for (const [fx, fy] of [[0.22, 0.35], [0.6, 0.65], [0.8, 0.25]]) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
    },
    out: "ising-nucleation.png",
  },
];

// Draw the matching canvases in one row, pixel-sharp, clipped to rounded
// rectangles or hero-style arches, on the page's paper colour.
function compose([selectors, shape]) {
  const W = 1200, H = 714, PAD = 56, GAP = 36;
  const srcs = selectors.flatMap((s) => [...document.querySelectorAll(s)]);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--paper").trim() || "#f7f4ed";
  ctx.fillRect(0, 0, W, H);

  const aspects = srcs.map((c) => c.width / c.height);
  const sum = aspects.reduce((a, b) => a + b, 0);
  const h = Math.min(H - 2 * PAD, (W - 2 * PAD - GAP * (srcs.length - 1)) / sum);
  let x = (W - (sum * h + GAP * (srcs.length - 1))) / 2;
  const y = (H - h) / 2;

  srcs.forEach((src, k) => {
    const w = aspects[k] * h, r = 18;
    ctx.save();
    ctx.beginPath();
    if (shape === "arch") {
      ctx.moveTo(x, y + h - r);
      ctx.lineTo(x, y + w / 2);
      ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
    } else {
      ctx.roundRect(x, y, w, h, r);
    }
    ctx.clip();
    ctx.drawImage(src, x, y, w, h);
    ctx.restore();
    x += w + GAP;
  });

  out.id = "__thumbnail";
  Object.assign(out.style, { position: "fixed", left: "0", top: "0", zIndex: "99999", width: `${W / 2}px`, height: `${H / 2}px` });
  document.body.append(out);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".mp4": "video/mp4", ".xml": "application/xml",
};

const server = createServer(async (req, res) => {
  let path = join(site, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});

try {
  await stat(join(site, "index.html"));
} catch {
  console.error("No _site/ found. Run `quarto render` first.");
  process.exit(1);
}

await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
await context.addInitScript(() => localStorage.setItem("quarto-color-scheme", "default"));

let failed = false;
for (const demo of DEMOS) {
  const page = await context.newPage();
  page.on("pageerror", (e) => { failed = true; console.error(`${demo.page}: ${e}`); });
  await page.goto(base + demo.page, { waitUntil: "networkidle" });
  await page.locator(demo.canvases[0]).first().scrollIntoViewIfNeeded();
  await demo.stage(page);
  await page.evaluate(compose, [demo.canvases, demo.shape]);
  await page.locator("#__thumbnail").screenshot({ path: join(outDir, demo.out) });
  console.log(`wrote assets/thumbnails/${demo.out}`);
  await page.close();
}

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
