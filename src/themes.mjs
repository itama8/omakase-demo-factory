// Themes: one take, recoloured into every Omakase theme.
//
// A colour map (a 3D LUT) takes the take's theme, Retro 82, to another
// theme. Each is built from paired screenshots of the same screen in both
// themes (themes/refs/<kind>/<theme>.png). The PDF pane recolours
// differently from the rest of the app, so it has its own map.
//
// The take is recoloured before it is composed, so the film's own pointer,
// captions and cards keep their colours.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const BASE_THEME = "retro-82";
const N = 33;
/** An image's pixels as RGB bytes, read through ffmpeg so no image library is needed. */
function pixels(file) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [width, height] = probe.stdout.trim().split(",").map(Number);
  if (!width || !height) throw new Error(`cannot read ${file}`);
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: width * height * 3 + 1024 });
  if (raw.status !== 0) throw new Error(`cannot decode ${file}`);
  return { width, height, data: raw.stdout };
}

/**
 * Accumulate one pair of screenshots into the map's cells: for each cell of
 * the base colour, the sum and count of the colours it became. `columns` is
 * the [from, to) range of x to use.
 */
function accumulate(sums, counts, base, theme, columns = [0, base.width]) {
  if (base.width !== theme.width || base.height !== theme.height) throw new Error("paired screenshots must be the same size");
  const scale = (N - 1) / 255;
  for (let y = 0; y < base.height; y++) {
    for (let x = columns[0]; x < columns[1]; x++) {
      const i = (y * base.width + x) * 3;
      const cell = Math.round(base.data[i] * scale) + N * Math.round(base.data[i + 1] * scale) + N * N * Math.round(base.data[i + 2] * scale);
      counts[cell]++;
      sums[cell * 3] += theme.data[i]; sums[cell * 3 + 1] += theme.data[i + 1]; sums[cell * 3 + 2] += theme.data[i + 2];
    }
  }
}

/**
 * Finish a map: a cell seen at least three times keeps its mean; any other
 * cell blends its six nearest seen cells, weighted by 1/(d+0.5)^3.
 */
export function finishLut(sums, counts) {
  const seen = new Uint8Array(N ** 3);
  for (let cell = 0; cell < N ** 3; cell++) seen[cell] = counts[cell] >= 3 ? 1 : 0;
  const out = new Float64Array(N ** 3 * 3);
  const mean = (cell, c) => sums[cell * 3 + c] / counts[cell];
  const seenCells = [];
  for (let cell = 0; cell < N ** 3; cell++) if (seen[cell]) seenCells.push(cell);
  for (let cell = 0; cell < N ** 3; cell++) {
    if (seen[cell]) { for (let c = 0; c < 3; c++) out[cell * 3 + c] = mean(cell, c) / 255; continue; }
    const r = cell % N, g = Math.floor(cell / N) % N, b = Math.floor(cell / (N * N));
    // The six nearest seen cells. Few cells are seen, so checking each is quickest; ties keep grid order.
    const near = [];
    for (const other of seenCells) {
      const distance = Math.hypot((other % N) - r, (Math.floor(other / N) % N) - g, Math.floor(other / (N * N)) - b);
      if (near.length === 6 && distance >= near[5][0]) continue;
      let at = near.length === 6 ? 5 : near.length;
      if (near.length === 6) near.pop();
      while (at > 0 && near[at - 1][0] > distance) at--;
      near.splice(at, 0, [distance, other]);
    }
    if (near.length < 6) throw new Error("the screenshots cover too few colours to build a map");
    let total = 0;
    const blend = [0, 0, 0];
    for (const [distance, other] of near) {
      const weight = 1 / (distance + 0.5) ** 3;
      total += weight;
      for (let c = 0; c < 3; c++) blend[c] += mean(other, c) * weight;
    }
    for (let c = 0; c < 3; c++) out[cell * 3 + c] = blend[c] / total / 255;
  }
  return out;
}

const cube = (lut) => {
  const lines = [`LUT_3D_SIZE ${N}`];
  for (let cell = 0; cell < N ** 3; cell++) lines.push(`${lut[cell * 3].toFixed(5)} ${lut[cell * 3 + 1].toFixed(5)} ${lut[cell * 3 + 2].toFixed(5)}`);
  return lines.join("\n") + "\n";
};

/** The themes the references cover, other than the base. */
export async function referenceThemes(refs) {
  return (await readdir(path.join(refs, "screen"))).filter((file) => file.endsWith(".png")).map((file) => file.slice(0, -4)).filter((theme) => theme !== BASE_THEME).sort();
}

/**
 * Build `<theme>-app.cube` and `<theme>-pdf.cube` from the references. The
 * full-window screenshots are split where the PDF pane starts; the note and
 * card close-ups add colours for the app's map.
 */
export async function buildLuts(refs, luts, theme) {
  const meta = JSON.parse(await readFile(path.join(refs, "meta.json"), "utf8"));
  const base = pixels(path.join(refs, "screen", `${BASE_THEME}.png`)), other = pixels(path.join(refs, "screen", `${theme}.png`));
  const split = Math.round(meta.pdfFrom * base.width);
  const map = () => [new Float64Array(N ** 3 * 3), new Uint32Array(N ** 3)];
  const [appSums, appCounts] = map(), [pdfSums, pdfCounts] = map();
  accumulate(appSums, appCounts, base, other, [0, split]);
  accumulate(pdfSums, pdfCounts, base, other, [split, base.width]);
  for (const kind of ["note", "card"]) {
    const file = path.join(refs, kind, `${theme}.png`);
    if (existsSync(file)) accumulate(appSums, appCounts, pixels(path.join(refs, kind, `${BASE_THEME}.png`)), pixels(file));
  }
  await mkdir(luts, { recursive: true });
  await writeFile(path.join(luts, `${theme}-app.cube`), cube(finishLut(appSums, appCounts)));
  await writeFile(path.join(luts, `${theme}-pdf.cube`), cube(finishLut(pdfSums, pdfCounts)));
}

