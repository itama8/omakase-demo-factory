// The edit: changes laid over a take after it is recorded.
//
// An edit never names a second. It names a span of the screenplay, so it
// still means the same thing after the demo is recorded again:
//
//   hello                      the whole scene "hello"
//   hello/type                 the step "type" in that scene
//   hello/type@start+1.5s      a point: an end of a span, plus or minus an offset
//   hello/type@start+1s .. hello/type@end-0.5s     a range between two points
//
// A bare span used as a range means its start to its end.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { WIDE } from "./director.mjs";
import { seconds } from "./screenplay.mjs";

/** Every span in a take, as { id: { start, end } } in take time. */
export function spansOf(beats) {
  const spans = {};
  for (const beat of beats) {
    if (beat.type === "span-start") spans[beat.id] = { start: beat.t, end: beat.t };
    if (beat.type === "span-end" && spans[beat.id]) spans[beat.id].end = beat.t;
  }
  return spans;
}

function point(text, spans, edge, where) {
  const match = String(text).trim().match(/^([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:@(start|end))?(?:\s*([+-])\s*(\d+(?:\.\d+)?(?:ms|s)))?$/);
  if (!match) throw new Error(`${where}: cannot read "${text}". Write a span such as scene/step, optionally with @start or @end and an offset such as +0.5s`);
  const [, id, at = edge, sign, offset] = match;
  if (!spans[id]) throw new Error(`${where}: the take has no span "${id}". It has: ${Object.keys(spans).join(", ")}`);
  return spans[id][at] + (offset ? seconds(offset) * (sign === "-" ? -1 : 1) : 0);
}

function range(text, spans, where) {
  if (text === undefined || text === null) throw new Error(`${where}: needs a range, such as "over: scene/step"`);
  const parts = String(text).split("..");
  if (parts.length > 2) throw new Error(`${where}: a range has one ".."; got "${text}"`);
  const from = point(parts[0], spans, "start", where);
  const to = point(parts.at(-1), spans, "end", where);
  if (!(to > from)) throw new Error(`${where}: "${text}" ends before it starts (${from.toFixed(2)}s to ${to.toFixed(2)}s)`);
  return { from, to };
}

function frameOf(value, where) {
  if (value === "wide") return WIDE;
  if (value && typeof value === "object" && Array.isArray(value.on) && value.on.length === 2) {
    const [x, y] = value.on.map(Number), zoom = Number(value.zoom ?? 1.4);
    if ([x, y, zoom].every(Number.isFinite) && x >= 0 && x <= 1 && y >= 0 && y <= 1 && zoom >= 1 && zoom <= 4) return { x, y, zoom };
  }
  throw new Error(`${where}: camera must be "wide" or { on: [x, y], zoom: n } with x and y as fractions of the window`);
}

/** Every span id an edit file names, without needing a take. */
export async function editSpans(file) {
  let doc;
  try { doc = parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const ranges = (doc?.edits ?? []).flatMap((entry) => [entry.cut, entry.over, entry.at, entry.review?.range]).filter((value) => typeof value === "string");
  return [...new Set(ranges.flatMap((text) => text.split("..").map((part) => part.trim().match(/^[a-z0-9-]+(?:\/[a-z0-9-]+)?/)?.[0])).filter(Boolean))];
}

/** Read an edit file into ranges in take time. A missing file is an empty edit. */
export async function loadEdit(file, beats) {
  let doc;
  try { doc = parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return compileEdit(doc, beats, file);
}

const KINDS = {
  cut: [],
  speed: ["over"],
  camera: ["over", "for", "ease"],
  caption: ["over", "position", "box"],
  card: ["at", "for", "subtitle"],
  highlight: ["over", "style", "space"],
  keys: ["over", "position", "box"],
  transition: ["at", "for"]
};

/** Shared validation for agent-authored YAML and edits saved in the browser. */
export function compileEdit(doc, beats, file = "edit") {
  if (doc !== null && doc !== undefined && (typeof doc !== "object" || Array.isArray(doc))) throw new Error(`${file}: expected a mapping`);
  for (const key of Object.keys(doc ?? {})) if (!["edits","recordedEdits"].includes(key)) throw new Error(`${file}: unknown key ${key}`);
  if(doc?.recordedEdits!==undefined&&typeof doc.recordedEdits!=='boolean')throw new Error(`${file}: recordedEdits must be a boolean`);
  const list = doc?.edits ?? [];
  if (!Array.isArray(list)) throw new Error(`${file}: "edits" must be a list`);
  const spans = spansOf(beats);
  const compiled = list.map((entry, index) => {
    const where = `${file}, edit ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${where}: expected an edit mapping`);
    const kinds = Object.keys(KINDS).filter((key) => key in entry);
    if (kinds.length !== 1) throw new Error(`${where}: needs exactly one of ${Object.keys(KINDS).join(", ")}`);
    const [kind] = kinds;
    for (const key of Object.keys(entry)) if (key !== kind && key !== "review" && !KINDS[kind].includes(key)) throw new Error(`${where}: unknown argument ${key}`);
    if (entry.review !== undefined && (typeof entry.review !== "object" || entry.review === null || Array.isArray(entry.review) || typeof entry.review.id !== "string" || !/^[\w-]{1,100}$/.test(entry.review.id) || Object.keys(entry.review).some((key) => !["id", "collapsed", "range"].includes(key)) || (entry.review.collapsed !== undefined && typeof entry.review.collapsed !== "boolean"))) throw new Error(`${where}: review needs an id and optional collapsed boolean`);
    if(entry.review?.range!==undefined){if(typeof entry.review.range!=="string")throw new Error(`${where}: review range must be text`);range(entry.review.range,spans,where);}
    const position = (fallback) => {
      if (entry.position !== undefined && !["top", "bottom"].includes(entry.position)) throw new Error(`${where}: position must be top or bottom`);
      return entry.position ?? fallback;
    };
    const text = (value, what, most) => {
      if (typeof value !== "string" || value.length > most) throw new Error(`${where}: ${what} must be text, at most ${most} characters`);
      return value;
    };
    // A moment in the take, and how long the film dwells on it.
    const moment = (fallback, most) => {
      if (entry.at === undefined || entry.at === null) throw new Error(`${where}: needs a point, such as "at: scene@start"`);
      const duration = entry.for === undefined ? fallback : seconds(entry.for, `${where}: for`);
      if (!(duration >= 0.2 && duration <= most)) throw new Error(`${where}: "for" must be between 0.2s and ${most}s`);
      return { t: point(entry.at, spans, "start", where), duration };
    };
    if (kind === "cut") return { kind, ...range(entry.cut, spans, where) };
    if (kind === "speed") {
      if (typeof entry.speed !== "number" || !Number.isFinite(entry.speed) || !(entry.speed >= 0.1 && entry.speed <= 10)) throw new Error(`${where}: speed must be between 0.1 and 10; got ${entry.speed}`);
      return { kind, rate: entry.speed, ...range(entry.over, spans, where) };
    }
    if (kind === "camera") {
      const duration=entry.for===undefined?.8:seconds(entry.for,`${where}: for`);
      if(!Number.isFinite(duration)||duration<=0||duration>30)throw new Error(`${where}: zoom duration must be between 0 and 30s`);
      if(entry.ease!==undefined&&!['none','power1.inOut','power2.inOut','power3.inOut','power4.inOut'].includes(entry.ease))throw new Error(`${where}: unsupported zoom easing`);
      return { kind, frame: frameOf(entry.camera, where),duration,ease:entry.ease??'power3.inOut',...range(entry.over, spans, where) };
    }
    if (kind === "caption") {
      const box = entry.box;
      if (box !== undefined && (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1.0001 || box[1] + box[3] > 1.0001)) throw new Error(`${where}: caption box must be [x, y, width, height] within the picture`);
      return { kind, text: text(entry.caption, "caption", 240), position: position("bottom"), ...(box ? { box } : {}), ...range(entry.over, spans, where) };
    }
    if (kind === "card") {
      if (!entry.card) throw new Error(`${where}: a card needs its text`);
      return { kind, text: text(entry.card, "card", 80), subtitle: entry.subtitle === undefined ? "" : text(entry.subtitle, "subtitle", 160), ...moment(2.2, 10) };
    }
    if (kind === "highlight") {
      const box = Array.isArray(entry.highlight) && entry.highlight.length === 4 ? entry.highlight.map(Number) : null;
      if (!box || !box.every(Number.isFinite) || box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1.0001 || box[1] + box[3] > 1.0001) throw new Error(`${where}: highlight must be [x, y, width, height] as fractions of the window`);
      if (entry.style !== undefined && !["ring", "spotlight"].includes(entry.style)) throw new Error(`${where}: style must be ring or spotlight`);
      if(entry.space!==undefined&&!['screen','camera'].includes(entry.space))throw new Error(`${where}: highlight space must be screen or camera`);
      return { kind, box: { x: box[0], y: box[1], w: box[2], h: box[3] },space:entry.space??'screen', style: entry.style ?? "ring", ...range(entry.over, spans, where) };
    }
    if (kind === "keys") {
      if (!entry.keys) throw new Error(`${where}: keys needs a combination such as Ctrl+K`);
      const box=entry.box;
      if(box!==undefined&&(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<0||box[1]<0||box[2]<=0||box[3]<=0||box[0]+box[2]>1.0001||box[1]+box[3]>1.0001))throw new Error(`${where}: key box must fit inside the picture`);
      return { kind, label: text(entry.keys, "keys", 40), position: position("bottom"),...(box?{box}:{}), ...range(entry.over, spans, where) };
    }
    if (entry.transition !== "dip") throw new Error(`${where}: transition must be dip`);
    return { kind, ...moment(0.5, 2) };
  });
  Object.defineProperty(compiled,'recordedEdits',{value:doc?.recordedEdits!==false});
  return compiled;
}

/**
 * Cut the take into the pieces that play, each { a, b, rate, at }: source
 * range, speed, and where it starts in the film. A card holds the film at its
 * moment, so the pieces after it start later. Returns the pieces, the cards
 * with their film times, the film's length, and `when(t)`, which maps take
 * time to film time.
 */
export function assemble(edits, begin, end) {
  const holds = edits.filter((edit) => edit.kind === "card").map((edit) => ({ ...edit, t: Math.min(end, Math.max(begin, edit.t)) }));
  const marks = [...new Set([begin, end, ...holds.map((hold) => hold.t), ...edits.filter((edit) => ["cut", "speed"].includes(edit.kind)).flatMap((edit) => [edit.from, edit.to])])]
    .filter((t) => t >= begin && t <= end).sort((a, b) => a - b);
  // Pieces and holds in film order. Times are assigned once the pieces too short to show are gone.
  const sequence = [];
  for (let index = 0; index < marks.length; index++) {
    const a = marks[index], b = marks[index + 1];
    for (const hold of holds) if (hold.t === a) sequence.push({ hold });
    if (b === undefined) break;
    const middle = (a + b) / 2;
    const covers = (edit) => edit.from <= middle && middle < edit.to;
    if (edits.some((edit) => edit.kind === "cut" && covers(edit))) continue;
    // A later speed edit wins over an earlier one on the same stretch.
    const rate = edits.findLast((edit) => edit.kind === "speed" && covers(edit))?.rate ?? 1;
    const last = sequence.at(-1);
    if (last && !last.hold && last.rate === rate && Math.abs(last.b - a) < 1e-6) last.b = b;
    else sequence.push({ a, b, rate });
  }
  const pieces = [], cards = [];
  let cursor = 0;
  for (const entry of sequence) {
    if (entry.hold) {
      cards.push({ start: cursor, source:entry.hold.t, duration: entry.hold.duration, text: entry.hold.text, subtitle: entry.hold.subtitle });
      cursor += entry.hold.duration;
      continue;
    }
    const length = (entry.b - entry.a) / entry.rate;
    // Anything shorter than a frame cannot be shown.
    if (length < 1 / 30) continue;
    pieces.push({ ...entry, at: cursor });
    cursor += length;
  }
  const when = (t) => {
    for (const piece of pieces) {
      if (t < piece.a) return piece.at;
      if (t <= piece.b) return piece.at + (t - piece.a) / piece.rate;
    }
    return pieces.length ? pieces.at(-1).at + (pieces.at(-1).b - pieces.at(-1).a) / pieces.at(-1).rate : 0;
  };
  /** Whether take time `t` survives the cuts. */
  const kept = (t) => pieces.some((piece) => piece.a <= t && t <= piece.b);
  return { pieces, cards, length: cursor, when, kept };
}

/** Replace the director's shots inside each camera edit with the framing it asks for. */
export function reframe(shots, edits) {
  const cameras = edits.filter((entry) => entry.kind === "camera");
  if (!cameras.length) return [...shots].sort((a, b) => a.t - b.t);
  const original = [...shots].sort((a, b) => a.t - b.t);
  const marks = [...new Set([...original.map((shot) => shot.t), ...cameras.flatMap((edit) => [edit.from, edit.to])])].sort((a, b) => a - b);
  const result = [];
  let previous;
  for (const t of marks) {
    const active = cameras.findLast((edit) => edit.from <= t && t < edit.to);
    if (active) {
      if (active !== previous) result.push({ t, duration: Math.min(active.duration??0.8, active.to - t), ease: active.ease??"power3.inOut", frame: active.frame });
    } else if (previous) {
      result.push({ t, duration: 0.8, ease: "power3.inOut", frame: original.findLast((shot) => shot.t <= t)?.frame ?? WIDE });
    } else result.push(...original.filter((shot) => shot.t === t));
    previous = active;
  }
  return result;
}
