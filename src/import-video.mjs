// Imported recordings use the same take/edit/project format as app recordings.
// Conversion always writes to a new demo; the source file is never changed.
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { useTake } from "./takes.mjs";

export const IMPORT_FILM = { intro: "none", outro: "none", camera: "still" };
export function safeDemoName(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name ?? ""))
    throw new Error(
      "Use a demo name with lowercase letters, digits and dashes (up to 80 characters).",
    );
  return name;
}
export async function runMedia(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-1_000_000);
    });
    child.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-6000);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${command} could not prepare this video: ${errors.trim()}`,
            ),
          ),
    );
  });
}
export async function probeVideo(file) {
  let result;
  try {
    result = JSON.parse(
      await runMedia("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ]),
    );
  } catch (error) {
    throw new Error(`Could not read the video. ${error.message}`);
  }
  const video = result.streams?.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const duration = Number(video?.duration ?? result.format?.duration);
  if (
    !video ||
    !(
      video.width > 0 &&
      video.height > 0 &&
      Number.isFinite(duration) &&
      duration >= 0.1
    )
  )
    throw new Error(
      "Choose a playable video with a duration of at least 0.1 seconds.",
    );
  const [n, d] = String(video.avg_frame_rate ?? "30/1")
    .split("/")
    .map(Number);
  const rate = n / d;
  const fps = [24, 25, 30, 50, 60].reduce(
    (best, f) => (Math.abs(f - rate) < Math.abs(best - rate) ? f : best),
    30,
  );
  return {
    width: video.width,
    height: video.height,
    duration,
    fps,
    audio: result.streams.some((s) => s.codec_type === "audio"),
    stream: video.index,
  };
}
export async function importedSettings(root, name) {
  const file = path.join(root, "screenplays", safeDemoName(name), "video.json");
  const settings = JSON.parse(await readFile(file, "utf8"));
  return {
    name,
    title: settings.title,
    music: null,
    sfx: false,
    film: settings.film ?? IMPORT_FILM,
    imported: true,
  };
}
export async function importVideo({
  root,
  source,
  name,
  title,
  originalName = path.basename(source),
}) {
  source = path.resolve(source);
  if (!(await stat(source)).isFile())
    throw new Error("Choose a local video file.");
  const media = await probeVideo(source);
  title =
    String(title || path.basename(originalName, path.extname(originalName)))
      .trim()
      .slice(0, 160) || "Imported video";
  const base = safeDemoName(
    name ??
      (title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 65) ||
        "imported-video"),
  );
  await mkdir(path.join(root, "screenplays"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  let dir,
    out,
    chosen,
    reserved = false;
  for (let suffix = 1; suffix < 10000; suffix++) {
    chosen = suffix === 1 ? base : `${base}-${suffix}`;
    dir = path.join(root, "screenplays", chosen);
    out = path.join(root, "out", chosen);
    try {
      await mkdir(dir);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!name) continue;
      throw new Error(
        `A demo named ${chosen} already exists. Choose another name.`,
      );
    }
    try {
      await mkdir(out);
      reserved = true;
      break;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      if (error.code === "EEXIST" && !name) continue;
      throw error;
    }
  }
  if (!reserved)
    throw new Error(
      "Could not find an unused demo name. Choose another title.",
    );
  const id = `${Date.now()}-${randomUUID()}`,
    folder = path.join(out, "takes", id);
  try {
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "take.mp4");
    await runMedia("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      source,
      "-map",
      `0:${media.stream}`,
      "-map",
      "0:a:0?",
      "-vf",
      `scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1,fps=${media.fps}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      file,
    ]);
    const video = await probeVideo(file);
    const take = {
      name: chosen,
      imported: true,
      source: { name: originalName },
      fps: video.fps,
      audio: video.audio,
      window: { width: video.width, height: video.height, scale: 1 },
      duration: video.duration,
      beats: [
        { type: "start", t: 0 },
        { type: "span-start", id: "clip", t: 0 },
        { type: "span-end", id: "clip", t: video.duration },
        { type: "end", t: video.duration },
      ],
    };
    await writeFile(
      path.join(folder, "take.json"),
      JSON.stringify(take, null, 2) + "\n",
    );
    await writeFile(
      path.join(dir, "video.json"),
      JSON.stringify(
        { title, source: originalName, film: IMPORT_FILM },
        null,
        2,
      ) + "\n",
    );
    await writeFile(path.join(dir, "edit.yaml"), "edits: []\n");
    await useTake(out, id);
    return { name: chosen, title, take };
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