/** Build any map that is missing or older than its references. Returns the themes available. */
export async function ensureLuts(refs, luts, only, log = console.log) {
  const themes = (await referenceThemes(refs)).filter((theme) => !only || only.includes(theme));
  const bases = ["meta.json", ...["screen", "note", "card"].map((kind) => `${kind}/${BASE_THEME}.png`)];
  const changed = Math.max(...await Promise.all(bases.map((file) => path.join(refs, file)).filter(existsSync).map(async (file) => (await stat(file)).mtimeMs)));
  if (only) {
    const available = [BASE_THEME, ...await referenceThemes(refs)];
    for (const theme of only) if (!available.includes(theme)) throw new Error(`Unknown theme "${theme}". Available: ${available.join(", ")}`);
  }
  for (const theme of themes) {
    const target = path.join(luts, `${theme}-app.cube`);
    const sources = [`screen/${theme}.png`, `note/${theme}.png`, `card/${theme}.png`].map((file) => path.join(refs, file)).filter(existsSync);
    const newest = Math.max(changed, ...await Promise.all(sources.map(async (file) => (await stat(file)).mtimeMs)));
    if (existsSync(target) && existsSync(path.join(luts, `${theme}-pdf.cube`)) && (await stat(target)).mtimeMs >= newest) continue;
    log(`  colour map: ${theme}`);
    await buildLuts(refs, luts, theme);
  }
  return themes;
}

/**
 * Where the PDF pane was open in a take, as [{ from, to, box }] in take
 * time. A pane stays open until a later pane beat closes it or the take ends.
 */
export function pdfPanes(take) {
  const panes = [];
  for (const beat of take.beats) {
    if (beat.type !== "pane" || beat.kind !== "pdf") continue;
    if (panes.at(-1) && panes.at(-1).to === null) panes.at(-1).to = beat.t;
    if (beat.box) panes.push({ from: beat.t, to: null, box: beat.box });
  }
  return panes.map((pane) => ({ ...pane, to: pane.to ?? take.duration + 1 }));
}

/** The ffmpeg filter that recolours a take of `size` pixels into `theme`. */
export function recolourFilter(theme, take, size, luts) {
  const app = path.join(luts, `${theme}-app.cube`).replace(/[\\':]/g, "\\$&");
  const panes = pdfPanes(take);
  const input = size.scale ? `[0:v]scale=${size.width}:${size.height}:flags=lanczos[in];[in]` : "[0:v]";
  if (!panes.length) return `${input}lut3d=file='${app}'[v]`;
  const pdf = path.join(luts, `${theme}-pdf.cube`).replace(/[\\':]/g, "\\$&");
  const even = (n) => 2 * Math.round(n / 2);
  // One region per opening of the pane; each is cut from the source, mapped, and laid back over its own stretch.
  const chains = [`${input}split=${panes.length + 1}[s0]${panes.map((_, i) => `[s${i + 1}]`).join("")}`, `[s0]lut3d=file='${app}'[a0]`];
  panes.forEach((pane, i) => {
    const x = even(pane.box.x * size.width), y = even(pane.box.y * size.height);
    const w = Math.min(size.width - x, even(pane.box.w * size.width)), h = Math.min(size.height - y, even(pane.box.h * size.height));
    chains.push(`[s${i + 1}]crop=${w}:${h}:${x}:${y},lut3d=file='${pdf}'[p${i}]`);
    chains.push(`[a${i}][p${i}]overlay=${x}:${y}:enable='between(t,${pane.from.toFixed(3)},${pane.to.toFixed(3)})'[${i === panes.length - 1 ? "v" : `a${i + 1}`}]`);
  });
  return chains.join(";");
}

/**
 * Write the take recoloured into `theme`. `fit` scales it to the film's size
 * first, which is only right when the camera never zooms in.
 */
export function recolourTake({ source, file, theme, take, luts, fit }) {
  const size = fit ? { ...fit, scale: true } : { width: take.window.width * take.window.scale, height: take.window.height * take.window.scale };
  const graph = recolourFilter(theme, take, size, luts);
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-i", source, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-g", String(take.fps), file], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    ffmpeg.stderr.on("data", (chunk) => { log = (log + chunk).slice(-4000); });
    ffmpeg.once("error", reject);
    ffmpeg.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`could not recolour the take into ${theme}:\n${log}`)));
  });
}

/**
 * The website's encoding of a rendered film: 1440 wide, 30 fps, no sound,
 * ready to stream, and a WebP poster from `poster` seconds in.
 */
export function webExport({ master, file, poster }) {
  const pending = file.replace(/\.mp4$/, `.pending-${process.pid}.mp4`);
  const pendingPoster = pending.replace(/\.mp4$/, ".webp");
  const encode = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", master, "-vf", "fps=30,scale=1440:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-movflags", "+faststart", "-an", pending], { stdio: "inherit" });
  if (encode.status !== 0) throw new Error(`could not encode ${file}`);
  const duration = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", pending], { encoding: "utf8" }).stdout);
  if (!(duration > 0)) throw new Error(`could not read the duration of ${file}`);
  const at = Math.min(poster ?? 0, Math.max(0, duration - 1 / 30));
  const still = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", pending, "-frames:v", "1", "-c:v", "libwebp", "-quality", "72", pendingPoster], { stdio: "inherit" });
  if (still.status !== 0 || !existsSync(pendingPoster)) throw new Error(`could not write the poster for ${file}`);
  renameSync(pending, file);
  renameSync(pendingPoster, file.replace(/\.mp4$/, ".webp"));
}
