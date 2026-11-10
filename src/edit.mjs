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
  const ranges = (doc?.edits ?? []).flatMap((entry) => [entry.cut, entry.over]).filter((value) => typeof value === "string");
  return [...new Set(ranges.flatMap((text) => text.split("..").map((part) => part.trim().match(/^[a-z0-9-]+(?:\/[a-z0-9-]+)?/)?.[0])).filter(Boolean))];
}

/** Read an edit file into ranges in take time. A missing file is an empty edit. */
export async function loadEdit(file, beats) {
  let doc;
  try { doc = parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return compileEdit(doc, beats, file);
}

/** Shared validation for agent-authored YAML and edits saved in the browser. */
export function compileEdit(doc, beats, file = "edit") {
  if (doc !== null && doc !== undefined && (typeof doc !== "object" || Array.isArray(doc))) throw new Error(`${file}: expected a mapping`);
  for (const key of Object.keys(doc ?? {})) if (key !== "edits") throw new Error(`${file}: unknown key ${key}`);
  const list = doc?.edits ?? [];
  if (!Array.isArray(list)) throw new Error(`${file}: "edits" must be a list`);
  const spans = spansOf(beats);
  return list.map((entry, index) => {
    const where = `${file}, edit ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${where}: expected an edit mapping`);
    const kinds = ["cut", "speed", "camera", "caption"].filter((key) => key in entry);
    if (kinds.length !== 1) throw new Error(`${where}: needs exactly one of cut, speed, camera, caption`);
    const allowed = new Set([kinds[0], ...(kinds[0] === "cut" ? [] : ["over"]), ...(kinds[0] === "caption" ? ["position"] : [])]);
    for (const key of Object.keys(entry)) if (!allowed.has(key)) throw new Error(`${where}: unknown argument ${key}`);
    if ("cut" in entry) return { kind: "cut", ...range(entry.cut, spans, where) };
    if ("speed" in entry) {
      if (typeof entry.speed !== "number" || !Number.isFinite(entry.speed) || !(entry.speed >= 0.1 && entry.speed <= 10)) throw new Error(`${where}: speed must be between 0.1 and 10; got ${entry.speed}`);
      return { kind: "speed", rate: entry.speed, ...range(entry.over, spans, where) };
    }
    if ("camera" in entry) return { kind: "camera", frame: frameOf(entry.camera, where), ...range(entry.over, spans, where) };
    if (typeof entry.caption !== "string" || entry.caption.length > 240) throw new Error(`${where}: caption must be text, at most 240 characters`);
    if (entry.position !== undefined && !["top", "bottom"].includes(entry.position)) throw new Error(`${where}: position must be top or bottom`);
    return { kind: "caption", text: entry.caption, position: entry.position ?? "bottom", ...range(entry.over, spans, where) };
  });
}

/**
 * Cut the take into the pieces that play, each { a, b, rate, at }: source
 * range, speed, and where it starts in the film. Returns the pieces, the
 * film's length, and `when(t)`, which maps take time to film time.
 */
export function assemble(edits, begin, end) {
  const marks = [...new Set([begin, end, ...edits.filter((edit) => ["cut", "speed"].includes(edit.kind)).flatMap((edit) => [edit.from, edit.to])])]
    .filter((t) => t >= begin && t <= end).sort((a, b) => a - b);
  const pieces = [];
  let at = 0;
  for (let index = 0; index < marks.length - 1; index++) {
    const a = marks[index], b = marks[index + 1], middle = (a + b) / 2;
    const covers = (edit) => edit.from <= middle && middle < edit.to;
    if (edits.some((edit) => edit.kind === "cut" && covers(edit))) continue;
    // A later speed edit wins over an earlier one on the same stretch.
    const rate = edits.findLast((edit) => edit.kind === "speed" && covers(edit))?.rate ?? 1;
    const last = pieces.at(-1);
    if (last && last.rate === rate && Math.abs(last.b - a) < 1e-6) last.b = b;
    else pieces.push({ a, b, rate, at });
    at += (b - a) / rate;
  }
  // Anything shorter than a frame cannot be shown.
  const kept = pieces.filter((piece) => (piece.b - piece.a) / piece.rate >= 1 / 30);
  let cursor = 0;
  for (const piece of kept) { piece.at = cursor; cursor += (piece.b - piece.a) / piece.rate; }
  const when = (t) => {
    for (const piece of kept) {
      if (t < piece.a) return piece.at;
      if (t <= piece.b) return piece.at + (t - piece.a) / piece.rate;
    }
    return cursor;
  };
  return { pieces: kept, length: cursor, when };
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
      if (active !== previous) result.push({ t, duration: Math.min(0.8, active.to - t), ease: "power3.inOut", frame: active.frame });
    } else if (previous) {
      result.push({ t, duration: 0.8, ease: "power3.inOut", frame: original.findLast((shot) => shot.t <= t)?.frame ?? WIDE });
    } else result.push(...original.filter((shot) => shot.t === t));
    previous = active;
  }
  return result;
}
