// Export presets. The composition renders one 1920x1080 master; every other
// format is made from it, so a preset never needs a second render.
import { spawnSync } from "node:child_process";
import path from "node:path";

const CANVAS = "0x07171d";
const fit = (width, height) => `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${CANVAS}`;
const audio = ["-c:a", "aac", "-b:a", "192k"];
const h264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

export const PRESETS = {
  "1080p": { ext: "mp4", summary: "1920x1080 MP4, the master" },
  "720p": { ext: "mp4", summary: "1280x720 MP4", args: ["-vf", "scale=1280:-2:flags=lanczos", ...h264, ...audio] },
  square: { ext: "mp4", summary: "1080x1080 MP4, the film across the middle", args: ["-vf", fit(1080, 1080), ...h264, ...audio] },
  vertical: { ext: "mp4", summary: "1080x1920 MP4, the film across the middle", args: ["-vf", fit(1080, 1920), ...h264, ...audio] },
  webm: { ext: "webm", summary: "1920x1080 WebM (VP9)", args: ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"] },
  gif: { ext: "gif", summary: "960 wide, 15 frames a second, silent", args: ["-filter_complex", "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0"] },
  poster: { ext: "png", summary: "one frame as a PNG; --at <seconds> picks it" }
};

/** Where a preset's file goes. The master keeps the demo's plain name. */
export const exportFile = (out, name, preset) => path.join(out, preset === "1080p" ? `${name}.mp4` : `${name}-${preset}.${PRESETS[preset].ext}`);

/** Make `preset` from the rendered master and return its path. */
export function exportPreset({ out, name, preset, at }) {
  const master = exportFile(out, name, "1080p"), file = exportFile(out, name, preset);
  if (preset === "1080p") return file;
  let args = PRESETS[preset].args;
  if (preset === "poster") {
    const length = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", master], { encoding: "utf8" }).stdout);
    // Two fifths in is usually past the opening and inside the work.
    const second = at ?? (Number.isFinite(length) ? length * 0.4 : 0);
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(second), "-i", master, "-frames:v", "1", file], { stdio: "inherit" });
    if (made.status !== 0) throw new Error("could not write the poster frame");
    return file;
  }
  const made = spawnSync("ffmpeg", ["-v", "error", "-stats", "-y", "-i", master, ...args, file], { stdio: "inherit" });
  if (made.status !== 0) throw new Error(`could not export the ${preset} preset`);
  return file;
}
