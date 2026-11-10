// One film plan for the browser and the exported composition.
import { direct } from "./director.mjs";
import { assemble, reframe } from "./edit.mjs";
import { overlayHtml } from "./overlays.mjs";

const round = (n) => Number(n.toFixed(3));

/**
 * Layers that each hold from one moment to the next, such as captions. A
 * later layer wins where two overlap. Returns the stretches that survive
 * the cuts, in film time, merged where the same entry continues.
 */
function stretches(layers, { begin, end, when }, same) {
  const marks = [...new Set([begin, end, ...layers.flatMap((entry) => [entry.from, entry.to])])].filter((t) => t >= begin && t <= end).sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i], b = marks[i + 1];
    const entry = layers.findLast((layer) => layer.from <= a && layer.to >= b);
    const start = when(a), duration = when(b) - when(a);
    if (!entry || duration < 1 / 30) continue;
    const previous = result.at(-1);
    if (previous && same(previous.entry, entry) && Math.abs(previous.start + previous.duration - start) < 1e-6) previous.duration += duration;
    else result.push({ start, duration, entry });
  }
  return result;
}

/**
 * The drawn pointer. The recording has no cursor, so each logged click
 * becomes a glide to the point, a press, and a short rest. Clicks close
 * together share one appearance; the pointer leaves when it has nothing to do.
 */
function pointer(beats, { when, kept }, logo) {
  const clicks = beats.filter((beat) => beat.type === "click" && kept(beat.t)).map((beat) => {
    // The performer logs where it is heading a moment before it clicks.
    const aim = beats.findLast((other) => other.type === "pointer" && other.t <= beat.t && beat.t - other.t < 3 && Math.abs(other.x - beat.x) < 0.02 && Math.abs(other.y - beat.y) < 0.02);
    const t = logo + when(beat.t);
    const from = Math.min(t - 0.35, aim && kept(aim.t) ? logo + when(aim.t) : t);
    return { t, from: Math.max(logo, from), x: beat.x, y: beat.y };
  });
  const moves = [], visible = [];
  let previous = null;
  for (const click of clicks) {
    const fresh = !previous || click.from - previous.t > 2.4;
    if (fresh) {
      // Enter from a little below and to the right, as a hand comes to a mouse.
      moves.push({ t: Math.max(0, click.from - 0.01), duration: 0.001, x: Math.min(0.98, click.x + 0.07), y: Math.min(0.98, click.y + 0.1), ease: "none" });
      visible.push({ start: click.from, end: click.t + 1.1 });
    } else visible.at(-1).end = click.t + 1.1;
    moves.push({ t: click.from, duration: Math.max(0.2, click.t - click.from - 0.06), x: click.x, y: click.y, ease: "power2.inOut" });
    previous = click;
  }
  return { moves: moves.map((move) => ({ ...move, t: round(move.t), duration: round(move.duration) })), visible: visible.map((span) => ({ start: round(span.start), end: round(span.end) })), clicks: clicks.map(({ t, x, y }) => ({ t: round(t), x, y })) };
}

/** Each key and click that survives the cuts, in film time. A sped-up stretch is thinned to what a hand could play. */
function soundsOf(beats, { pieces, when }, logo) {
  const strokes = beats.some((beat) => beat.type === "key") ? "key" : "caret";
  const sounds = [];
  for (const beat of beats) {
    const kind = beat.type === "click" ? "click" : beat.type === strokes ? "key" : null;
    const piece = kind && pieces.find((entry) => entry.a <= beat.t && beat.t <= entry.b);
    if (!piece) continue;
    const t = round(logo + when(beat.t));
    if (kind === "key" && sounds.length && t - sounds.at(-1).t < 0.05) continue;
    sounds.push({ t, kind });
  }
  return sounds;
}

/** The film's picture: 1920 wide, as tall as the recorded window's shape needs, in whole even pixels. */
export function filmSize(window = { width: 1280, height: 720 }) {
  return { width: 1920, height: 2 * Math.round((1920 * window.height) / window.width / 2) };
}

/**
 * How a screenplay asks to be filmed. `intro: none` drops the logo,
 * `outro: none` the closing fade, and `camera: still` holds the whole window.
 */
export function filmOptions(film = {}) {
  return { logo: film.intro === "none" ? 0 : 2.6, outro: film.outro !== "none", camera: film.camera ?? "auto" };
}

/**
 * Waits for a model, shortened to a second either side so the answer still
 * visibly arrives. A speed edit over a wait keeps it: the author asked to
 * see that stretch in a particular way.
 */
