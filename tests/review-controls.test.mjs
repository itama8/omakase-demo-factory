import test from "node:test";
import assert from "node:assert/strict";
import { editMoment, settingsFor, filmTime, retime } from "../review/edits.js";

test("preview edits retain the recorded frame through speed changes and cuts", () => {
  const before = {
    logo: 2,
    duration: 22,
    pieces: [{ a: 0, b: 20, at: 0, rate: 1 }],
  };
  const after = {
    logo: 2,
    duration: 9,
    pieces: [
      { a: 2, b: 10, at: 0, rate: 2 },
      { a: 14, b: 20, at: 4, rate: 2 },
    ],
  };
  assert.equal(retime(before, after, 1), 1); // intro stays in place
  assert.equal(retime(before, after, 8), 4); // same source frame, new speed
  assert.equal(retime(before, after, 14), 6); // removed frame goes to next kept frame
  assert.equal(retime(after, before, 7), 18); // discard restores source position
});

test("changing a saved caption or framing replaces it, preserving other moments and partial agent edits", () => {
  const edits = [
    { caption: "Old", over: "table@start .. table@end" },
    { camera: { on: [0.5, 0.5], zoom: 2 }, over: "table" },
    { speed: 2, over: "table@start+1s .. table@end" },
    { caption: "Keep me", over: "chart" },
  ];
  const values = settingsFor(edits, "table", 10);
  assert.equal(values.caption, "Old");
  assert.equal(values.camera.zoom, 2);
  values.caption = "New";
  values.camera = { on: [0.2, 0.3], zoom: 1.5 };
  const result = editMoment(
    edits,
    "table",
    10,
    values,
    new Set(["caption", "camera"]),
  );
  assert.equal(result.length, 4);
  assert.deepEqual(result.slice(0, 2), edits.slice(2));
  assert.equal(
    result.filter((e) => "caption" in e && e.over.startsWith("table")).length,
    1,
  );
  assert.deepEqual(
    editMoment(result, "table", 10, values, new Set(["caption", "camera"])),
    result,
  );
});
test("keep from/until controls round-trip and repeated trims replace previous cuts", () => {
  const settings = {
    start: 2,
    end: 8,
    speed: "",
    caption: null,
    camera: null,
    removed: false,
  };
  const edits = editMoment([], "table", 10, settings, new Set(["trim"]));
  assert.deepEqual(settingsFor(edits, "table", 10), {
    ...settings,
    position: "bottom",
  });
  assert.deepEqual(
    editMoment(
      edits,
      "table",
      10,
      { ...settings, start: 0, end: 10 },
      new Set(["trim"]),
    ),
    [],
  );
  assert.throws(
    () =>
      editMoment(
        [],
        "table",
        10,
        { ...settings, start: 8, end: 2 },
        new Set(["trim"]),
      ),
    /Keep a range/,
  );
});
test("automatic framing clears only this moment and removing/unremoving restores its range", () => {
  const values = {
    start: 0,
    end: 10,
    speed: "",
    caption: null,
    camera: null,
    removed: true,
  };
  const cut = editMoment(
    [
      { camera: "wide", over: "table" },
      { camera: "wide", over: "chart" },
    ],
    "table",
    10,
    values,
    new Set(["camera", "trim"]),
  );
  assert.deepEqual(cut, [{ camera: "wide", over: "chart" }, { cut: "table" }]);
  assert.deepEqual(
    editMoment(
      cut,
      "table",
      10,
      { ...values, removed: false },
      new Set(["trim"]),
    ),
    [{ camera: "wide", over: "chart" }],
  );
});
test("moment playback maps its start/end through speed changes and cuts", () => {
  const film = {
    logo: 2.6,
    duration: 7.6,
    pieces: [
      { a: 2, b: 6, rate: 2, at: 0 },
      { a: 8, b: 11, rate: 1, at: 2 },
    ],
  };
  assert.equal(filmTime(film, 0), 2.6);
  assert.equal(filmTime(film, 4), 3.6);
  assert.equal(filmTime(film, 7), 4.6);
  assert.equal(filmTime(film, 11), 7.6);
});
test("displayed millisecond precision does not create phantom trims or reject a valid caption edit", () => {
  const settings = {
    start: 0,
    end: 16.629,
    caption: "Readable",
    position: "bottom",
  };
  assert.deepEqual(
    editMoment(
      [],
      "study",
      16.628999999999998,
      settings,
      new Set(["trim", "caption"]),
    ),
    [
      {
        caption: "Readable",
        position: "bottom",
        over: "study@start .. study@end",
      },
    ],
  );
});
