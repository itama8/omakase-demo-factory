// Pixel-based hysteresis: catch nearby edges, release on a deliberate drag
// past the magnet. Alt bypasses snapping for overlaps at any distance.
export function snapWindow(
  start,
  end,
  {
    mode = "move",
    edge,
    targets = [],
    pixel = 0.01,
    lock = null,
    bypass = false,
  } = {},
) {
  const anchors =
    mode === "move" ? [start, end] : [edge === "start" ? start : end];
  if (bypass) return { start, end, lock: null };
  let shift = 0,
    next = null;
  if (lock) {
    const value = anchors[lock.anchor];
    if (Math.abs(value - lock.target) <= 14 * pixel) {
      shift = lock.target - value;
      next = lock;
    }
  }
  if (!next) {
    let best = 6 * pixel;
    anchors.forEach((a, i) =>
      targets.forEach((t) => {
        const d = Math.abs(a - t);
        if (d < best) {
          best = d;
          shift = t - a;
          next = { anchor: i, target: t };
        }
      }),
    );
  }
  if (next) {
    if (mode === "move") {
      start += shift;
      end += shift;
    } else if (edge === "start") start += shift;
    else end += shift;
  }
  return { start, end, lock: next };
}
