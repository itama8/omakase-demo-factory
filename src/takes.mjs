// Takes: every successful recording is kept under out/<name>/takes/<id>/,
// and out/<name>/take.json plus take.mp4 point at the one in use. This
// module lists them, switches between them, and splices a re-recorded scene
// into an existing take.
import { spawn } from "node:child_process";
import { readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const round = (n) => Number(n.toFixed(3));

/** Make take `id` the one in use. The pointer files are replaced atomically. */
export async function useTake(out, id) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not a take id`);
  const take = JSON.parse(await readFile(path.join(out, "takes", id, "take.json"), "utf8").catch(() => { throw new Error(`No take "${id}". Run "takes" to list them.`); }));
  take.video = `takes/${id}/take.mp4`;
  const pending = path.join(out, `take-${id}.json`), link = path.join(out, `take-${id}.mp4`);
  await writeFile(pending, JSON.stringify(take, null, 1));
  await rm(link, { force: true });
  await symlink(take.video, link);
  await rename(link, path.join(out, "take.mp4"));
  await rename(pending, path.join(out, "take.json"));
  return take;
}

/** Kept takes, newest first, as { id, at, duration, fps, scene, current }. */
export async function listTakes(out) {
  const current = await readFile(path.join(out, "take.json"), "utf8").then((text) => JSON.parse(text).video?.split("/")[1]).catch(() => null);
  const ids = await readdir(path.join(out, "takes")).catch(() => []);
  const takes = [];
  for (const id of ids) {
    const take = await readFile(path.join(out, "takes", id, "take.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!take) continue;
    takes.push({ id, at: Number(id.split("-")[0]), duration: take.duration, fps: take.fps, scene: take.spliced ?? null, current: id === current });
  }
  return takes.sort((a, b) => b.at - a.at);
}

/**
 * The beats of `old` with one scene replaced by the same scene from `part`,
 * the stretches of video that make the new take, and where they join. Times after the
 * scene move by the difference in its length.
 */
export function spliceBeats(old, part, scene) {
  const edges = (beats, what) => {
    const first = beats.findIndex((beat) => beat.type === "span-start" && beat.id === scene);
    const last = beats.findIndex((beat) => beat.type === "span-end" && beat.id === scene);
    if (first < 0 || last < first) throw new Error(`${what} has no scene "${scene}". Record a whole take instead.`);
    return { first, last, from: beats[first].t, to: beats[last].t };
  };
  const was = edges(old.beats, "The take in use"), now = edges(part.beats, "The new recording");
  // A head shorter than a frame cannot be cut out of the old video.
  const head = was.from >= 2 / old.fps ? was.from : 0;
  const shift = (beat, by) => ({ ...beat, t: round(beat.t + by), ...(beat.pressed === undefined ? {} : { pressed: round(beat.pressed + by) }) });
  const beats = [
    ...old.beats.slice(0, was.first).map((beat) => shift(beat, head - was.from)),
    ...part.beats.slice(now.first, now.last + 1).map((beat) => shift(beat, head - now.from)),
    ...old.beats.slice(was.last + 1).map((beat) => shift(beat, head + (now.to - now.from) - was.to))
  ];
  const segments = [
    ...(head ? [{ source: "old", from: 0, to: was.from }] : []),
    { source: "part", from: now.from, to: now.to },
    { source: "old", from: was.to, to: null }
  ];
  // Where the footage changes recording. Earlier joins move with the beats around them.
  const moved = (t) => t <= was.from ? t + head - was.from : t >= was.to ? t + head + (now.to - now.from) - was.to : null;
  const joins = [...(old.joins ?? []).map(moved).filter((t) => t !== null), ...(head ? [head] : []), head + now.to - now.from]
    .map(round).filter((t, i, all) => all.indexOf(t) === i).sort((a, b) => a - b);
  return { beats, segments, joins };
}

/** Write the spliced video. It is encoded again, because a cut must land on a frame, not a keyframe. */
export function spliceVideo({ oldVideo, partVideo, segments, fps, file }) {
  const input = { old: 0, part: 1 };
  const chains = segments.map((segment, i) => `[${input[segment.source]}:v]trim=start=${segment.from}${segment.to === null ? "" : `:end=${segment.to}`},setpts=PTS-STARTPTS[s${i}]`);
  const graph = `${chains.join(";")};${segments.map((_, i) => `[s${i}]`).join("")}concat=n=${segments.length}:v=1:a=0[v]`;
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-i", oldVideo, "-i", partVideo, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", "-g", String(fps), file], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    ffmpeg.stderr.on("data", (chunk) => { log = (log + chunk).slice(-4000); });
    ffmpeg.once("error", reject);
    ffmpeg.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`could not splice the scene into the take:\n${log}`)));
  });
}
