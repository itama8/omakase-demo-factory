// Pure helpers behind the keyboard-driven timeline.

/** 65.4 -> "1:05.40". Rounds once so 59.999 becomes "1:00.00", not "0:60.00". */
export function formatTime(t, digits = 2) {
  if (!Number.isFinite(t)) return "–";
  const sign = t < 0 ? "-" : "",
    scale = 10 ** digits,
    total = Math.round(Math.abs(t) * scale),
    minutes = Math.floor(total / (60 * scale)),
    rest = (total - minutes * 60 * scale) / scale;
  const [whole, fraction] = rest.toFixed(digits).split(".");
  return `${sign}${minutes}:${whole.padStart(2, "0")}${digits ? `.${fraction}` : ""}`;
}

/** Accepts "1:05.4", "1:05", "65.4", "65.4s" or ".5". Returns NaN otherwise. */
export function parseTime(text) {
  const match = String(text)
    .trim()
    .match(/^(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)\s*s?$/);
  if (!match) return NaN;
  const seconds = Number(match[2]);
  if (match[1] !== undefined && seconds >= 60) return NaN;
  return Number(match[1] ?? 0) * 60 + seconds;
}

/** Edit windows ({ id, start, end, lane }) under the playhead, top lane first. */
export function covering(windows, t, epsilon = 0.001) {
  return windows
    .filter((w) => w.start <= t + epsilon && t < w.end - epsilon)
    .sort((a, b) => a.lane - b.lane || a.start - b.start);
}

/**
 * Ctrl+Up/Down. Cycles through the edits stacked under the playhead; when none
 * is there, jumps to the nearest edit in that direction.
 */
export function pickEdit(windows, t, currentId, direction) {
  const here = covering(windows, t);
  if (here.length) {
    const index = here.findIndex((w) => w.id === currentId);
    if (index < 0) return { id: here[direction > 0 ? 0 : here.length - 1].id };
    return { id: here[(index + direction + here.length) % here.length].id };
  }
  const ordered = [...windows].sort((a, b) => a.start - b.start);
  const next =
    direction > 0
      ? ordered.find((w) => w.start > t)
      : ordered.findLast((w) => w.start < t);
  return next ? { id: next.id, seek: next.start } : null;
}

/** PageUp/PageDown: the nearest edit edge before or after the playhead. */
export function nextEdge(windows, t, direction, epsilon = 0.005) {
  const edges = [...new Set(windows.flatMap((w) => [w.start, w.end]))].sort(
    (a, b) => a - b,
  );
  return direction > 0
    ? edges.find((e) => e > t + epsilon)
    : edges.findLast((e) => e < t - epsilon);
}
