// Build the HyperFrames project for a take: direct it, apply the edit, and
// write a composition that plays the kept pieces under the planned camera.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { direct } from "./director.mjs";
import { assemble, loadEdit, reframe } from "./edit.mjs";

// The logo plays in silence for this long, then the take starts with the music.
const LOGO = 2.6;
const round = (n) => Number(n.toFixed(3));

export async function buildProject({ root, omakaseRoot, name, music }) {
  const out = path.join(root, "out", name);
  const project = path.join(out, "project");
  const assets = path.join(project, "assets");
  const take = JSON.parse(await readFile(path.join(out, "take.json"), "utf8"));
  const begin = take.beats.find((beat) => beat.type === "start").t;
  const end = take.beats.findLast((beat) => beat.type === "end").t;

  const edits = await loadEdit(path.join(root, "screenplays", name, "edit.yaml"), take.beats);
  const { pieces, length, when } = assemble(edits, begin, end);
  if (!pieces.length) throw new Error("the edit cuts the whole take");
  // Shots move from take time to film time. One that starts inside a cut
  // begins where the film resumes, and none runs into the next.
  const shots = reframe(direct(take.beats), edits)
    .map((shot) => ({ ...shot, at: LOGO + when(shot.t), until: LOGO + when(shot.t + shot.duration) }))
    .map((shot, index, all) => ({ t: round(shot.at), duration: round(Math.min(shot.until, all[index + 1]?.at ?? Infinity) - shot.at), ease: shot.ease, frame: shot.frame }))
    .filter((shot) => shot.duration > 0.01);
  const duration = round(LOGO + length);

  await rm(project, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await cp(path.join(out, "take.mp4"), path.join(assets, "take.mp4"));
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

  await writeFile(path.join(project, "film.js"), `window.__film = ${JSON.stringify({ logo: LOGO, duration, shots })};\n`);
  const fill = { DURATION: duration, LOGO, VIDEOS: videos, AUDIO: audio };
  const template = await readFile(path.join(root, "template/index.html"), "utf8");
  await writeFile(path.join(project, "index.html"), template.replace(/__([A-Z]+)__/g, (_, key) => fill[key]));
  return { project, duration, pieces: pieces.length, shots: shots.length, edits: edits.length };
}
