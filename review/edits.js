// Browser editing replaces the selected moment's settings instead of piling
// duplicate overrides on every save. Unrelated/partial agent edits survive.
export const fullRange = (id) => `${id}@start .. ${id}@end`;
export function ownsRange(value, id) {
  return value === id || value === fullRange(id);
}
export function settingsFor(edits, id, duration) {
  const result = {
    start: 0,
    end: duration,
    speed: "",
    caption: null,
    position: "bottom",
    camera: null,
    removed: false,
  };
  for (const edit of edits) {
    if (ownsRange(edit.over, id)) {
      if ("speed" in edit) result.speed = edit.speed;
      if ("caption" in edit) {
        result.caption = edit.caption;
        result.position = edit.position ?? "bottom";
      }
      if ("camera" in edit) result.camera = edit.camera;
    }
    if (ownsRange(edit.cut, id)) result.removed = true;
    if (
      typeof edit.cut === "string" &&
      edit.cut.startsWith(`${id}@start .. ${id}@start+`)
    )
      result.start = Number(
        edit.cut.slice(`${id}@start .. ${id}@start+`.length, -1),
      );
    if (
      typeof edit.cut === "string" &&
      edit.cut.startsWith(`${id}@end-`) &&
      edit.cut.endsWith(`s .. ${id}@end`)
    )
      result.end =
        duration -
        Number(edit.cut.slice(`${id}@end-`.length, -`s .. ${id}@end`.length));
  }
  return result;
}
export function editMoment(edits, id, duration, settings, changed) {
  const start = Math.abs(settings.start) < 0.0005 ? 0 : settings.start;
  const end =
    Math.abs(settings.end - duration) < 0.0005 ? duration : settings.end;
  if (
    ![start, end].every(Number.isFinite) ||
    start < 0 ||
    end > duration ||
    end <= start
  )
    throw new Error(
      `Keep a range between 0 and ${duration.toFixed(2)} seconds.`,
    );
  const touches = (edit) => {
    if ("cut" in edit && changed.has("trim"))
      return (
        ownsRange(edit.cut, id) ||
        (typeof edit.cut === "string" &&
          (edit.cut.startsWith(`${id}@start .. ${id}@start+`) ||
            (edit.cut.startsWith(`${id}@end-`) &&
              edit.cut.endsWith(`s .. ${id}@end`))))
      );
    return ["speed", "caption", "camera"].some(
      (kind) => changed.has(kind) && kind in edit && ownsRange(edit.over, id),
    );
  };
  const next = edits.filter((edit) => !touches(edit)),
    over = fullRange(id);
  if (changed.has("trim")) {
    if (settings.removed) next.push({ cut: id });
    else {
      if (start > 0) next.push({ cut: `${id}@start .. ${id}@start+${start}s` });
      if (end < duration)
        next.push({
          cut: `${id}@end-${Number((duration - end).toFixed(3))}s .. ${id}@end`,
        });
    }
  }
  if (changed.has("speed") && settings.speed !== "")
    next.push({ speed: Number(settings.speed), over });
  if (changed.has("caption"))
    next.push({
      caption: settings.caption ?? "",
      position: settings.position,
      over,
    });
  if (changed.has("camera") && settings.camera !== null)
    next.push({ camera: settings.camera, over });
  return next;
}
export function filmTime(film, source) {
  for (const piece of film.pieces) {
    if (source < piece.a) return film.logo + piece.at;
    if (source <= piece.b)
      return film.logo + piece.at + (source - piece.a) / piece.rate;
  }
  return film.duration;
}
// Keep the same recorded frame when an edit changes the film's timing.
export function sourceTime(film, time) {
  for (const piece of film.pieces) {
    const start = film.logo + piece.at;
    const end = start + (piece.b - piece.a) / piece.rate;
    if (time < start) return piece.a;
    if (time <= end) return piece.a + (time - start) * piece.rate;
  }
  return film.pieces.at(-1)?.b ?? 0;
}
export function retime(before, after, time) {
  if (time < before.logo) return Math.min(time, after.logo);
  return filmTime(after, sourceTime(before, time));
}
