const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The same edge clamp as the exported camera: at zoom z the visible
// rectangle occupies 1/z of each dimension of the original frame.
export function cameraBounds(x, y, zoom) {
  const size = 1 / Math.max(1, zoom),
    half = size / 2;
  const cx = clamp(x, half, 1 - half),
    cy = clamp(y, half, 1 - half);
  return { left: cx - half, top: cy - half, width: size, height: size, cx, cy };
}

export function mountCameraGrid() {
  const grid = document.getElementById("camera-grid"),
    window = document.getElementById("camera-window");
  const x = document.getElementById("camera-x"),
    y = document.getElementById("camera-y"),
    zoom = document.getElementById("zoom");
  const bounds = () =>
    cameraBounds(Number(x.value), Number(y.value), Number(zoom.value));
  function refresh() {
    const box = bounds(),
      disabled = Number(zoom.value) <= 1;
    Object.assign(window.style, {
      left: `${100 * box.left}%`,
      top: `${100 * box.top}%`,
      width: `${100 * box.width}%`,
      height: `${100 * box.height}%`,
    });
    window.disabled = disabled;
    grid.setAttribute("aria-disabled", String(disabled));
    window.title = disabled
      ? "Zoom in to move the window"
      : "Drag to position. Arrow keys move; Home centres.";
    window.setAttribute(
      "aria-label",
      `Zoom placement window, ${Math.round(box.cx * 100)}% across, ${Math.round(box.cy * 100)}% down`,
    );
  }
  function place(cx, cy) {
    const box = cameraBounds(cx, cy, Number(zoom.value));
    x.value = box.cx.toFixed(4);
    y.value = box.cy.toFixed(4);
    refresh();
    x.dispatchEvent(new Event("input", { bubbles: true }));
  }
  let drag = null;
  function move(event) {
    const rect = grid.getBoundingClientRect(),
      box = bounds();
    place(
      (event.clientX - rect.left) / rect.width - drag.dx + box.width / 2,
      (event.clientY - rect.top) / rect.height - drag.dy + box.height / 2,
    );
  }
  grid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || Number(zoom.value) <= 1) return;
    event.preventDefault();
    const rect = grid.getBoundingClientRect(),
      box = bounds();
    const inside = event.target === window;
    drag = {
      id: event.pointerId,
      dx: inside
        ? (event.clientX - rect.left) / rect.width - box.left
        : box.width / 2,
      dy: inside
        ? (event.clientY - rect.top) / rect.height - box.top
        : box.height / 2,
    };
    window.focus({ preventScroll: true });
    grid.setPointerCapture(event.pointerId);
    grid.classList.add("dragging");
    move(event);
  });
  grid.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) move(event);
  });
  const finish = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    grid.classList.remove("dragging");
    if (grid.hasPointerCapture(event.pointerId))
      grid.releasePointerCapture(event.pointerId);
  };
  grid.addEventListener("pointerup", finish);
  grid.addEventListener("pointercancel", finish);
  window.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.1 : 0.01,
      box = bounds();
    const keys = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key === "Home") {
      event.preventDefault();
      place(0.5, 0.5);
    } else if (keys[event.key]) {
      event.preventDefault();
      place(box.cx + keys[event.key][0], box.cy + keys[event.key][1]);
    }
  });
  zoom.addEventListener("input", refresh);
  refresh();
  return { refresh };
}
