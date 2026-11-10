import test from "node:test";
import assert from "node:assert/strict";
import { timelineSpans } from "../review/timeline.js";

test("scene and step positions follow the edited film, including intro, speed, and cuts", () => {
  const spans = {
    study: { start: 0, end: 10 },
    "study/type": { start: 0, end: 6 },
    "study/pause": { start: 6, end: 10 },
    chart: { start: 10, end: 14 },
    "chart/type": { start: 10, end: 14 },
  };
  const film = {
    logo: 2,
    duration: 11,
    pieces: [
      { a: 0, b: 6, rate: 2, at: 0 },
      { a: 8, b: 10, rate: 1, at: 3 },
      { a: 10, b: 14, rate: 1, at: 5 },
    ],
  };
  const result = timelineSpans(spans, film);
  assert.deepEqual(result.scenes, [
    { id: "study", start: 2, end: 7 },
    { id: "chart", start: 7, end: 11 },
  ]);
  assert.deepEqual(
    result.steps.find((s) => s.id === "study/type"),
    { id: "study/type", start: 2, end: 5 },
  );
  assert.deepEqual(
    result.steps.find((s) => s.id === "study/pause"),
    { id: "study/pause", start: 5, end: 7 },
  );
});
test("short steps at the same point form a menu and removed scenes/steps disappear", () => {
  const spans = {
    study: { start: 0, end: 5 },
    "study/caret": { start: 0, end: 0.003 },
    "study/focus": { start: 0.003, end: 0.003 },
    "study/type": { start: 0.003, end: 5 },
    removed: { start: 5, end: 7 },
    "removed/type": { start: 5, end: 7 },
    "removed/focus": { start: 6, end: 6 },
    end: { start: 7, end: 8 },
  };
  const film = {
    logo: 0,
    duration: 6,
    pieces: [
      { a: 0, b: 5, rate: 1, at: 0 },
      { a: 7, b: 8, rate: 1, at: 5 },
    ],
  };
  const result = timelineSpans(spans, film);
  assert.deepEqual(
    result.scenes.map((s) => s.id),
    ["study", "end"],
  );
  assert.equal(result.markers.length, 1);
  assert.deepEqual(
    result.markers[0].entries.map((s) => s.id),
    ["study/caret", "study/focus"],
  );
  assert.deepEqual(
    result.steps.map((s) => s.id),
    ["study/type"],
  );
});
