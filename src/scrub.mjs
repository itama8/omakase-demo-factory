// A scrub copy of the take for the review editor.
//
// Recordings keep a keyframe only every few seconds, so a seek in the full
// take decodes up to hundreds of large frames and a drag shows about one
// frame a second. This copy is smaller, at most 30 fps and has a keyframe
// every 0.2s: a seek costs ~10ms. The editor shows it only while scrubbing
// and returns to the full-quality take as soon as the playhead settles.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SCRUB_ARGS = (source, file) => [
  "-v", "error", "-y", "-i", source, "-an",
  "-vf", "scale='min(1280,iw)':-2", "-r", "30",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
  "-g", "6", "-keyint_min", "6", "-sc_threshold", "0",
  // Leave most of the machine to the person editing.
  "-threads", String(Math.max(1, Math.floor(os.cpus().length / 2))),
  "-movflags", "+faststart", "-f", "mp4", file,
];

// Builds rewrite the project's take.mp4 with fresh timestamps, so name the
// copy by its size and content, sampling the ends instead of hashing 100MB+.
async function fingerprint(file, size) {
  const handle = await open(file, "r");
  try {
    const hash = createHash("sha1").update(String(size)), chunk = Math.min(size, 4 << 20);
    for (const at of [0, Math.max(0, size - chunk)]) {
      const buffer = Buffer.alloc(chunk);
      await handle.read(buffer, 0, chunk, at);
      hash.update(buffer);
    }
    return hash.digest("hex").slice(0, 16);
  } finally {
    await handle.close();
  }
}

/** Keeps out/<name>/scrub/<fingerprint>.mp4 in step with the project's take. */
export function scrubCopy(out, { command = "ffmpeg" } = {}) {
  const source = path.join(out, "project", "assets", "take.mp4"),
    folder = path.join(out, "scrub");
  let seen = null, key = null, state = "none", child = null, busy = null;
  async function refresh() {
    let info;
    try { info = await stat(source); } catch { return; }
    const signature = `${info.size}:${info.mtimeMs}`;
    if (signature === seen) return;
    seen = signature;
    const next = await fingerprint(source, info.size);
    if (next === key && state !== "failed") return;
    child?.kill("SIGTERM");
    key = next;
    const file = path.join(folder, `${key}.mp4`);
    if (await stat(file).then(() => true, () => false)) { state = "ready"; return; }
    state = "making";
    await mkdir(folder, { recursive: true });
    const part = path.join(folder, `${key}.part`);
    const mine = key;
    const run = spawn(command, SCRUB_ARGS(source, part), { stdio: "ignore" });
    child = run;
    run.once("error", () => { if (key === mine) state = "failed"; });
    run.once("exit", async (code) => {
      if (child === run) child = null;
      if (key !== mine) { await rm(part, { force: true }); return; }
      if (code !== 0) { state = "failed"; await rm(part, { force: true }); return; }
      await rename(part, file);
      // Only the current take's copy is worth its disk space.
      for (const entry of await readdir(folder)) if (entry !== `${key}.mp4`) await rm(path.join(folder, entry), { force: true });
      state = "ready";
    });
  }
  return {
    refresh() {
      busy ??= refresh().catch(() => {}).finally(() => (busy = null));
      return busy;
    },
    get url() { return state === "ready" ? `/scrub.mp4?v=${key}` : null; },
    get file() { return state === "ready" ? path.join(folder, `${key}.mp4`) : null; },
    folder,
    close() { child?.kill("SIGTERM"); },
  };
}
