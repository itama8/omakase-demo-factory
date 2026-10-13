// The director: turn a take's beat log into camera shots.
//
// The rules are the anatomy of an Omakase demo: camera on the caret while
// typing, on the keys before a combination, on the modal while results
// appear, on the note after a jump, and back out to the whole window at the
// end. The navigator fills the picture while it is open. A shot is { t, duration, ease, frame }, in take time. A frame is
// { x, y, zoom }: the point to centre, as fractions of the window.

const TYPING_ZOOM = 1.7;
const KEYS_ZOOM = 2.1;
const MODAL_ZOOM = 1.55;
const NOTE_ZOOM = 1.28;
const CLOSEUP_ZOOM = 4;
export const WIDE = { x: 0.5, y: 0.5, zoom: 1 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const centre = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
/** The closest framing that keeps `box` inside 80% of the picture. */
export const fit = (box, most) => ({ ...centre(box), zoom: clamp(Math.min(0.8 / box.w, 0.8 / box.h), 1, most) });
// The note's caret is logged as a box with no width.
const inNote = (beat) => beat.box && beat.box.w === 0;

export function direct(beats) {
  const shots = [];
  const shot = (t, frame, duration, ease = "power3.inOut") => shots.push({ t, duration, ease, frame });
  const lastLand = beats.findLast((beat) => beat.type === "land");

  beats.forEach((beat, index) => {
    if (beat.type === "type-start" && inNote(beat)) {
      // Push in on the caret, then follow it.
      const arrive = beat.t + 0.7;
      shot(beat.t - 0.2, { x: beat.box.x + 0.12, y: beat.box.y, zoom: TYPING_ZOOM }, 0.9);
      const end = beats.findIndex((other, at) => at > index && other.type === "type-end");
      const carets = beats.slice(index + 1, end).filter((other) => other.type === "caret" && inNote(other));
      carets.forEach((caret, i) => {
        if (caret.t <= arrive) return;
        // Average the caret over a few keys, so the camera glides instead of stepping.
        const near = carets.slice(Math.max(0, i - 4), i + 3);
        const mean = (pick) => near.reduce((sum, other) => sum + pick(other.box), 0) / near.length;
        const from = Math.max(arrive, carets[i - 1]?.t ?? arrive);
        shot(from, { x: mean((box) => box.x) + 0.12, y: mean((box) => box.y), zoom: TYPING_ZOOM }, caret.t - from, "none");
      });
    }
    if (beat.type === "chord" && beat.box) shot(beat.t - 0.4, { ...centre(beat.box), zoom: KEYS_ZOOM }, 0.6);
    // The first look at a modal waits a moment, so the keys are read first.
    if (beat.type === "modal" && beat.box) shot(beat.t + (beats[index - 1]?.type === "chord" ? 0.3 : 0), fit(beat.box, MODAL_ZOOM), 0.6);
    // A surface that fills the window is framed edge to edge, and a detail inside it gets room around it.
    if (beat.type === "fill" && beat.box) shot(beat.t, { ...centre(beat.box), zoom: clamp(Math.min(1 / beat.box.w, 1 / beat.box.h), 1, MODAL_ZOOM) }, 0.7);
    if (beat.type === "closeup" && beat.box) shot(beat.t, { ...centre(beat.box), zoom: clamp(Math.min(0.7 / beat.box.w, 0.7 / beat.box.h), 1, CLOSEUP_ZOOM) }, 0.9);
    if (beat.type === "land") {
      const final = beat === lastLand;
      shot(beat.t - 0.15, final || !beat.box ? WIDE : { x: 0.5, y: beat.box.y, zoom: NOTE_ZOOM }, final ? 1.3 : 0.8);
    }
  });
  return shots.sort((a, b) => a.t - b.t);
}
