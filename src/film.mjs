// One film plan for the browser and the exported composition.
import { direct } from "./director.mjs";
import { assemble, reframe } from "./edit.mjs";

export function planFilm(take, edits, { logo = 2.6 } = {}) {
  const begin = take.beats.find((beat) => beat.type === "start")?.t;
  const end = take.beats.findLast((beat) => beat.type === "end")?.t;
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) throw new Error("Take needs a positive start/end range");
  const { pieces, length, when } = assemble(edits, begin, end);
  if (!pieces.length) throw new Error("The edit cuts the whole take");
  const mapped = [];
  for (const shot of reframe(direct(take.beats), edits)) {
    const entry = { ...shot, t: logo + when(shot.t), until: logo + when(shot.t + shot.duration) };
    // Several camera changes can occur in a removed stretch. Retain its
    // final pose at the join, even when the whole movement was cut away.
    if (Math.abs((mapped.at(-1)?.t ?? -Infinity) - entry.t) < 1e-6) mapped[mapped.length - 1] = entry;
    else mapped.push(entry);
  }
  const shots = mapped.filter((shot) => shot.t < logo + length)
    .map((shot, index, all) => ({ t: shot.t, duration: Math.min(Math.max(0.001, shot.until - shot.t), (all[index + 1]?.t ?? logo + length) - shot.t), ease: shot.ease, frame: shot.frame }));
  const focuses = take.beats.filter((beat) => beat.type === "focus" && typeof beat.caption === "string");
  const base = focuses.map((beat, i) => ({ from: beat.t, to: focuses[i + 1]?.t ?? end, text: beat.caption, position: beat.position ?? "bottom" }));
  const layers = [...base, ...edits.filter((edit) => edit.kind === "caption")];
  const marks = [...new Set([begin, end, ...layers.flatMap((entry) => [entry.from, entry.to])])].filter((t) => t >= begin && t <= end).sort((a, b) => a - b);
  const captions = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i], b = marks[i + 1];
    const entry = layers.findLast((entry) => entry.from <= a && entry.to >= b);
    const start = logo + when(a), duration = when(b) - when(a);
    if (!entry?.text || duration < 1 / 30) continue;
    const previous = captions.at(-1);
    if (previous && previous.text === entry.text && previous.position === entry.position && Math.abs(previous.start + previous.duration - start) < 1e-6) previous.duration += duration;
    else captions.push({ start, duration, text: entry.text, position: entry.position });
  }
  return { logo, duration: logo + length, pieces, shots, captions };
}
