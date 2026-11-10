import test from "node:test";
import assert from "node:assert/strict";
import { cameraBounds } from "../review/camera-grid.js";

test("zoom placement window shows the visible fraction of the full frame", () => {
  assert.deepEqual(cameraBounds(0.5, 0.5, 1), {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    cx: 0.5,
    cy: 0.5,
  });
  assert.deepEqual(cameraBounds(0.5, 0.5, 2), {
    left: 0.25,
    top: 0.25,
    width: 0.5,
    height: 0.5,
    cx: 0.5,
    cy: 0.5,
  });
  assert.deepEqual(cameraBounds(0.8, 0.2, 4), {
    left: 0.675,
    top: 0.07500000000000001,
    width: 0.25,
    height: 0.25,
    cx: 0.8,
    cy: 0.2,
  });
});
test("placement clamps to the same edges as the rendered camera", () => {
  for (const zoom of [1, 1.4, 2, 4])
    for (const x of [0, 0.1, 0.5, 0.9, 1])
      for (const y of [0, 0.1, 0.5, 0.9, 1]) {
        const box = cameraBounds(x, y, zoom);
        const tx = Math.min(0, Math.max(1 - zoom, 0.5 - x * zoom));
        const ty = Math.min(0, Math.max(1 - zoom, 0.5 - y * zoom));
        assert.ok(Math.abs(box.left - -tx / zoom) < 1e-12);
        assert.ok(Math.abs(box.top - -ty / zoom) < 1e-12);
        assert.ok(
          box.left >= 0 &&
            box.top >= 0 &&
            box.left + box.width <= 1 + 1e-12 &&
            box.top + box.height <= 1 + 1e-12,
        );
      }
});
