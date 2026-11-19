import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTime,
  parseTime,
  covering,
  pickEdit,
  nextEdge,
} from "../review/keyboard.js";
import {
  nudgeRange,
  resolveRange,
  defaultEffect,
} from "../review/range-edits.js";
import { compileEdit } from "../src/edit.mjs";

test("times read and write as minutes:seconds", () => {
  assert.equal(formatTime(65.4), "1:05.40");
  assert.equal(formatTime(59.999), "1:00.00");
  assert.equal(formatTime(3.25), "0:03.25");
  assert.equal(parseTime("1:05.4"), 65.4);
  assert.equal(parseTime("1:05"), 65);
  assert.equal(parseTime("65.4"), 65.4);
  assert.equal(parseTime(".5s"), 0.5);
  assert.ok(Number.isNaN(parseTime("1:75")));
  assert.ok(Number.isNaN(parseTime("soon")));
  assert.equal(parseTime(formatTime(123.45)), 123.45);
});

const windows = [
  { id: "wide", start: 2, end: 10, lane: 0 },
  { id: "zoom", start: 4, end: 6, lane: 1 },
  { id: "later", start: 12, end: 14, lane: 0 },
];
test("Ctrl+Up/Down cycles the stacked edits under the playhead, then jumps to the next", () => {
  assert.deepEqual(covering(windows, 5).map((w) => w.id), ["wide", "zoom"]);
  assert.deepEqual(pickEdit(windows, 5, null, 1), { id: "wide" });
  assert.deepEqual(pickEdit(windows, 5, "wide", 1), { id: "zoom" });
  assert.deepEqual(pickEdit(windows, 5, "zoom", 1), { id: "wide" });
  assert.deepEqual(pickEdit(windows, 5, "wide", -1), { id: "zoom" });
  assert.deepEqual(pickEdit(windows, 11, null, 1), { id: "later", seek: 12 });
  assert.deepEqual(pickEdit(windows, 11, null, -1), { id: "zoom", seek: 4 });
  assert.equal(pickEdit(windows, 15, null, 1), null);
  assert.equal(nextEdge(windows, 5, 1), 6);
  assert.equal(nextEdge(windows, 5, -1), 4);
});

const spans = {
  first: { start: 0.5, end: 10.5 },
  second: { start: 10.5, end: 20.5 },
};
test("keyboard nudges move one edge in recorded time and stay inside the take", () => {
  const card = { range: "first@start+2s .. first@start+4s", effects: { caption: {} } };
  const end = nudgeRange(card, spans, "end", 0.1);
  assert.deepEqual(resolveRange(end.range, spans).map((n) => +n.toFixed(4)), [2.5, 4.6]);
  const start = nudgeRange(card, spans, "start", -0.1);
  assert.deepEqual(resolveRange(start.range, spans).map((n) => +n.toFixed(4)), [2.4, 4.5]);
  // Crossing a scene boundary re-anchors to the next scene.
  assert.match(nudgeRange(card, spans, "end", 8).range, /second@start\+2s$/);
  // The start cannot pass the end, nor the take's first frame.
  const [a, b] = resolveRange(nudgeRange(card, spans, "start", 5).range, spans);
  assert.ok(b - a >= 0.04 - 1e-9);
  assert.equal(resolveRange(nudgeRange(card, spans, "start", -9).range, spans)[0], 0.5);
});

test("a lone title card's end changes how long it holds", () => {
  const card = { range: "first@start+2s .. first@start+2.1s", effects: { card: { card: "Hi", for: 2.2 } } };
  assert.deepEqual(nudgeRange(card, spans, "end", 0.1), { range: card.range, for: 2.3 });
  assert.equal(nudgeRange(card, spans, "end", -5).for, 0.2);
});

test("a zoom added in the browser eases in instead of cutting", () => {
  const zoom = defaultEffect("camera");
  assert.equal(zoom.for, 0.8);
  const beats = Object.entries(spans).flatMap(([id, s]) => [
    { type: "span-start", id, t: s.start },
    { type: "span-end", id, t: s.end },
  ]);
  const [compiled] = compileEdit({ edits: [{ ...zoom, over: "first" }] }, beats);
  assert.equal(compiled.duration, 0.8);
  assert.equal(compiled.ease, "power3.inOut");
});
