import test from "node:test";
import assert from "node:assert/strict";
import { assemble, compileEdit } from "../src/edit.mjs";
import { planFilm } from "../src/film.mjs";
import { mixSounds } from "../src/sound.mjs";

const take = { fps: 60, beats: [
  { type: "start", t: 0 }, { type: "span-start", id: "a", t: 0 },
  { type: "span-start", id: "a/click", t: 1 },
  { type: "pointer", t: 1, x: 0.2, y: 0.3 }, { type: "click", t: 1.5, x: 0.2, y: 0.3 },
  { type: "span-end", id: "a/click", t: 2 },
  { type: "key", t: 3 }, { type: "key", t: 3.01 }, { type: "key", t: 3.2 },
  { type: "focus", t: 4, caption: "", mark: "ring", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
  { type: "span-end", id: "a", t: 5 },
  { type: "span-start", id: "b", t: 5 }, { type: "click", t: 9, x: 0.6, y: 0.6 }, { type: "span-end", id: "b", t: 10 },
  { type: "end", t: 10 }
] };

test("a card holds the film without consuming footage, and later times move past it", () => {
  const edits = compileEdit({ edits: [{ card: "Hello", subtitle: "Sub", at: "b@start", for: "2s" }] }, take.beats);
  const { pieces, cards, length, when } = assemble(edits, 0, 10);
  assert.deepEqual(pieces.map(({ a, b, at }) => [a, b, at]), [[0, 5, 0], [5, 10, 7]]);
  assert.deepEqual(cards, [{ start: 5, source: 5, duration: 2, text: "Hello", subtitle: "Sub" }]);
  assert.equal(length, 12);
  assert.equal(when(6), 8);
});

test("a cut card disappears with nothing, a card at the very end extends the film", () => {
  const edits = compileEdit({ edits: [{ card: "Fin", at: "b@end" }] }, take.beats);
  const film = planFilm(take, edits, { logo: 1 });
  assert.equal(film.duration, 1 + 10 + 2.2);
  assert.equal(film.cards[0].start, 11);
});

test("highlights, keys and transitions land in film time and their markup is escaped", () => {
  const edits = compileEdit({ edits: [
    { cut: "a/click" },
    { highlight: [0.5, 0.5, 0.25, 0.25], style: "spotlight", over: "b" },
    { keys: "Ctrl+<K>", over: "b@start .. b@start+1s", position: "top" },
    { transition: "dip", at: "b@start" }
  ] }, take.beats);
  const film = planFilm(take, edits, { logo: 0 });
  assert.equal(film.duration, 9);
  assert.deepEqual(film.keys, [{ start: 4, duration: 1, label: "Ctrl+<K>", position: "top" }]);
  assert.deepEqual(film.transitions, [{ t: 4, duration: 0.5 }]);
  // The focus mark from the take holds until the end, beside the edit's spotlight.
  assert.deepEqual(film.highlights.map((mark) => [mark.style, mark.start]), [["ring", 3], ["spotlight", 4]]);
  assert.match(film.html.screen, /<kbd>&lt;K&gt;<\/kbd>/);
  assert.doesNotMatch(film.html.screen, /<K>/);
});

test("the pointer glides to clicks that survive the cut, and drops those that do not", () => {
  const whole = planFilm(take, [], { logo: 0 });
  assert.deepEqual(whole.cursor.clicks.map((click) => click.t), [1.5, 9]);
  // It sets off when the performer did, and is gone once it has rested.
  assert.equal(whole.cursor.moves[1].t, 1);
  assert.deepEqual(whole.cursor.visible, [{ start: 1, end: 2.6 }, { start: 8.65, end: 10.1 }]);
  const cut = planFilm(take, compileEdit({ edits: [{ cut: "a/click" }] }, take.beats), { logo: 0 });
  assert.deepEqual(cut.cursor.clicks.map((click) => click.t), [8]);
});

test("key sounds thin out where keys fall closer than a hand plays them", () => {
  const film = planFilm(take, [], { logo: 0 });
  assert.deepEqual(film.sounds, [{ t: 1.5, kind: "click" }, { t: 3, kind: "key" }, { t: 3.2, kind: "key" }, { t: 9, kind: "click" }]);
  const wav = mixSounds(film.sounds, film.duration);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.length, 44 + Math.ceil(film.duration * 48_000) * 2);
  // Silence before the first sound, something at it.
  assert.equal(wav.readInt16LE(44 + 2 * 1000), 0);
  assert.ok([...Array(400).keys()].some((i) => wav.readInt16LE(44 + 2 * (Math.round(1.5 * 48_000) + i)) !== 0));
});

test("new edit kinds reject what they cannot draw", () => {
  const bad = (edit, pattern) => assert.throws(() => compileEdit({ edits: [edit] }, take.beats), pattern);
  bad({ card: "", at: "a" }, /card needs its text/);
  bad({ card: "x", at: "a", for: "30s" }, /between 0.2s and 10s/);
  bad({ card: "x" }, /needs a point/);
  bad({ highlight: [0.9, 0.1, 0.5, 0.1], over: "a" }, /fractions of the window/);
  bad({ highlight: [0.1, 0.1, 0.1, 0.1], style: "glow", over: "a" }, /ring or spotlight/);
  bad({ transition: "wipe", at: "a" }, /must be dip/);
  bad({ keys: "Ctrl+K", over: "a", at: "a" }, /unknown argument at/);
});

test("each join in a spliced take gets a short dip unless an authored transition covers it", () => {
  const spliced = { ...take, joins: [5, 9.5] };
  assert.deepEqual(planFilm(spliced, [], { logo: 0 }).transitions, [{ t: 5, duration: 0.3 }, { t: 9.5, duration: 0.3 }]);
  const covered = planFilm(spliced, compileEdit({ edits: [{ transition: "dip", at: "b@start", for: "1s" }] }, take.beats), { logo: 0 });
  assert.deepEqual(covered.transitions, [{ t: 5, duration: 1 }, { t: 9.5, duration: 0.3 }]);
});
