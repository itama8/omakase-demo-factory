import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorAt,
  rangeFromTimeline,
  importCards,
  serializeCards,
  cardTimes,
  defaultEffect,
} from "../review/range-edits.js";
import { compileEdit } from "../src/edit.mjs";
import { planFilm } from "../src/film.mjs";
const spans = {
  first: { start: 0.5, end: 10.5 },
  second: { start: 10.5, end: 20.5 },
};
const beats = [
  { type: "start", t: 0.5 },
  ...Object.entries(spans).flatMap(([id, s]) => [
    { type: "span-start", id, t: s.start },
    { type: "span-end", id, t: s.end },
  ]),
  { type: "end", t: 20.5 },
];
const take = { beats, window: { width: 1680, height: 1000, scale: 2 } };
const initial = planFilm(take, [], { logo: 0, camera: "still" });
test("timeline range spans scene boundaries and stays anchored after a retake", () => {
  const range = rangeFromTimeline(initial, spans, 8, 13);
  assert.equal(range, "first@start+8s .. second@start+3s");
  assert.equal(anchorAt(spans, 10.5), "second@start");
  assert.equal(anchorAt(spans, 10.5, "end"), "first@end");
  const card = { range };
  assert.deepEqual(cardTimes(card, initial, spans), [8, 13]);
  assert.throws(() => rangeFromTimeline(initial, spans, 5, 4), /end/);
});
test("one card can combine effects, round-trip without duplication, and preserve untouched agent edits", () => {
  const untouched = {
    caption: "Keep agent caption",
    over: "first",
    position: "top",
  };
  const existing = importCards([untouched], spans);
  const card = {
    id: "manual-1",
    range: rangeFromTimeline(initial, spans, 2, 7),
    open: true,
    touched: true,
    effects: {
      caption: { ...defaultEffect("caption"), caption: "New caption" },
      speed: { speed: 2 },
      camera: defaultEffect("camera"),
    },
  };
  const edits = serializeCards([...existing, card], spans);
  assert.deepEqual(edits[0], untouched);
  const loaded = importCards(edits, spans);
  assert.equal(loaded.length, 2);
  assert.deepEqual(Object.keys(loaded[1].effects), [
    "caption",
    "speed",
    "camera",
  ]);
  assert.deepEqual(serializeCards(loaded, spans), edits);
  const plan = planFilm(take, compileEdit({ edits }, beats), {
    logo: 0,
    camera: "still",
  });
  assert.equal(plan.duration, 17.5);
  assert.deepEqual(
    plan.captions.find((c) => c.text === "New caption").box,
    card.effects.caption.box,
  );
  assert.match(
    plan.html.screen,
    /left:288px;top:890.8px;width:1344px;height:171.3px/,
  );
});
test("caption box validation rejects off-canvas geometry, and placement affects exported markup", () => {
  for (const box of [
    [-0.1, 0, 0.5, 0.1],
    [0.8, 0.8, 0.4, 0.4],
    [0, 0, 0, 0.1],
    [0, 0, NaN, 0.1],
  ])
    assert.throws(
      () =>
        compileEdit(
          { edits: [{ caption: "hello", box, over: "first" }] },
          beats,
        ),
      /caption box/,
    );
  assert.throws(
    () =>
      compileEdit(
        {
          edits: [
            { speed: 2, over: "first", review: { id: "x", collapsed: "yes" } },
          ],
        },
        beats,
      ),
    /review/,
  );
});
test("editing a combined range replaces its effects and keeps other cards intact", () => {
  const original = [
    { speed: 2, over: "first", review: { id: "a" } },
    {
      caption: "a",
      box: [0.1, 0.2, 0.4, 0.1],
      over: "first",
      review: { id: "a" },
    },
    { cut: "second@start+2s .. second@start+3s" },
  ];
  const cards = importCards(original, spans);
  cards[0].range = "first@start+1s .. second@start+1s";
  cards[0].touched = true;
  delete cards[0].effects.speed;
  const edits = serializeCards(cards, spans);
  assert.equal(edits.length, 2);
  assert.deepEqual(edits[1], original[2]);
  assert.equal(edits[0].over, cards[0].range);
});

test("unmarked AI effects over equivalent ranges become a normal combined card without changing authored entries", () => {
  const edits = [
    { caption: "AI caption", position: "top", over: "first" },
    { camera: { on: [0.5, 0.5], zoom: 2 }, over: "first@start .. first@end" },
    { speed: 2, over: "first@start+2s .. first@end" },
  ];
  const cards = importCards(edits, spans);
  assert.equal(cards.length, 2);
  assert.deepEqual(Object.keys(cards[0].effects), ["caption", "camera"]);
  assert.deepEqual(serializeCards(cards, spans), edits);
  cards[0].effects.caption.caption = "Manual adjustment";
  cards[0].touched = true;
  const saved = serializeCards(cards, spans);
  assert.equal(saved[0].caption, "Manual adjustment");
  assert.equal(saved[0].review.id, saved[1].review.id);
  assert.deepEqual(saved[2], edits[2]);
});
