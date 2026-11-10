// Build the HyperFrames project for a take: direct it, apply the edit, and
// write a composition that plays the kept pieces under the planned camera.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEdit } from "./edit.mjs";
import { filmOptions, planFilm } from "./film.mjs";
import { mixSounds } from "./sound.mjs";
import { runMedia } from "./import-video.mjs";

const round = (n) => Number(n.toFixed(3));

/** The take scaled to the film's size, made once per recording and kept beside it. */
async function fitted(source, film, fps) {
  const real = await realpath(source);
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", real], { encoding: "utf8" }).stdout.trim();
  if (probe === `${film.width},${film.height}`) return real;
  const file = real.replace(/\.mp4$/, `-${film.width}x${film.height}.mp4`);
  if (existsSync(file) && statSync(file).mtimeMs >= statSync(real).mtimeMs) return file;
  const pending = `${file}.${process.pid}.tmp.mp4`;
  await runMedia("ffmpeg", ["-v", "error", "-y", "-i", real, "-vf", `scale=${film.width}:${film.height}:flags=lanczos`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", "-g", String(fps ?? 30), pending]);
  await rename(pending, file);
  return file;
}

export async function buildProject({ root, omakaseRoot, name, music, sfx = false, film: options = {}, take: takeFile = "take.json", video, out: projectDir }) {
  const out = path.join(root, "out", name);
  const project = projectDir ?? path.join(out, "project");
  const assets = path.join(project, "assets");
  const take = JSON.parse(await readFile(path.join(out, takeFile), "utf8"));
  // The logo plays in silence, then the take starts with the music.
  const shape = filmOptions(options), LOGO = shape.logo;

  const edits = await loadEdit(path.join(root, "screenplays", name, "edit.yaml"), take.beats);
  const film = planFilm(take, edits, shape);
  const { pieces, shots, duration } = film;
  const length = duration - LOGO;

  await rm(project, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  // The browser that renders the film shrinks video with a plain filter, which smears small text.
  // When no shot zooms in, give it the take already at the film's size.
  const zooms = Math.max(1, ...film.shots.map((shot) => shot.frame.zoom));
  const source = video ?? path.join(out, take.video ?? "take.mp4");
  let picture = source;
  if (take.audio) {
    // The renderer may extract embedded audio even from muted video elements.
    // Give the picture no audio stream; narration has its own timed lanes.
    const real = await realpath(source), silent = real.replace(/\.mp4$/, "-picture.mp4");
    if (!existsSync(silent) || statSync(silent).mtimeMs < statSync(real).mtimeMs) await runMedia("ffmpeg", ["-v", "error", "-y", "-i", real, "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", silent]);
    picture = silent;
  }
  await cp(zooms <= 1.05 ? await fitted(picture, film, take.fps) : picture, path.join(assets, "take.mp4"), { dereference: true });
  const icon = path.join(omakaseRoot, "build/icon.png"), font = path.join(omakaseRoot, "src/vendor/fonts/IBMPlexSerif-Regular.ttf");
  if (existsSync(icon)) await cp(icon, path.join(assets, "icon.png"));
  if (existsSync(font)) await cp(font, path.join(assets, "IBMPlexSerif-Regular.ttf"));
  let audio = "";
  if (take.audio) {
    const real = await realpath(source), cached = real.replace(/\.mp4$/, "-audio.m4a");
    if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(real).mtimeMs) {
      await runMedia("ffmpeg", ["-v", "error", "-y", "-i", real, "-vn", "-c:a", "aac", "-b:a", "192k", cached]);
    }
    await cp(cached, path.join(assets, "original.m4a"));
    audio = pieces.map((piece, i) => `<audio id="original-${i}" class="original-audio" src="assets/original.m4a" data-start="${round(LOGO + piece.at)}" data-duration="${round((piece.b - piece.a) / piece.rate)}" data-media-start="${round(piece.a)}" data-playback-rate="${piece.rate}" data-track-index="5" data-volume="1"></audio>`).join("\n");
  }
  if (music) {
    const encoded = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", music, "-t", String(length + 1), "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", path.join(assets, "music.m4a")], { stdio: "inherit" });
    if (encoded.status !== 0) throw new Error(`could not encode the music from ${music}`);
    const lane = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0.55 }, { t: round(Math.max(0, length - 1.4)), v: 0.55 }, { t: round(length), v: 0 }] }] };
    audio += `<audio id="music" src="assets/music.m4a" data-start="${LOGO}" data-duration="${round(length)}" data-track-index="2" data-volume="0.55" data-automation='${JSON.stringify(lane)}'></audio>`;
  }
  if (sfx && film.sounds.length) {
    const wav = path.join(assets, "sfx.wav");
    await writeFile(wav, mixSounds(film.sounds, duration));
    const encoded = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "128k", path.join(assets, "sfx.m4a")], { stdio: "inherit" });
    if (encoded.status !== 0) throw new Error("could not encode the key sounds");
    await rm(wav);
    audio += `\n      <audio id="sfx" src="assets/sfx.m4a" data-start="0" data-duration="${round(duration)}" data-track-index="4" data-volume="0.5"></audio>`;
  }
  // One clip per kept piece. They share a track and never overlap.
  const videos = pieces.map((piece, index) =>
    `<video id="take-${index + 1}" class="clip take" src="assets/take.mp4" muted playsinline data-start="${round(LOGO + piece.at)}" data-duration="${round((piece.b - piece.a) / piece.rate)}" data-media-start="${round(piece.a)}"${piece.rate === 1 ? "" : ` data-playback-rate="${piece.rate}"`} data-track-index="0"></video>`
  ).join("\n          ");

  await writeFile(path.join(project, "film.js"), `window.__film = ${JSON.stringify(film)};\n`);
  await cp(path.join(root, "template/player.js"), path.join(project, "player.js"));
  await cp(path.join(root, "node_modules/gsap/dist/gsap.min.js"), path.join(project, "gsap.min.js"));
  const fill = { DURATION: duration, LOGO, FPS: film.fps, WIDTH: film.width, HEIGHT: film.height, VIDEOS: videos, AUDIO: audio, MARKS: film.html.camera, OVERLAYS: film.html.screen, TITLEFONT: existsSync(font) ? '"Plex Serif", Georgia, serif' : 'Georgia, serif', FONTFACE: existsSync(font) ? '@font-face { font-family: "Plex Serif"; src: url("assets/IBMPlexSerif-Regular.ttf") format("truetype"); }' : '', LOGOMARK: existsSync(icon) ? '<img id="logo-mark" src="assets/icon.png" alt="" />' : '<div id="logo-mark">Omakase</div>' };
  const template = await readFile(path.join(root, "template/index.html"), "utf8");
  await writeFile(path.join(project, "index.html"), template.replace(/__([A-Z]+)__/g, (_, key) => fill[key]));
  // Past this zoom the footage is enlarged beyond the pixels that were recorded.
  const sharp = (take.window.width * take.window.scale) / film.width;
  const closest = Math.max(1, ...shots.map((shot) => shot.frame.zoom));
  return { project, duration, pieces: pieces.length, shots: shots.length, edits: edits.length, fps: film.fps, sharp, closest };
}
