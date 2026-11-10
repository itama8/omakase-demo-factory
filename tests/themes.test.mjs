import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filmOptions, filmSize, planFilm, waitCuts } from "../src/film.mjs";
import { finishLut, pdfPanes, recolourFilter, webExport } from "../src/themes.mjs";

const beats = [
  { type: "start", t: 0 }, { type: "span-start", id: "ask", t: 0 },
  { type: "wait-start", t: 2 }, { type: "wait-end", t: 12 },
  { type: "wait-start", t: 14 }, { type: "wait-end", t: 15.5 },
  { type: "span-end", id: "ask", t: 20 }, { type: "end", t: 20 }
];

test("website export writes a silent 30 fps video and a poster even when the cut ends before the requested poster time", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "demo-web-export-"));
  try {
    const master = path.join(dir, "master.mp4"), file = path.join(dir, "daylight-tabs.mp4");
    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x24:r=30:d=0.2", "-c:v", "libx264", master]);
    assert.equal(made.status, 0, made.stderr?.toString());
    webExport({ master, file, poster: 18 });
    const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" });
    const { streams } = JSON.parse(result.stdout);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].codec_name, "h264");
    assert.equal(streams[0].width, 1440);
    assert.equal(streams[0].avg_frame_rate, "30/1");
    assert.ok((await stat(file.replace(/\.mp4$/, ".webp"))).size > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a model's long wait is cut to a second either side; a short one stays", () => {
  assert.deepEqual(waitCuts(beats, []), [{ kind: "cut", from: 3, to: 11, wait: true }]);
  const film = planFilm({ beats, window: { width: 1280, height: 720 } }, [], { logo: 0 });
  assert.equal(film.duration, 12);
  // A speed edit over the wait is the author's choice, so the wait is kept.
  assert.deepEqual(waitCuts(beats, [{ kind: "speed", rate: 4, from: 2, to: 12 }]), []);
});

test("the film takes the window's shape, and can drop the intro, the fade and the camera", () => {
  assert.deepEqual(filmSize({ width: 1280, height: 720 }), { width: 1920, height: 1080 });
  assert.deepEqual(filmSize({ width: 1680, height: 1000 }), { width: 1920, height: 1142 });
  assert.deepEqual(filmOptions({ intro: "none", outro: "none", camera: "still" }), { logo: 0, outro: false, camera: "still" });
  const take = { window: { width: 1680, height: 1000 }, beats: [{ type: "start", t: 0 }, { type: "focus", t: 1, caption: "", box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }, { type: "end", t: 4 }] };
  const still = planFilm(take, [], filmOptions({ intro: "none", outro: "none", camera: "still" }));
  assert.equal(still.duration, 4);
  assert.equal(still.height, 1142);
  assert.equal(still.outro, false);
  assert.deepEqual(still.shots, []);
  assert.ok(planFilm(take, [], filmOptions({})).shots.length > 0);
});

test("the PDF pane is recoloured with its own map only while it is open", () => {
  const take = { duration: 30, beats: [{ type: "pane", kind: "pdf", t: 5, box: { x: 0.7, y: 0.05, w: 0.3, h: 0.95 } }, { type: "pane", kind: "pdf", t: 20, box: null }] };
  assert.deepEqual(pdfPanes(take), [{ from: 5, to: 20, box: { x: 0.7, y: 0.05, w: 0.3, h: 0.95 } }]);
  const graph = recolourFilter("lumon", take, { width: 3360, height: 2000 }, "/maps");
  assert.match(graph, /crop=1008:1900:2352:100,lut3d=file='\/maps\/lumon-pdf.cube'/);
  assert.match(graph, /enable='between\(t,5.000,20.000\)'/);
  assert.equal(recolourFilter("lumon", { duration: 3, beats: [] }, { width: 100, height: 100 }, "/maps"), "[0:v]lut3d=file='/maps/lumon-app.cube'[v]");
});

test("a colour map keeps every colour it saw, and blends the six nearest for the rest", () => {
  const N = 33, sums = new Float64Array(N ** 3 * 3), counts = new Uint32Array(N ** 3);
  // Seven seen cells along the red axis, each mapped to a known colour.
  for (let r = 0; r < 7; r++) { counts[r] = 3; sums[r * 3] = 3 * r * 10; sums[r * 3 + 1] = 3 * 255; sums[r * 3 + 2] = 0; }
  const lut = finishLut(sums, counts);
  assert.equal(lut[3 * 3], 30 / 255);
  assert.equal(lut[3 * 3 + 1], 1);
  // A far cell sees only the seen cells, so green stays at 1 and red lies within their range.
  const far = (N ** 3 - 1) * 3;
  assert.ok(Math.abs(lut[far + 1] - 1) < 1e-9);
  assert.ok(lut[far] > 0 && lut[far] < 60 / 255);
  assert.throws(() => finishLut(new Float64Array(N ** 3 * 3), new Uint32Array(N ** 3)), /too few colours/);
});
