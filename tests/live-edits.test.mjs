import test from "node:test";
import assert from "node:assert/strict";
import { snapWindow } from "../review/snapping.js";
import { editableDocument } from "../src/recorded-edits.mjs";
import { compileEdit } from "../src/edit.mjs";
import { planFilm } from "../src/film.mjs";
import {
  importCards,
  serializeCards,
  cardTimes,
  effectSeconds,
  moveRange,
} from "../review/range-edits.js";
const take = {
  window: { width: 1280, height: 720, scale: 2 },
  beats: [
    { type: "start", t: 0.5 },
    { type: "span-start", id: "clip", t: 0.5 },
    { type: "modal", t: 0.8, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.2 } },
    {
      type: "focus",
      t: 2,
      caption: "Recorded caption",
      box: { x: 0.2, y: 0.3, w: 0.2, h: 0.1 },
      mark: "ring",
    },
    { type: "span-end", id: "clip", t: 8.5 },
    { type: "end", t: 8.5 },
  ],
};
test("magnetic edges snap, retain their catch near the target, and release into overlap on further drag", () => {
  const a = snapWindow(2.04, 3.04, { targets: [2], pixel: 0.01 });
  assert.equal(a.start, 2);
  assert.equal(a.end, 3);
  const b = snapWindow(1.9, 2.9, { targets: [2], pixel: 0.01, lock: a.lock });
  assert.equal(b.start, 2);
  const c = snapWindow(1.8, 2.8, { targets: [2], pixel: 0.01, lock: b.lock });
  assert.equal(c.start, 1.8);
  const d = snapWindow(2.03, 3.03, { targets: [2], pixel: 0.01, bypass: true });
  assert.equal(d.start, 2.03);
  const e = snapWindow(0, 1.98, {
    targets: [2],
    pixel: 0.01,
    mode: "resize",
    edge: "end",
  });
  assert.equal(e.end, 2);
  assert.equal(e.start, 0);
});
test("recorded framing and captions become ordinary editable effects while preserving the film", () => {
  const raw = { edits: [] },
    explicit = editableDocument(take, raw);
  assert.ok(explicit.edits.some((e) => "camera" in e));
  assert.ok(explicit.edits.some((e) => "caption" in e));
  const a = planFilm(take, compileEdit(raw, take.beats)),
    b = planFilm(take, compileEdit(explicit, take.beats));
  assert.deepEqual(b.shots, a.shots);
  assert.deepEqual(b.captions, a.captions);
  assert.deepEqual(b.highlights, a.highlights);
  assert.equal(b.duration, a.duration);
  const zoom = explicit.edits.findIndex((e) => "camera" in e);
  explicit.edits.splice(zoom, 1);
  const removed = planFilm(take, compileEdit(explicit, take.beats));
  assert.equal(
    removed.shots.some(
      (s) => s.t === a.shots[0].t && s.frame.zoom === a.shots[0].frame.zoom,
    ),
    false,
  );
});
test("screen highlights and manually placed keys use screen geometry even when the footage is zoomed", () => {
  const e = {
    recordedEdits: false,
    edits: [
      { camera: { on: [0.5, 0.5], zoom: 2 }, over: "clip" },
      { highlight: [0.2, 0.3, 0.4, 0.2], over: "clip" },
      { keys: "Ctrl+K", box: [0.1, 0.2, 0.3, 0.15], over: "clip" },
    ],
  };
  const film = planFilm(take, compileEdit(e, take.beats));
  assert.match(film.html.screen, /id="highlight-0"/);
  assert.doesNotMatch(film.html.camera, /id="highlight-0"/);
  assert.match(
    film.html.screen,
    /left:384px;top:324px;width:768px;height:216px/,
  );
  assert.deepEqual(film.keys[0].box, [0.1, 0.2, 0.3, 0.15]);
});
test("title duration is independent of its source range and creates a real gap in video and original audio", () => {
  const e = {
    recordedEdits: false,
    edits: [{ card: "Pause here", at: "clip@start+2s", for: "3s" }],
  };
  const film = planFilm(take, compileEdit(e, take.beats), { logo: 0 });
  const spans = { clip: { start: 0.5, end: 8.5 } };
  const cards = importCards(e.edits, spans);
  assert.deepEqual(cardTimes(cards[0], film, spans), [2, 5]);
  assert.equal(
    film.pieces.some((p) => p.at < 3 && p.at + (p.b - p.a) / p.rate > 3),
    false,
  );
  assert.equal(film.pieces.find((p) => p.at === 5).a, 2.5);
  cards[0].touched = true;
  cards[0].effects.card.for = 4;
  const saved = serializeCards(cards, spans);
  assert.equal(effectSeconds(saved[0].for), 4);
});

test("a title with independent duration stays grouped with other effects after reload", () => {
  const spans = { clip: { start: 0.5, end: 8.5 } };
  const card = {
    id: "combined",
    range: "clip@start+1s .. clip@start+2s",
    open: true,
    touched: true,
    effects: { caption: { caption: "Here" }, card: { card: "Title", for: 4 } },
  };
  const edits = serializeCards([card], spans);
  const restored = importCards(edits, spans);
  assert.equal(restored.length, 1);
  assert.deepEqual(Object.keys(restored[0].effects), ["caption", "card"]);
  assert.equal(effectSeconds(restored[0].effects.card.for), 4);
  assert.equal(restored[0].range, card.range);
  assert.doesNotThrow(() =>
    compileEdit({ recordedEdits: false, edits }, take.beats),
  );
});

test("agent range changes stay authoritative even when an old grouping marker remains", () => {
  const spans = { clip: { start: 0.5, end: 8.5 } };
  const edits = [
    {
      caption: "Moved by AI",
      over: "clip@start+3s .. clip@start+4s",
      review: { id: "a", range: "clip@start+1s .. clip@start+2s" },
    },
    {
      card: "Moved title",
      at: "clip@start+4s",
      for: "3s",
      review: { id: "b", range: "clip@start+1s .. clip@start+2s" },
    },
  ];
  const cards = importCards(edits, spans);
  assert.equal(cards[0].range, edits[0].over);
  assert.equal(cards[1].range, "clip@start+4s .. clip@start+5s");
});

test("a mixed title and caption window can move through its own inserted hold", () => {
  const spans = { clip: { start: 0.5, end: 8.5 } };
  const card = {
    id: "mixed",
    range: "clip@start+1s .. clip@start+2s",
    open: true,
    touched: true,
    effects: { caption: { caption: "Text" }, card: { card: "Title", for: 3 } },
  };
  const film = planFilm(
    take,
    compileEdit(
      { recordedEdits: false, edits: serializeCards([card], spans) },
      take.beats,
    ),
    { logo: 0 },
  );
  assert.deepEqual(cardTimes(card, film, spans), [1, 5]);
  assert.equal(
    moveRange(card, film, spans, 2, 6),
    "clip@start+2s .. clip@start+3s",
  );
});
