import test from "node:test";
import assert from "node:assert/strict";
import { assemble, compileEdit, reframe } from "../src/edit.mjs";
import { planFilm } from "../src/film.mjs";

export const take = { beats: [
  { type: "start", t: 0 }, { type: "span-start", id: "study", t: 0 },
  { type: "focus", t: 0, caption: "Original", position: "top", box: null },
  { type: "span-start", id: "study/type", t: 1 }, { type: "span-end", id: "study/type", t: 5 },
  { type: "span-end", id: "study", t: 10 }, { type: "end", t: 10 }
] };

test("edits map cuts, speed, captions and camera onto the same film time", () => {
  const edits = compileEdit({ edits: [
    { cut: "study@start .. study@start+2s" },
    { speed: 2, over: "study@start+2s .. study@start+6s" },
    { caption: "New caption", over: "study@start+2s .. study@start+6s" },
    { caption: "", over: "study@start+6s .. study@start+8s" },
    { camera: { on: [0.25, 0.3], zoom: 2 }, over: "study/type" }
  ] }, take.beats);
  const film = planFilm(take, edits, { logo: 0 });
  assert.equal(film.duration, 6);
  assert.deepEqual(film.pieces, [{ a: 2, b: 6, rate: 2, at: 0 }, { a: 6, b: 10, rate: 1, at: 2 }]);
  assert.deepEqual(film.captions, [
    { start: 0, duration: 2, text: "New caption", position: "bottom" },
    { start: 4, duration: 2, text: "Original", position: "top" }
  ]);
  assert.ok(film.shots.some((shot) => shot.frame.zoom === 2));
});

test("camera overrides restore the underlying director and obey overlap precedence", () => {
  const wide = { x: 0.5, y: 0.5, zoom: 1 }, close = { x: 0.3, y: 0.3, zoom: 2 }, detail = { x: 0.7, y: 0.7, zoom: 3 };
  const shots = reframe([{ t: 0, duration: 1, frame: wide }, { t: 3, duration: 1, frame: detail }], [
    { kind: "camera", from: 1, to: 5, frame: close }, { kind: "camera", from: 2, to: 4, frame: wide }
  ]);
  assert.deepEqual(shots.map(({ t, frame }) => [t, frame]), [[0, wide], [1, close], [2, wide], [4, close], [5, detail]]);
});

test("reject invalid edits and refuse a cut that removes the entire take", () => {
  for (const edit of [
    { speed: "2", over: "study" }, { speed: NaN, over: "study" }, { speed: 11, over: "study" },
    { camera: { on: [Infinity, 0], zoom: 1 }, over: "study" }, { camera: { on: [0, 0], zoom: 0 }, over: "study" },
    { caption: "text", position: "middle", over: "study" }, { caption: {}, over: "study" },
    { cut: "missing" }, { cut: "study", speed: 2 }, { speed: 2, over: "study", typo: true }, null
  ]) assert.throws(() => compileEdit({ edits: [edit] }, take.beats));
  assert.throws(() => planFilm(take, compileEdit({ edits: [{ cut: "study" }] }, take.beats)), /whole take/);
});

test("later speed overrides only its range, including inside an existing speed edit", () => {
  const { pieces, length, when } = assemble([
    { kind: "speed", from: 0, to: 10, rate: 2 }, { kind: "speed", from: 2, to: 6, rate: 1 }
  ], 0, 10);
  assert.equal(length, 7); assert.equal(when(6), 5); assert.equal(pieces.length, 3);
});
