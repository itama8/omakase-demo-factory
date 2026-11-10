import { filmTime } from "./edits.js";

// Timeline positions use edited film time, including the intro, cuts and speed.
export function timelineSpans(spans, film) {
  const scenes = [],
    steps = [],
    markers = [];
  for (const [id, span] of Object.entries(spans)) {
    const start = filmTime(film, span.start),
      end = filmTime(film, span.end);
    const entry = { id, start, end };
    if (!id.includes("/")) {
      if (end - start > 0.001) scenes.push(entry);
      continue;
    }
    if (end - start > 0.12) steps.push(entry);
    else {
      // Omit removed steps. Keep instantaneous actions as selectable markers.
      const instant = span.end === span.start;
      if (
        (!instant && end <= start) ||
        !film.pieces.some(
          (piece) => piece.a <= span.start && span.start < piece.b,
        )
      )
        continue;
      const last = markers.at(-1);
      if (last && last.scene === id.split("/")[0] && start - last.last < 0.22) {
        last.entries.push(entry);
        last.last = start;
      } else
        markers.push({
          start,
          last: start,
          scene: id.split("/")[0],
          entries: [entry],
        });
    }
  }
  return { scenes, steps, markers };
}
