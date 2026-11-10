// Expose recording direction as ordinary editable effects; no take mutation.
import { direct } from "./director.mjs";
import { spansOf } from "./edit.mjs";
import { anchorAt } from "../review/range-edits.js";
export function editableDocument(take, document, shape = {}) {
  if (document.recordedEdits === false) return document;
  const spans = spansOf(take.beats);
  if (!Object.keys(spans).length) return document;
  const begin = take.beats.find((b) => b.type === "start").t,
    end = take.beats.findLast((b) => b.type === "end").t;
  const defaults = [],
    over = (from, to) =>
      `${anchorAt(spans, from)} .. ${anchorAt(spans, to, "end")}`;
  if (shape.camera !== "still") {
    const shots = direct(take.beats);
    shots.forEach((s, i) => {
      const from = Math.max(begin, s.t),
        to = Math.min(end, shots[i + 1]?.t ?? end);
      if (to - from < 0.0001) return;
      defaults.push({
        camera: {
          on: [
            Math.max(0, Math.min(1, s.frame.x)),
            Math.max(0, Math.min(1, s.frame.y)),
          ],
          zoom: s.frame.zoom,
        },
        over: over(from, to),
        for: Math.max(
          0.001,
          Math.min(
            Math.max(0.001, s.duration - Math.max(0, begin - s.t)),
            to - from,
          ),
        ),
        ease: s.ease,
        review: { id: `recorded-zoom-${i}` },
      });
    });
  }
  const focuses = take.beats.filter(
    (b) => b.type === "focus" && typeof b.caption === "string",
  );
  focuses.forEach((b, i) => {
    const from = Math.max(begin, b.t),
      to = Math.min(end, focuses[i + 1]?.t ?? end);
    if (to <= from) return;
    if (b.caption)
      defaults.push({
        caption: b.caption,
        position: b.position ?? "bottom",
        over: over(from, to),
        review: { id: `recorded-caption-${i}` },
      });
    if (b.box && b.mark && b.mark !== "none")
      defaults.push({
        highlight: [b.box.x, b.box.y, b.box.w, b.box.h],
        style: b.mark,
        space: "camera",
        over: over(from, to),
        review: { id: `recorded-highlight-${i}` },
      });
  });
  return {
    ...document,
    recordedEdits: false,
    edits: [...defaults, ...(document.edits ?? [])],
  };
}