export function waitCuts(beats, edits) {
  const cuts = [];
  beats.forEach((beat, index) => {
    if (beat.type !== "wait-start") return;
    const end = beats.slice(index + 1).find((other) => other.type === "wait-end");
    if (!end || end.t - beat.t <= 2.6) return;
    const from = beat.t + 1, to = end.t - 1;
    if (edits.some((edit) => edit.kind === "speed" && edit.from < to && from < edit.to)) return;
    cuts.push({ kind: "cut", from, to, wait: true });
  });
  return cuts;
}

export function planFilm(take, authored, { logo = 2.6, outro = true, camera = "auto", recordedEdits = authored.recordedEdits ?? true } = {}) {
  const begin = take.beats.find((beat) => beat.type === "start")?.t;
  const end = take.beats.findLast((beat) => beat.type === "end")?.t;
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) throw new Error("Take needs a positive start/end range");
  const edits = [...waitCuts(take.beats, authored), ...authored];
  const cut = assemble(edits, begin, end);
  const { pieces, length, when } = cut;
  if (!pieces.length) throw new Error("The edit cuts the whole take");
  const mapped = [];
  for (const shot of reframe(camera === "still" || !recordedEdits ? [] : direct(take.beats), edits)) {
    const entry = { ...shot, t: logo + when(shot.t), until: logo + when(shot.t + shot.duration) };
    // Several camera changes can occur in a removed stretch. Retain its
    // final pose at the join, even when the whole movement was cut away.
    if (Math.abs((mapped.at(-1)?.t ?? -Infinity) - entry.t) < 1e-6) mapped[mapped.length - 1] = entry;
    else mapped.push(entry);
  }
  const shots = mapped.filter((shot) => shot.t < logo + length)
    .map((shot, index, all) => ({ t: shot.t, duration: Math.min(Math.max(0.001, shot.until - shot.t), (all[index + 1]?.t ?? logo + length) - shot.t), ease: shot.ease, frame: shot.frame }));

  // A focus holds its caption and its mark until the next focus.
  const focuses = (recordedEdits ? take.beats : []).filter((beat) => beat.type === "focus" && typeof beat.caption === "string");
  const held = focuses.map((beat, i) => ({ ...beat, from: beat.t, to: focuses[i + 1]?.t ?? end }));
  const range = { begin, end, when };
  const captions = stretches([...held.map((beat) => ({ from: beat.from, to: beat.to, text: beat.caption, position: beat.position ?? "bottom" })), ...edits.filter((edit) => edit.kind === "caption")], range, (a, b) => a.text === b.text && a.position === b.position && JSON.stringify(a.box) === JSON.stringify(b.box))
    .filter(({ entry }) => entry.text)
    .map(({ start, duration, entry }) => ({ start: logo + start, duration, text: entry.text, position: entry.position, ...(entry.box ? { box: entry.box } : {}) }));
  const keys = stretches(edits.filter((edit) => edit.kind === "keys"), range, (a, b) => a === b)
    .map(({ start, duration, entry }) => ({ start: round(logo + start), duration: round(duration), label: entry.label, position: entry.position, ...(entry.box ? {box:entry.box} : {}) }));
  // Highlights may overlap one another, so each keeps its own stretch.
  const highlights = [...held.filter((beat) => beat.mark && beat.mark !== "none" && beat.box).map((beat) => ({ from: beat.from, to: beat.to, box: beat.box, style: beat.mark, space:"camera" })), ...edits.filter((edit) => edit.kind === "highlight")]
    .flatMap((entry) => stretches([entry], range, () => true))
    .map(({ start, duration, entry }) => ({ start: round(logo + start), duration: round(duration), box: entry.box, style: entry.style, space:entry.space??"screen" }));
  const cards = cut.cards.map((card) => ({ ...card, start: round(logo + card.start) }));
  // A retaken scene never leaves the app exactly as the old footage found it, so each join dips briefly.
  const joins = (take.joins ?? []).filter((t) => cut.kept(t) && t > begin && t < end).map((t) => ({ t, duration: 0.3 }));
  const transitions = [...edits.filter((edit) => edit.kind === "transition"), ...joins]
    .map((edit) => ({ t: round(logo + when(edit.t)), duration: edit.duration }))
    .sort((a, b) => a.t - b.t)
    // An authored transition at a join covers it already.
    .filter((dip, i, all) => !all.slice(0, i).some((other) => Math.abs(other.t - dip.t) < 0.5));
  const film = { logo, outro, sourceAudio: !!take.audio, ...filmSize(take.window), duration: logo + length, fps: take.fps ?? 30, pieces, shots, captions, keys, highlights, cards, transitions, cursor: pointer(take.beats, cut, logo), sounds: soundsOf(take.beats, cut, logo) };
  // The overlays are drawn from the plan in one place, so the preview and the export cannot disagree.
  film.html = overlayHtml(film);
  return film;
}
