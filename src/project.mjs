// Build the HyperFrames project for a take: direct it, apply the edit, and
// write a composition that plays the kept pieces under the planned camera.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEdit } from "./edit.mjs";
import { planFilm } from "./film.mjs";

// The logo plays in silence for this long, then the take starts with the music.
const LOGO = 2.6;
const round = (n) => Number(n.toFixed(3));

export async function buildProject({ root, omakaseRoot, name, music }) {
  const out = path.join(root, "out", name);
  const project = path.join(out, "project");
  const assets = path.join(project, "assets");
  const take = JSON.parse(await readFile(path.join(out, "take.json"), "utf8"));

  const edits = await loadEdit(path.join(root, "screenplays", name, "edit.yaml"), take.beats);
  const film = planFilm(take, edits, { logo: LOGO });
  const { pieces, shots, duration, captions } = film;
  const length = duration - LOGO;

  await rm(project, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await cp(path.join(out, take.video ?? "take.mp4"), path.join(assets, "take.mp4"), { dereference: true });
  await cp(path.join(omakaseRoot, "build/icon.png"), path.join(assets, "icon.png"));
  await cp(path.join(omakaseRoot, "src/vendor/fonts/IBMPlexSerif-Regular.ttf"), path.join(assets, "IBMPlexSerif-Regular.ttf"));
  let audio = "";
  if (music) {
    const encoded = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", music, "-t", String(length + 1), "-c:a", "aac", "-b:a", "192k", path.join(assets, "music.m4a")], { stdio: "inherit" });
    if (encoded.status !== 0) throw new Error(`could not encode the music from ${music}`);
    const lane = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0.55 }, { t: round(Math.max(0, length - 1.4)), v: 0.55 }, { t: round(length), v: 0 }] }] };
    audio = `<audio id="music" src="assets/music.m4a" data-start="${LOGO}" data-duration="${round(length)}" data-track-index="2" data-volume="0.55" data-automation='${JSON.stringify(lane)}'></audio>`;
  }
  // One clip per kept piece. They share a track and never overlap.
  const videos = pieces.map((piece, index) =>
    `<video id="take-${index + 1}" class="clip take" src="assets/take.mp4" muted playsinline data-start="${round(LOGO + piece.at)}" data-duration="${round((piece.b - piece.a) / piece.rate)}" data-media-start="${round(piece.a)}"${piece.rate === 1 ? "" : ` data-playback-rate="${piece.rate}"`} data-track-index="0"></video>`
  ).join("\n          ");

  const escape = (text) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const labels = captions.map((caption, index) => `<div id="caption-${index}" class="clip caption ${caption.position}" data-start="${caption.start}" data-duration="${caption.duration}" data-track-index="3"><span>${escape(caption.text)}</span></div>`).join("\n");
  await writeFile(path.join(project, "film.js"), `window.__film = ${JSON.stringify(film)};\n`);
  await cp(path.join(root, "template/player.js"), path.join(project, "player.js"));
  await cp(path.join(root, "node_modules/gsap/dist/gsap.min.js"), path.join(project, "gsap.min.js"));
  const fill = { DURATION: duration, LOGO, VIDEOS: videos, AUDIO: audio, CAPTIONS: labels };
  const template = await readFile(path.join(root, "template/index.html"), "utf8");
  await writeFile(path.join(project, "index.html"), template.replace(/__([A-Z]+)__/g, (_, key) => fill[key]));
  return { project, duration, pieces: pieces.length, shots: shots.length, edits: edits.length };
}
