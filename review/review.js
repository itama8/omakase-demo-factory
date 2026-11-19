import { retime, filmTime, sourceTime } from "./edits.js";
import { timelineSpans } from "./timeline.js";
import {
  formatTime,
  parseTime,
  covering,
  pickEdit,
  nextEdge,
} from "./keyboard.js";
import { cameraBounds } from "./camera-grid.js";
import {
  EFFECTS,
  defaultEffect,
  importCards,
  serializeCards,
  cardTimes,
  rangeFromTimeline,
  moveRange,
  effectSeconds,
  resolveRange,
  nudgeRange,
} from "./range-edits.js";
import { snapWindow } from "./snapping.js";
const $ = (id) => document.getElementById(id);
let state,
  film,
  cards = [],
  active = null,
  placementKind = "caption",
  time = 0,
  playing = false,
  ready = false;
let saving = false,
  dirty = false,
  stale = false,
  previewValid = true,
  generation = 0,
  pendingPlan,
  previewTimer;
let previous = performance.now(),
  timelineDrag = null,
  suppressClick = false;
const undo = [];
let dragUndoGroup = null,
  dragUndoUntil = 0;
let localVersion = 0,
  lastUndoGroup = null,
  lastUndoAt = 0,
  cameraPose = { x: 0.5, y: 0.5, zoom: 1 };
// Keyboard editing. `editMode` walks the rows of the selected edit; `marks`
// are edits being recorded with Shift+Space / Ctrl+Space, innermost last.
let editMode = false,
  editRow = null,
  picker = null,
  scrub = null,
  keyboardEditing = false;
const marks = [],
  lanes = new Map();
const STEP = 0.1;
const HOTKEYS = {
  caption: "c",
  camera: "z",
  speed: "s",
  cut: "x",
  highlight: "h",
  keys: "k",
  card: "t",
};
const frame = () => 1 / (film?.fps || 30);
const clock = (t) => formatTime(t);
const label = (id) => id.replaceAll("-", " ");
const number = (n) => Number(n.toFixed(3));
const current = () => cards.find((c) => c.id === active);
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function editStatus(message, error = false) {
  $("edit-status").textContent = message;
  $("edit-status").classList.toggle("error", error);
}
async function request(url, options) {
  const response = await fetch(url, options),
    data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
const post = (url, body) =>
  request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function buttons() {
  const busy = saving || state?.job?.state === "running";
  $("undo").disabled = !undo.length || busy || stale;
  $("export").disabled = dirty || busy || stale || !previewValid;
  $("take").disabled = dirty || busy || stale;
  $("add-edit").disabled = !state || state?.job?.state === "running" || stale;
  $("export").title = dirty ? "Applying edits…" : "";
}
function inspection() {
  const c = current();
  return !playing && c?.open
    ? { effects: c.effects, kind: placementKind }
    : null;
}
function seek(t) {
  if (!film) return;
  time = Math.max(0, Math.min(t, film.duration));
  $("seek").max = film.duration;
  $("seek").value = time;
  $("clock").textContent = `${clock(time)} / ${clock(film.duration)}`;
  $("seek").setAttribute(
    "aria-valuetext",
    `${clock(time)} of ${clock(film.duration)}`,
  );
  $("playhead").style.left = `${(100 * time) / film.duration}%`;
  for (const el of $("scenes").children)
    el.classList.toggle(
      "is-current",
      Number(el.dataset.start) <= time && time < Number(el.dataset.end),
    );
  drawMarks();
  modeText();
  if (ready)
    $("film").contentWindow.postMessage(
      {
        type: "demo-seek",
        time,
        playing,
        sound: $("sound").checked,
        inspection: inspection(),
        scrubbing: scrubbing(),
        scrub: state?.scrub ?? null,
      },
      location.origin,
    );
}
// A drag on the timeline or a held arrow: the player may show its light
// scrub copy until the playhead settles.
let sliderDrag = null;
const scrubbing = () =>
  timelineDrag?.mode === "scrub" ||
  !!sliderDrag ||
  (!!scrub && performance.now() - scrub.since > 280);
function stop() {
  playing = false;
  playbackButtons();
  seek(time);
}
function playbackButtons() {
  $("play").dataset.playing = String(playing);
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause playback" : "Play full video",
  );
}
function applyFilm(plan, at = time) {
  film = plan;
  renderTimeline();
  pendingPlan = {
    type: "demo-plan",
    film: plan,
    time: at,
    sound: $("sound").checked,
    requestId: generation,
  };
  if (ready) $("film").contentWindow.postMessage(pendingPlan, location.origin);
  seek(at);
  updateRanges();
  drawPlacement();
}
function renderTimeline() {
  $("scenes").replaceChildren();
  const scenes = timelineSpans(state.spans, film).scenes;
  if (film.logo) scenes.unshift({ id: "intro", start: 0, end: film.logo });
  for (const entry of scenes) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "timeline-block";
    el.textContent = label(entry.id);
    el.dataset.start = entry.start;
    el.dataset.end = entry.end;
    el.setAttribute("aria-label", `Jump to ${label(entry.id)}`);
    el.style.left = `${(100 * entry.start) / film.duration}%`;
    el.style.width = `${(100 * (entry.end - entry.start)) / film.duration}%`;
    el.onclick = () => {
      if (suppressClick) return;
      stop();
      seek(entry.start);
    };
    $("scenes").append(el);
  }
  drawRange();
}
function drawRange(start, end) {
  const selection = $("range-selection");
  selection.hidden = start === undefined;
  if (start !== undefined) {
    selection.style.left = `${(100 * start) / film.duration}%`;
    selection.style.width = `${(100 * Math.max(0, end - start)) / film.duration}%`;
  }
  drawWindows();
}
function drawWindows() {
  if (!film || !state) return;
  const laneEnds = [];
  const container = $("edit-ranges");
  const ids = new Set(cards.map((c) => c.id));
  for (const el of [...container.children])
    if (!ids.has(el.dataset.window)) el.remove();
  const ordered = cards
    .map((c) => ({ card: c, times: cardTimes(c, film, state.spans) }))
    .sort((a, b) => a.times[0] - b.times[0]);
  for (const { card, times } of ordered) {
    const override =
      timelineDrag?.card === card && timelineDrag.mode !== "scrub"
        ? [timelineDrag.start, timelineDrag.end]
        : times;
    const [start, end] = override;
    let lane = laneEnds.findIndex((t) => t <= start + 0.001);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    lanes.set(card.id, lane);
    let el = [...container.children].find((e) => e.dataset.window === card.id);
    if (!el) {
      el = node("div", {
        class: "edit-window",
        "data-window": card.id,
        role: "button",
        tabindex: "0",
      });
      el.append(
        node("span", { class: "window-label" }),
        node("span", { class: "range-handle start", "data-edge": "start" }),
        node("span", { class: "range-handle end", "data-edge": "end" }),
      );
      container.append(el);
      el.onclick = () => {
        if (suppressClick) return;
        activate(card);
      };
    }
    el.title = `${
      Object.keys(card.effects)
        .map((k) => EFFECTS[k])
        .join(" + ") || "Edit"
    } · ${formatTime(start)}–${formatTime(end)} · Drag to move; Alt bypasses snapping`;
    el.setAttribute("aria-label", el.title);
    el.classList.toggle("is-active", card.id === active);
    Object.assign(el.style, {
      left: `${(100 * start) / film.duration}%`,
      width: `${(100 * Math.max(0.025, end - start)) / film.duration}%`,
      top: `${lane * 25}px`,
    });
    el.querySelector(".window-label").textContent =
      Object.keys(card.effects)
        .map((k) => EFFECTS[k])
        .join(" + ") || "Edit";
  }
  container.style.height = `${Math.max(1, laneEnds.length) * 25}px`;
}
function activate(card, kind) {
  active = card.id;
  card.open = true;
  if (kind) placementKind = kind;
  else
    placementKind =
      ["caption", "highlight", "keys", "camera", "card"].find(
        (k) => card.effects[k],
      ) ?? "caption";
  renderCards();
  ensureVisible(card);
}
function ensureVisible(card) {
  if (playing) return;
  // Keyboard editing owns the playhead; refresh the preview where it is.
  if (keyboardEditing) {
    seek(time);
    return;
  }
  let [a, b] = cardTimes(card, film, state.spans);
  if (card.effects.card && placementKind === "card") {
    const source = resolveRange(card.range, state.spans)[0];
    const hold = film.cards.find(
      (c) =>
        Math.abs(c.source - source) < 0.002 &&
        c.text === card.effects.card.card,
    );
    if (hold) {
      a = hold.start;
      b = a + hold.duration;
    }
  }
  if (
    card.effects.card &&
    placementKind !== "card" &&
    Object.keys(card.effects).length > 1
  ) {
    a = filmTime(film, resolveRange(card.range, state.spans)[0]);
    const source = resolveRange(card.range, state.spans)[0];
    const hold = film.cards.find(
      (c) =>
        Math.abs(c.source - source) < 0.002 &&
        c.text === card.effects.card.card,
    );
    if (hold) a = Math.max(a, hold.start + hold.duration);
  }
  if (time < a + 0.02 || time >= b - 0.02)
    seek(Math.min(film.duration - 0.001, a + Math.min(0.5, (b - a) / 2)));
  else seek(time);
}
function timesText(card) {
  const [a, b] = cardTimes(card, film, state.spans);
  return `${formatTime(a)} – ${formatTime(b)}  (${formatTime(b - a)})`;
}
function updateRanges() {
  for (const card of cards) {
    const el = document.querySelector(`[data-card="${card.id}"]`);
    if (!el) continue;
    el.querySelector(".card-summary-text").textContent =
      Object.keys(card.effects)
        .map((k) => EFFECTS[k])
        .join(" + ") || "Choose an effect";
    el.querySelector(".card-time").textContent = timesText(card);
    const times = cardTimes(card, film, state.spans);
    const values = {
      start: times[0],
      end: times[1],
      length: times[1] - times[0],
    };
    el.querySelectorAll("[data-range]").forEach((input) => {
      if (document.activeElement !== input)
        setTime(input, values[input.dataset.range]);
    });
    el.classList.toggle("is-active", card.id === active);
  }
  drawRange();
}
function changed(card, render = false) {
  if (render) {
    dragUndoGroup = null;
    lastUndoGroup = null;
  }
  card.touched = true;
  dirty = true;
  previewValid = true;
  localVersion++;
  if (render) renderCards();
  else updateRanges();
  ensureVisible(card);
  drawPlacement();
  buttons();
  if (!previewTimer)
    previewTimer = setTimeout(() => {
      previewTimer = null;
      preview();
    }, 40);
}
function snapshot() {
  return {
    edits: structuredClone(state.edits),
    recordedEdits: state.recordedEdits ?? true,
  };
}
async function preview() {
  if (saving || stale || !dirty) return;
  let edits;
  try {
    edits = serializeCards(cards, state.spans);
  } catch (error) {
    previewValid = false;
    editStatus(error.message, true);
    buttons();
    return;
  }
  const version = localVersion,
    before = snapshot(),
    group = mutationGroup();
  saving = true;
  buttons();
  try {
    const data = await post("/api/edit", {
      revision: state.revision,
      edits,
      recordedEdits: false,
      deferBuild: true,
    });
    if (JSON.stringify(before.edits) !== JSON.stringify(data.edits)) {
      if (group !== lastUndoGroup || performance.now() - lastUndoAt > 800)
        undo.push(before);
      lastUndoGroup = group;
      lastUndoAt = performance.now();
    }
    state = data;
    if (version === localVersion) {
      dirty = false;
      previewValid = true;
      const at = retime(film, data.film, time);
      applyFilm(data.film, at);
      if (current()) ensureVisible(current());
      editStatus("");
    }
  } catch (error) {
    previewValid = false;
    editStatus(error.message, true);
    if (/changed|Reload/.test(error.message)) stale = true;
  } finally {
    saving = false;
    buttons();
    if (dirty && previewValid && !stale) queueMicrotask(preview);
  }
}
function mutationGroup() {
  if (dragUndoGroup && performance.now() < dragUndoUntil) return dragUndoGroup;
  const el = document.activeElement;
  return `${active}:${placementDrag ? "placement" : timelineDrag ? "timeline" : (el?.closest("[data-effect]")?.dataset.effect ?? el?.dataset.range ?? "effect")}`;
}
function node(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}
function field(parent, name, input, oninput) {
  const el = node("label", {}, name);
  el.append(input);
  parent.append(el);
  if (oninput) input.addEventListener("input", oninput);
  return input;
}
function input(parent, name, value, oninput, attrs = {}) {
  const el = node("input", { type: "number", step: ".01", ...attrs });
  el.value = value;
  return field(parent, name, el, () => oninput(Number(el.value)));
}
// Times read and write as minutes:seconds (1:05.25); plain seconds also work.
// The exact value is kept beside the rounded text so nudges stay frame-exact.
function setTime(el, value) {
  el.exact = value;
  el.value = formatTime(value);
}
function timeValue(el) {
  return el.value.trim() === formatTime(el.exact) ? el.exact : parseTime(el.value);
}
function timeInput(parent, name, value, onchange, attrs = {}) {
  const el = node("input", {
    type: "text",
    inputmode: "decimal",
    class: "time-input",
    spellcheck: "false",
    autocomplete: "off",
    title: "minutes:seconds, e.g. 1:05.25. ↑/↓ nudge 0.1s (Shift 1s, Alt one frame)",
    ...attrs,
  });
  setTime(el, value);
  field(parent, name, el);
  const commit = () => {
    const v = timeValue(el);
    if (!Number.isFinite(v) || v < 0) {
      editStatus("Write a time as minutes:seconds, such as 1:05.25.", true);
      return;
    }
    onchange(v);
  };
  el.addEventListener("change", commit);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const v = timeValue(el);
    if (!Number.isFinite(v)) return;
    const step = e.shiftKey ? 1 : e.altKey ? frame() : STEP;
    setTime(el, Math.max(0, v + (e.key === "ArrowUp" ? step : -step)));
    commit();
  });
  return el;
}
function textInput(parent, name, value, oninput, limit = 240) {
  const el = node("textarea", { rows: "2", maxlength: limit });
  el.value = value;
  return field(parent, name, el, () => oninput(el.value));
}
function choose(parent, name, values, value, oninput) {
  const el = node("select");
  for (const [v, t] of values) el.add(new Option(t, v));
  el.value = value;
  return field(parent, name, el, () => oninput(el.value));
}
function cameraGrid(parent, card, effect, onmove = () => {}) {
  if (effect.camera === "wide") effect.camera = { on: [0.5, 0.5], zoom: 1 };
  const camera = effect.camera;
  const grid = node("div", {
    class: "camera-grid",
    "aria-label": "Zoom placement grid",
  });
  const win = node("button", {
    type: "button",
    class: "camera-window",
    "aria-label": "Zoom placement rectangle",
  });
  grid.append(win);
  parent.append(grid);
  function refresh() {
    const b = cameraBounds(...camera.on, camera.zoom);
    Object.assign(win.style, {
      left: `${b.left * 100}%`,
      top: `${b.top * 100}%`,
      width: `${b.width * 100}%`,
      height: `${b.height * 100}%`,
    });
    win.disabled = camera.zoom <= 1;
    onmove(camera);
  }
  let drag;
  grid.onpointerdown = (e) => {
    if (e.button || camera.zoom <= 1) return;
    e.preventDefault();
    const r = grid.getBoundingClientRect(),
      b = cameraBounds(...camera.on, camera.zoom);
    drag = {
      id: e.pointerId,
      dx: e.target === win ? (e.clientX - r.left) / r.width - b.cx : 0,
      dy: e.target === win ? (e.clientY - r.top) / r.height - b.cy : 0,
    };
    grid.setPointerCapture(e.pointerId);
    move(e);
  };
  function move(e) {
    if (drag?.id !== e.pointerId) return;
    const r = grid.getBoundingClientRect();
    const b = cameraBounds(
      (e.clientX - r.left) / r.width - drag.dx,
      (e.clientY - r.top) / r.height - drag.dy,
      camera.zoom,
    );
    camera.on = [number(b.cx), number(b.cy)];
    refresh();
    changed(card);
  }
  grid.onpointermove = move;
  grid.onpointerup = grid.onpointercancel = () => {
    drag = null;
  };
  win.onkeydown = (e) => {
    const delta = {
      ArrowLeft: [-0.01, 0],
      ArrowRight: [0.01, 0],
      ArrowUp: [0, -0.01],
      ArrowDown: [0, 0.01],
      Home: [0, 0],
    }[e.key];
    if (!delta) return;
    e.preventDefault();
    const b = cameraBounds(
      ...(e.key === "Home"
        ? [0.5, 0.5]
        : [camera.on[0] + delta[0], camera.on[1] + delta[1]]),
      camera.zoom,
    );
    camera.on = [number(b.cx), number(b.cy)];
    refresh();
    changed(card);
  };
  refresh();
  return refresh;
}
function renderEffect(parent, card, kind, effect) {
  const box = node("fieldset", {
    "data-effect": kind,
    "data-row": `effect:${kind}`,
  });
  box.append(node("legend", {}, EFFECTS[kind]));
  parent.append(box);
  const remove = node(
    "button",
    {
      type: "button",
      class: "remove-effect",
      "aria-label": `Remove ${EFFECTS[kind]} effect`,
    },
    "×",
  );
  remove.onclick = () => {
    delete card.effects[kind];
    changed(card, true);
  };
  box.append(remove);
  const mutate = (key, value) => {
    dragUndoGroup = null;
    effect[key] = value;
    placementKind = kind;
    changed(card);
  };
  if (kind === "caption") {
    textInput(box, "Caption text", effect.caption, (v) => mutate("caption", v));
    const button = node(
      "button",
      { type: "button", class: "place-button" },
      "Position caption on preview",
    );
    button.onclick = () => {
      active = card.id;
      placementKind = "caption";
      ensureVisible(card);
      drawPlacement();
    };
    box.append(button);
    box.append(
      node(
        "p",
        { class: "hint" },
        "Drag the rectangle on the preview. Drag its corner to resize; arrow keys move it.",
      ),
    );
  } else if (kind === "speed")
    input(box, "Playback speed (×)", effect.speed, (v) => mutate("speed", v), {
      min: ".1",
      max: "10",
      step: ".1",
    });
  else if (kind === "cut")
    box.append(
      node(
        "p",
        { class: "hint" },
        "Remove the selected range from the finished video.",
      ),
    );
  else if (kind === "camera") {
    if (effect.camera === "wide") effect.camera = { on: [0.5, 0.5], zoom: 1 };
    let refresh = () => {};
    const set = (apply) => (v) => {
      if (!Number.isFinite(v)) return;
      apply(v);
      placementKind = kind;
      refresh();
      changed(card);
    };
    input(
      box,
      "Zoom (×)",
      effect.camera.zoom,
      set((v) => (effect.camera.zoom = clamp(v, 1, 4))),
      { min: "1", max: "4", step: ".05" },
    );
    const centre = node("div", { class: "pair" });
    box.append(centre);
    const x = input(
      centre,
      "Centre X",
      effect.camera.on[0],
      set((v) => (effect.camera.on = [number(clamp(v, 0, 1)), effect.camera.on[1]])),
      { min: "0", max: "1", step: ".01" },
    );
    const y = input(
      centre,
      "Centre Y",
      effect.camera.on[1],
      set((v) => (effect.camera.on = [effect.camera.on[0], number(clamp(v, 0, 1))])),
      { min: "0", max: "1", step: ".01" },
    );
    const motion = node("div", { class: "pair" });
    box.append(motion);
    const seconds = effectSeconds(effect.for, 0.8);
    input(
      motion,
      "Zoom in over (s)",
      number(seconds),
      (v) => {
        if (Number.isFinite(v)) mutate("for", number(clamp(v, 0.001, 30)));
      },
      { min: "0", max: "5", step: ".1" },
    );
    choose(
      motion,
      "Motion",
      [
        ["power3.inOut", "Smooth"],
        ["power2.inOut", "Gentle"],
        ["power4.inOut", "Swift"],
        ["power1.inOut", "Soft"],
        ["none", "Linear"],
      ],
      effect.ease ?? "power3.inOut",
      (v) => mutate("ease", v),
    );
    if (seconds < 0.05)
      box.append(
        node(
          "p",
          { class: "hint warn" },
          "Zoom-in is instant (a cut). Set “Zoom in over” to about 0.8s for a smooth zoom.",
        ),
      );
    refresh = cameraGrid(box, card, effect, (camera) => {
      if (document.activeElement !== x) x.value = camera.on[0];
      if (document.activeElement !== y) y.value = camera.on[1];
    });
  } else if (kind === "highlight") {
    choose(
      box,
      "Style",
      [
        ["ring", "Ring"],
        ["spotlight", "Spotlight"],
      ],
      effect.style ?? "ring",
      (v) => mutate("style", v),
    );
    const b = node(
      "button",
      { type: "button" },
      "Position highlight on preview",
    );
    b.onclick = () => {
      active = card.id;
      placementKind = "highlight";
      ensureVisible(card);
      drawPlacement();
    };
    box.append(b);
  } else if (kind === "keys") {
    textInput(box, "Keys", effect.keys, (v) => mutate("keys", v), 40);
    const b = node("button", { type: "button" }, "Position key callout");
    b.onclick = () => {
      active = card.id;
      placementKind = "keys";
      ensureVisible(card);
      drawPlacement();
    };
    box.append(b);
  } else if (kind === "card") {
    textInput(box, "Title", effect.card, (v) => mutate("card", v), 80);
    textInput(
      box,
      "Subtitle",
      effect.subtitle ?? "",
      (v) => mutate("subtitle", v),
      160,
    );
    timeInput(box, "Holds for (m:ss)", effectSeconds(effect.for), (v) =>
      mutate("for", number(clamp(v, 0.2, 10))),
    );
  } else
    box.append(
      node(
        "p",
        { class: "hint" },
        "Fade through the canvas colour at the start of this range (0.2–2s).",
      ),
    );
}
function renderCards() {
  $("edit-cards").replaceChildren();
  $("empty-edits").hidden = cards.length > 0;
  for (const card of cards) {
    const el = node("details", { class: "edit-card", "data-card": card.id });
    el.open = card.open;
    const summary = node("summary");
    summary.append(
      node("span", { class: "card-summary-text" }),
      node("span", { class: "card-time" }),
    );
    el.append(summary);
    el.addEventListener("toggle", () => {
      if (el.open === card.open) return;
      card.open = el.open;
      active = card.id;
      if (card.effects.caption) placementKind = "caption";
      else if (card.effects.highlight) placementKind = "highlight";
      else if (card.effects.keys) placementKind = "keys";
      else if (card.effects.camera) placementKind = "camera";
      else if (card.effects.card) placementKind = "card";
      if (card.open) ensureVisible(card);
      updateRanges();
      drawPlacement();
    });
    summary.addEventListener("click", () => {
      active = card.id;
      if (card.effects.caption) placementKind = "caption";
      else if (card.effects.highlight) placementKind = "highlight";
      else if (card.effects.keys) placementKind = "keys";
      else if (card.effects.camera) placementKind = "camera";
      else if (card.effects.card) placementKind = "card";
    });
    const body = node("div", { class: "edit-card-body" }),
      range = node("div", {
        class: "range-inputs",
        "data-row": "timing",
      });
    el.append(body);
    body.append(range);
    const times = cardTimes(card, film, state.spans);
    const fields = {};
    const commitRange = (which) => {
      let start = timeValue(fields.start),
        end = timeValue(fields.end);
      if (which === "length") end = start + timeValue(fields.length);
      try {
        if (![start, end].every(Number.isFinite)) throw new Error("Write times as minutes:seconds, such as 1:05.25.");
        card.range = moveRange(card, film, state.spans, start, end);
        if (card.effects.card && Object.keys(card.effects).length === 1)
          card.effects.card.for = number(clamp(end - start, 0.2, 10));
        active = card.id;
        keyboardEditing = true;
        changed(card);
      } catch (error) {
        editStatus(error.message, true);
        updateRanges();
      }
    };
    [
      ["start", "Start"],
      ["end", "End"],
      ["length", "Length"],
    ].forEach(([key, name], i) => {
      fields[key] = timeInput(
        range,
        name,
        [times[0], times[1], times[1] - times[0]][i],
        () => commitRange(key),
        { "data-range": key },
      );
    });
    const effectList = node("div", { class: "effect-list" });
    body.append(effectList);
    for (const [kind, effect] of Object.entries(card.effects))
      renderEffect(effectList, card, kind, effect);
    const add = node("div", { class: "add-effect", "data-row": "add" }),
      toggle = node(
        "button",
        { type: "button", class: "add-effect-toggle" },
        "+ Add effect",
      );
    toggle.onclick = () =>
      picker?.card === card.id ? closePicker() : openPicker(card);
    add.append(toggle);
    if (picker?.card === card.id) {
      const list = node("div", {
        class: "effect-picker",
        role: "listbox",
        "aria-label": "Effects",
      });
      const kinds = availableEffects(card);
      if (!kinds.length)
        list.append(node("p", { class: "hint" }, "Every effect is already here."));
      kinds.forEach((kind) => {
        const option = node("button", {
          type: "button",
          role: "option",
          "data-kind": kind,
        });
        option.append(
          node("kbd", {}, HOTKEYS[kind].toUpperCase()),
          node("span", {}, EFFECTS[kind]),
        );
        option.onclick = () => addEffect(card, kind);
        list.append(option);
      });
      add.append(list);
    }
    body.append(add);
    const actions = node("div", { class: "card-actions" }),
      jump = node("button", { type: "button" }, "Jump to start"),
      del = node(
        "button",
        { type: "button", class: "delete-edit" },
        "Delete edit",
      );
    jump.onclick = () => {
      active = card.id;
      stop();
      seek(cardTimes(card, film, state.spans)[0]);
      drawPlacement();
      drawRange();
    };
    del.onclick = () => deleteCard(card);
    actions.append(jump, del);
    body.append(actions);
    $("edit-cards").append(el);
  }
  updateRanges();
  drawPlacement();
  buttons();
  applyEditMode();
}
function deleteCard(card) {
  cards = cards.filter((c) => c !== card);
  if (active === card.id) active = null;
  if (picker?.card === card.id) picker = null;
  if (!current()) editMode = false;
  dirty = true;
  localVersion++;
  previewValid = true;
  renderCards();
  preview();
}
const availableEffects = (card) =>
  Object.keys(EFFECTS).filter((k) => k !== "transition" && !card.effects[k]);
function addCard(
  start = time,
  end = Math.min(film.duration, time + 3),
  { keepPlaying = false } = {},
) {
  if (!keepPlaying) stop();
  try {
    if (end - start < 0.04) {
      end = film.duration;
      start = Math.max(film.logo, end - 3);
    }
    const range = rangeFromTimeline(film, state.spans, start, end);
    const card = {
      id: crypto.randomUUID(),
      range,
      open: true,
      effects: {},
      originals: [],
      touched: true,
    };
    cards.push(card);
    active = card.id;
    if (keepPlaying) {
      renderCards();
      editStatus(
        `Edit ${formatTime(start)}–${formatTime(end)} added. Pause, then press Enter on it to add effects.`,
      );
    } else {
      openPicker(card);
      editStatus("Pick an effect: ↑/↓ and Enter, or its letter.");
    }
    return card;
  } catch (error) {
    editStatus(error.message, true);
  }
}

/* ---------- Keyboard editing ---------- */

const firstPlaced = (card) =>
  ["caption", "highlight", "keys", "camera", "card"].find(
    (k) => card.effects[k],
  ) ?? "caption";
function windowsList() {
  return cards.map((c) => {
    const [start, end] = cardTimes(c, film, state.spans);
    return { id: c.id, start, end, lane: lanes.get(c.id) ?? 0 };
  });
}
function cardElement(card = current()) {
  return card && document.querySelector(`[data-card="${card.id}"]`);
}
function rowKeys(card = current()) {
  return [...(cardElement(card)?.querySelectorAll("[data-row]") ?? [])].map(
    (el) => el.dataset.row,
  );
}
function rowName(key) {
  if (key === "timing") return "Timing";
  if (key === "add") return "Add effect";
  return EFFECTS[key?.split(":")[1]] ?? "";
}
function effectsName(card) {
  return (
    Object.keys(card.effects)
      .map((k) => EFFECTS[k])
      .join(" + ") || "Empty edit"
  );
}
let lastMode = "";
function modeText() {
  const parts = [];
  if (marks.length)
    parts.push(
      `● Marking ${marks.map((m) => formatTime(m.start)).join(" › ")} → ${formatTime(time)}`,
    );
  const card = current();
  if (editMode && card)
    parts.push(
      `EDIT · ${effectsName(card)} · ${picker ? "Pick an effect" : rowName(editRow)}`,
    );
  else if (card) parts.push(`Selected · ${effectsName(card)}`);
  const text = parts.join("   ");
  if (text === lastMode) return;
  lastMode = text;
  $("mode").textContent = text;
  $("mode").hidden = !text;
  $("mode").classList.toggle("is-editing", editMode);
  $("mode").classList.toggle("is-marking", marks.length > 0);
}
function applyEditMode() {
  document.body.classList.toggle("is-editing", editMode);
  for (const el of document.querySelectorAll(".is-kb, .edit-card.is-editing"))
    el.classList.remove("is-kb", "is-editing");
  const el = cardElement();
  if (editMode && el) {
    el.classList.add("is-editing");
    const keys = rowKeys();
    if (picker) editRow = "add";
    if (!keys.includes(editRow))
      editRow = keys.find((k) => k.startsWith("effect:")) ?? keys[0];
    const row = el.querySelector(`[data-row="${editRow}"]`);
    row?.classList.add("is-kb");
    row?.scrollIntoView({ block: "nearest" });
    el.querySelectorAll(".effect-picker [data-kind]").forEach((option, i) =>
      option.classList.toggle("is-kb", i === picker?.index),
    );
  } else if (editMode) editMode = false;
  modeText();
}
function selectEdit(card, { seekInto = false } = {}) {
  active = card.id;
  placementKind = firstPlaced(card);
  if (editMode) {
    card.open = true;
    picker = null;
    editRow = null;
  }
  renderCards();
  if (seekInto) seek(cardTimes(card, film, state.spans)[0]);
  cardElement(card)?.scrollIntoView({ block: "nearest" });
  seek(time);
}
function enterEdit() {
  const here = covering(windowsList(), time);
  let card = current();
  if (!card || !here.some((w) => w.id === card.id))
    card = cards.find((c) => c.id === here[0]?.id) ?? card;
  if (!card) {
    editStatus("No edit at the playhead. Shift+Space starts one.");
    return;
  }
  if (playing) stop();
  keyboardEditing = true;
  const inside = here.some((w) => w.id === card.id);
  editMode = true;
  card.open = true;
  active = card.id;
  placementKind = firstPlaced(card);
  editRow = null;
  if (!Object.keys(card.effects).length) openPicker(card);
  else renderCards();
  if (!inside) seek(cardTimes(card, film, state.spans)[0]);
  else seek(time);
}
function exitEdit() {
  const hadPicker = picker;
  editMode = false;
  picker = null;
  if (document.activeElement?.closest?.("aside")) document.activeElement.blur();
  if (hadPicker) renderCards();
  else applyEditMode();
}
function openPicker(card) {
  active = card.id;
  card.open = true;
  editMode = true;
  picker = { card: card.id, index: 0 };
  editRow = "add";
  renderCards();
}
function closePicker() {
  picker = null;
  renderCards();
}
function movePicker(direction) {
  const count = availableEffects(current()).length;
  if (!count) return;
  picker.index = clamp(picker.index + direction, 0, count - 1);
  applyEditMode();
}
function addEffect(card, kind) {
  keyboardEditing = true;
  editMode = true;
  picker = null;
  active = card.id;
  card.open = true;
  placementKind = kind;
  editRow = `effect:${kind}`;
  if (card.effects[kind]) {
    renderCards();
    seek(time);
    return;
  }
  card.effects[kind] = defaultEffect(kind);
  changed(card, true);
  editStatus(`${EFFECTS[kind]} added. Enter configures it; Esc steps back.`);
  // Effects that need words go straight to their text.
  if (["caption", "keys", "card"].includes(kind)) configureRow();
}
function moveRow(direction) {
  const keys = rowKeys(),
    index = keys.indexOf(editRow);
  editRow = keys[clamp(index + direction, 0, keys.length - 1)];
  if (editRow?.startsWith("effect:")) placementKind = editRow.split(":")[1];
  applyEditMode();
  drawPlacement();
  seek(time);
}
function configureRow() {
  const el = cardElement()?.querySelector(`[data-row="${editRow}"]`);
  if (!el) return;
  if (editRow === "add") {
    openPicker(current());
    return;
  }
  const control = el.querySelector(
    "textarea, input:not([type=checkbox]), select, .camera-window:not(:disabled)",
  );
  if (!control) {
    editStatus(`${rowName(editRow)} has nothing to configure.`);
    return;
  }
  control.focus({ preventScroll: false });
  if (control.select && control.tagName !== "SELECT") control.select();
}
function removeRow() {
  const card = current();
  if (!card) return;
  if (editRow === "timing") {
    deleteCard(card);
    editStatus("Edit deleted. Ctrl+Z restores it.");
    return;
  }
  if (!editRow?.startsWith("effect:")) return;
  const kind = editRow.split(":")[1],
    keys = rowKeys();
  const at = keys.indexOf(editRow);
  editRow = keys[at + 1]?.startsWith("effect:") ? keys[at + 1] : keys[at - 1];
  delete card.effects[kind];
  changed(card, true);
  editStatus(`${EFFECTS[kind]} removed. Ctrl+Z restores it.`);
}
function rateAt(source) {
  return (
    film.pieces.find((p) => p.a <= source && source <= p.b)?.rate ?? 1
  );
}
function editTarget() {
  let card = current();
  const here = covering(windowsList(), time);
  if (!card && here.length) {
    card = cards.find((c) => c.id === here[0].id);
    active = card.id;
  }
  if (!card) editStatus("Select an edit first: Ctrl+↑/↓ or Shift+Space.");
  return card;
}
// Move one edge, then park the playhead on it so the change is visible.
function moveEdge(card, edge, delta) {
  const next = nudgeRange(card, state.spans, edge, delta);
  if (next.range === card.range && next.for === undefined) return;
  card.range = next.range;
  if (next.for !== undefined) card.effects.card.for = next.for;
  keyboardEditing = true;
  changed(card);
  const [a, b] = cardTimes(card, film, state.spans);
  seek(edge === "start" ? a : Math.max(a, b - frame()));
}
function nudge(edge, delta) {
  const card = editTarget();
  if (!card) return;
  const [from, to] = resolveRange(card.range, state.spans);
  const source = edge === "start" ? from : to;
  moveEdge(card, edge, delta * (card.effects.cut ? 1 : rateAt(source)));
}
function edgeToPlayhead(edge) {
  const card = editTarget();
  if (!card) return;
  const lone = card.effects.card && Object.keys(card.effects).length === 1;
  if (lone && edge === "end") {
    moveEdge(card, edge, time - cardTimes(card, film, state.spans)[1]);
    return;
  }
  const [from, to] = resolveRange(card.range, state.spans);
  moveEdge(card, edge, sourceTime(film, time) - (edge === "start" ? from : to));
}
function cycleEdit(direction) {
  const pick = pickEdit(windowsList(), time, active, direction);
  if (!pick) {
    editStatus(direction > 0 ? "No later edit." : "No earlier edit.");
    return;
  }
  keyboardEditing = true;
  selectEdit(cards.find((c) => c.id === pick.id), {
    seekInto: pick.seek !== undefined,
  });
}
function openMark() {
  marks.push({ start: time });
  editStatus(
    marks.length > 1
      ? `Stacked edit started at ${formatTime(time)}. Shift+Space ends the newest one.`
      : `Edit started at ${formatTime(time)}. Shift+Space ends it; Ctrl+Space starts another inside it.`,
  );
  seek(time);
}
function closeMark() {
  const mark = marks.at(-1),
    start = Math.min(mark.start, time),
    end = Math.max(mark.start, time);
  if (end - start < 0.04) {
    editStatus("Move the playhead before ending the edit.", true);
    return;
  }
  marks.pop();
  addCard(start, end, { keepPlaying: playing || marks.length > 0 });
  seek(time);
}
function drawMarks() {
  const layer = $("marks");
  if (!film || !layer) return;
  while (layer.children.length > marks.length) layer.lastChild.remove();
  while (layer.children.length < marks.length)
    layer.append(node("div", { class: "pending-mark" }));
  layer.style.height = marks.length ? `${marks.length * 7 + 2}px` : "0";
  marks.forEach((mark, i) => {
    const a = Math.min(mark.start, time),
      b = Math.max(mark.start, time);
    Object.assign(layer.children[i].style, {
      left: `${(100 * a) / film.duration}%`,
      width: `${(100 * (b - a)) / film.duration}%`,
      top: `${i * 7}px`,
    });
  });
}
function scrubBy(delta) {
  keyboardEditing = true;
  seek(clamp(time + delta, 0, film.duration));
}
const FIELDS =
  'textarea, select, input:not([type=range]):not([type=checkbox]), [contenteditable="true"]';
function onKeyDown(e) {
  const target = e.target instanceof Element ? e.target : null;
  const inField = target?.closest(FIELDS);
  if (inField) {
    // Leave a field and return to keyboard navigation of the edit.
    if (
      e.key === "Escape" ||
      (e.key === "Enter" &&
        (inField.tagName !== "TEXTAREA" || e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault();
      inField.blur();
      applyEditMode();
    }
    return;
  }
  if (!film || !state || e.isComposing) return;
  const ctrl = e.ctrlKey || e.metaKey,
    key = e.key;
  const take = () => {
    e.preventDefault();
    e.stopPropagation?.();
  };
  // Enter on ordinary buttons and links keeps working.
  if (key === "Enter" && target?.closest("button, a, summary")) return;
  if (e.code === "Space") {
    take();
    if (e.repeat) return;
    if (ctrl) openMark();
    else if (e.shiftKey) marks.length ? closeMark() : openMark();
    else togglePlayback();
    return;
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    take();
    const direction = key === "ArrowRight" ? 1 : -1;
    if (ctrl)
      nudge(e.shiftKey ? "start" : "end", direction * (e.altKey ? frame() : STEP));
    else if (e.shiftKey) scrubBy(direction);
    else if (e.altKey) scrubBy(direction * frame());
    else if (!e.repeat) {
      // Scrubbing and playback would fight over the picture: pause while
      // the arrow is held and carry on playing from the new spot.
      const resume = playing;
      if (playing) stop();
      scrubBy(direction * STEP);
      scrub = { direction, since: performance.now(), resume };
    }
    return;
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const direction = key === "ArrowDown" ? 1 : -1;
    if (ctrl) {
      take();
      cycleEdit(direction);
    } else if (picker) {
      take();
      movePicker(direction);
    } else if (editMode) {
      take();
      moveRow(direction);
    }
    return;
  }
  if (key === "Enter") {
    take();
    if (picker) {
      const kind = availableEffects(current())[picker.index];
      if (kind) addEffect(current(), kind);
    } else if (editMode) configureRow();
    else enterEdit();
    return;
  }
  if (key === "Escape") {
    take();
    if (picker && Object.keys(current()?.effects ?? {}).length) closePicker();
    else if (editMode) exitEdit();
    else if (marks.length) {
      marks.pop();
      editStatus("Unfinished edit dropped.");
      seek(time);
    } else if (current()?.open) {
      // A finished edit folds away; Enter opens it again.
      current().open = false;
      renderCards();
      seek(time);
    } else if (active) {
      active = null;
      renderCards();
      seek(time);
    }
    return;
  }
  if (ctrl && !e.altKey && key.toLowerCase() === "z") {
    take();
    undoEdit();
    return;
  }
  if (ctrl || e.altKey) return;
  if ((key === "Delete" || key === "Backspace") && editMode) {
    take();
    removeRow();
    return;
  }
  const kind = Object.keys(HOTKEYS).find((k) => HOTKEYS[k] === key.toLowerCase());
  if (kind && (editMode || picker) && current()) {
    take();
    addEffect(current(), kind);
    return;
  }
  const simple = {
    ",": () => scrubBy(-frame()),
    ".": () => scrubBy(frame()),
    "[": () => edgeToPlayhead("start"),
    "]": () => edgeToPlayhead("end"),
    Home: () => scrubBy(-time),
    End: () => scrubBy(film.duration - time),
    PageUp: () => {
      const t = nextEdge(windowsList(), time, -1);
      if (t !== undefined) scrubBy(t - time);
    },
    PageDown: () => {
      const t = nextEdge(windowsList(), time, 1);
      if (t !== undefined) scrubBy(t - time);
    },
    "?": () => ($("shortcuts").open = !$("shortcuts").open),
  }[key];
  if (simple) {
    take();
    simple();
  }
}
function onKeyUp(e) {
  if (
    (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
    scrub?.direction === (e.key === "ArrowRight" ? 1 : -1)
  ) {
    const resume = scrub.resume;
    scrub = null;
    if (resume && !playing) togglePlayback();
    else seek(time);
  }
}
function effectBox(effect, kind) {
  if (kind === "highlight" && effect.space !== "camera")
    return effect.highlight;
  if (kind !== "highlight" && effect.box) return effect.box;
  const planKind = {
    caption: "captions",
    highlight: "highlights",
    keys: "keys",
  }[kind];
  const index = film?.[planKind]?.findIndex(
    (e) =>
      e.start <= time &&
      time < e.start + e.duration &&
      (kind === "caption"
        ? e.text === effect.caption
        : kind === "keys"
          ? e.label === effect.keys
          : true),
  );
  const actual =
    index >= 0
      ? $("film").contentDocument?.getElementById(
          `${kind === "caption" ? "caption" : kind === "keys" ? "keys" : "highlight"}-${index}`,
        )
      : null;
  if (actual) {
    const r = actual.getBoundingClientRect(),
      v = $("film").getBoundingClientRect();
    return [
      r.left / v.width,
      r.top / v.height,
      r.width / v.width,
      r.height / v.height,
    ];
  }
  if (kind === "highlight") {
    const b = effect.highlight,
      z = cameraPose.zoom;
    return [
      0.5 + (b[0] - cameraPose.x) * z,
      0.5 + (b[1] - cameraPose.y) * z,
      b[2] * z,
      b[3] * z,
    ];
  }
  return [0.1, effect.position === "top" ? 0.05 : 0.78, 0.8, 0.15];
}
function drawPlacement() {
  const card = current(),
    effect = card?.effects[placementKind];
  $("placement-layer").hidden =
    !card?.open ||
    !effect ||
    !["caption", "highlight", "keys"].includes(placementKind);
  if ($("placement-layer").hidden) return;
  const b = effectBox(effect, placementKind);
  Object.assign($("placement-box").style, {
    left: `${b[0] * 100}%`,
    top: `${b[1] * 100}%`,
    width: `${b[2] * 100}%`,
    height: `${b[3] * 100}%`,
  });
  $("placement-label").textContent = EFFECTS[placementKind];
  $("placement-box").setAttribute(
    "aria-label",
    `${EFFECTS[placementKind]} placement rectangle`,
  );
}
let placementDrag;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
$("placement-box").onpointerdown = (e) => {
  if (e.button) return;
  e.preventDefault();
  const card = current(),
    effect = card.effects[placementKind];
  const b = effectBox(effect, placementKind);
  placementDrag = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    box: [...b],
    resize: !!e.target.closest(".resize-handle"),
    card,
    kind: placementKind,
  };
  $("placement-box").setPointerCapture(e.pointerId);
};
$("placement-box").onpointermove = (e) => {
  if (placementDrag?.id !== e.pointerId) return;
  const d = placementDrag,
    r = $("placement-layer").getBoundingClientRect(),
    b = [...d.box],
    dx = (e.clientX - d.x) / r.width,
    dy = (e.clientY - d.y) / r.height;
  if (d.resize) {
    b[2] = clamp(b[2] + dx, 0.08, 1 - b[0]);
    b[3] = clamp(b[3] + dy, 0.06, 1 - b[1]);
  } else {
    b[0] = clamp(b[0] + dx, 0, 1 - b[2]);
    b[1] = clamp(b[1] + dy, 0, 1 - b[3]);
  }
  d.card.effects[d.kind][d.kind === "highlight" ? "highlight" : "box"] =
    b.map(number);
  if (d.kind === "highlight") d.card.effects.highlight.space = "screen";
  changed(d.card);
};
$("placement-box").onpointerup = $("placement-box").onpointercancel = () => {
  placementDrag = null;
};
$("placement-box").onkeydown = (e) => {
  const delta = {
    ArrowLeft: [-0.01, 0],
    ArrowRight: [0.01, 0],
    ArrowUp: [0, -0.01],
    ArrowDown: [0, 0.01],
  }[e.key];
  if (!delta) return;
  e.preventDefault();
  const c = current(),
    effect = c.effects[placementKind],
    b = [...effectBox(effect, placementKind)];
  b[0] = clamp(b[0] + delta[0], 0, 1 - b[2]);
  b[1] = clamp(b[1] + delta[1], 0, 1 - b[3]);
  effect[placementKind === "highlight" ? "highlight" : "box"] = b;
  if (placementKind === "highlight") effect.space = "screen";
  changed(c);
};
function display(data, reloadFilm = false) {
  if (!state && data.film.sourceAudio) $("sound").checked = true;
  state = data;
  film = data.film;
  cards = importCards(data.edits, data.spans);
  active = null;
  stale = false;
  document.documentElement.style.setProperty(
    "--film-aspect",
    `${film.width} / ${film.height}`,
  );
  document.title = `${data.name} · Demo review`;
  $("title").textContent = data.title ?? label(data.name);
  $("library").hidden = !data.factoryUrl;
  if (data.factoryUrl) $("library").href = data.factoryUrl;
  $("take").replaceChildren(
    ...data.takes.map((t) => {
      const o = new Option(
        `${new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${t.duration.toFixed(0)}s`,
        t.id,
      );
      o.selected = t.current;
      return o;
    }),
  );
  $("take").closest("label").hidden = data.takes.length < 2;
  if (!$("preset").options.length)
    for (const [id, description] of Object.entries(data.presets)) {
      const o = new Option(id, id);
      o.title = description;
      $("preset").append(o);
    }
  if (reloadFilm) {
    ready = false;
    // The project on disk is from the last build; browser edits save without
    // rebuilding it. Hand the player the current plan as soon as it loads.
    pendingPlan = {
      type: "demo-plan",
      film: data.film,
      time,
      sound: $("sound").checked,
      requestId: generation,
    };
    $("film").src = `/project/index.html?review=1&v=${data.revision}`;
  }
  renderTimeline();
  renderCards();
  seek(time);
  job(data.job);
}
function job(value) {
  if (state) state.job = value;
  $("download").hidden = !(value?.state === "ready" && value.current && !dirty);
  $("log").textContent = value?.log || "No export running.";
  if (value?.state === "running") status(`Exporting ${value.preset ?? ""}…`);
  else if (value?.state === "failed")
    status("Export failed. See Export progress.", true);
  buttons();
}
async function undoEdit() {
  if (dirty && !saving) {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    await preview();
    if (dirty) {
      cards = importCards(state.edits, state.spans);
      dirty = false;
      previewValid = true;
      active = null;
      renderCards();
      applyFilm(state.film, time);
      return;
    }
  }
  if (saving || !undo.length || stale) return;
  const previous = undo.at(-1);
  saving = true;
  buttons();
  try {
    const data = await post("/api/edit", {
      revision: state.revision,
      edits: previous.edits,
      recordedEdits: previous.recordedEdits,
      deferBuild: true,
    });
    const at = retime(film, data.film, time);
    undo.pop();
    dirty = false;
    localVersion++;
    lastUndoGroup = null;
    display(data);
    applyFilm(data.film, at);
    editStatus("");
  } catch (error) {
    editStatus(error.message, true);
  } finally {
    saving = false;
    buttons();
  }
}
$("undo").onclick = undoEdit;
$("add-edit").onclick = () => addCard();
$("seek").oninput = () => seek(Number($("seek").value));
// Dragging the seek bar: pause while dragging, as on the timeline, and
// carry on playing from the new spot when released.
$("seek").addEventListener("pointerdown", (e) => {
  if (e.button) return;
  sliderDrag = { resume: playing };
  if (playing) stop();
});
addEventListener(
  "pointerup",
  () => {
    if (!sliderDrag) return;
    const { resume } = sliderDrag;
    sliderDrag = null;
    if (resume) togglePlayback();
    else seek(time);
  },
  true,
);
addEventListener("pointercancel", () => {
  if (!sliderDrag) return;
  sliderDrag = null;
  seek(time);
});
const timelineTime = (x) => {
  const r = $("timeline").getBoundingClientRect();
  return clamp(((x - r.left) / r.width) * film.duration, 0, film.duration);
};
$("timeline").addEventListener(
  "pointerdown",
  (e) => {
    if (!film || e.button || stale) return;
    const windowEl = e.target.closest("[data-window]"),
      handle = e.target.closest("[data-edge]");
    if (!e.ctrlKey && !windowEl && e.target.closest("button,input")) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = true;
    const at = timelineTime(e.clientX),
      card = windowEl
        ? cards.find((c) => c.id === windowEl.dataset.window)
        : null;
    if (card) {
      active = card.id;
      card.open = true;
      placementKind =
        ["caption", "highlight", "keys", "camera", "card"].find(
          (k) => card.effects[k],
        ) ?? "caption";
    }
    const times = card ? cardTimes(card, film, state.spans) : [at, at];
    timelineDrag = {
      id: e.pointerId,
      card,
      originalCard: card ? structuredClone(card) : null,
      originalFilm: film,
      mode: e.ctrlKey ? "range" : handle ? "resize" : card ? "move" : "scrub",
      edge: handle?.dataset.edge,
      start: times[0],
      end: times[1],
      original: [...times],
      origin: at,
      x: e.clientX,
      // A click must not move an edit: only a deliberate drag does.
      armed: !card,
      resume: playing,
      lock: null,
    };
    stop();
    if (card) {
      dragUndoGroup = crypto.randomUUID();
      dragUndoUntil = Infinity;
    }
    $("timeline").setPointerCapture(e.pointerId);
    if (card) {
      renderCards();
      ensureVisible(card);
    } else if (timelineDrag.mode === "range") drawRange(at, at);
    else seek(at);
  },
  true,
);
$("timeline").onpointermove = (e) => {
  const d = timelineDrag;
  if (d?.id !== e.pointerId) return;
  const at = timelineTime(e.clientX);
  if (d.mode === "scrub") {
    seek(at);
    return;
  }
  if (d.mode === "range") {
    d.end = at;
    drawRange(Math.min(d.start, at), Math.max(d.start, at));
    return;
  }
  if (!d.armed) {
    if (Math.abs(e.clientX - d.x) < 4) return;
    d.armed = true;
  }
  const length = d.original[1] - d.original[0];
  let start = d.original[0],
    end = d.original[1];
  if (d.mode === "move") {
    start = clamp(
      d.original[0] + at - d.origin,
      0,
      Math.max(0, film.duration - length),
    );
    end = start + length;
  } else if (d.edge === "start") start = Math.min(end - 0.04, at);
  else end = Math.max(start + 0.04, at);
  const targets = cards
    .filter((c) => c !== d.card)
    .flatMap((c) => cardTimes(c, film, state.spans));
  const snapped = snapWindow(start, end, {
    mode: d.mode,
    edge: d.edge,
    targets,
    pixel: film.duration / $("timeline").getBoundingClientRect().width,
    lock: d.lock,
    bypass: e.altKey,
  });
  d.start = clamp(snapped.start, 0, film.duration - 0.04);
  d.end = clamp(snapped.end, d.start + 0.04, film.duration);
  d.lock = snapped.lock;
  if (
    d.card &&
    !["cut", "speed", "card"].some((kind) => d.card.effects[kind])
  ) {
    try {
      d.card.range = moveRange(
        d.originalCard,
        d.originalFilm,
        state.spans,
        d.start,
        d.end,
      );
      changed(d.card);
    } catch {}
  }
  drawWindows();
};
function finishDrag(e) {
  const d = timelineDrag;
  if (d?.id !== e.pointerId) return;
  timelineDrag = null;
  dragUndoUntil = performance.now() + 800;
  if ($("timeline").hasPointerCapture(e.pointerId))
    $("timeline").releasePointerCapture(e.pointerId);
  setTimeout(() => {
    suppressClick = false;
  }, 0);
  $("range-selection").hidden = true;
  if (d.mode === "scrub") seek(time);
  if (e.type === "pointercancel") {
    drawWindows();
    return;
  }
  if (d.mode === "range") {
    if (Math.abs(d.end - d.start) > 0.04)
      addCard(Math.min(d.start, d.end), Math.max(d.start, d.end));
  } else if (
    d.card &&
    Math.abs(d.start - d.original[0]) + Math.abs(d.end - d.original[1]) > 0.0001
  ) {
    try {
      d.card.range = moveRange(
        d.originalCard,
        d.originalFilm,
        state.spans,
        d.start,
        d.end,
      );
      if (
        d.mode === "resize" &&
        d.card.effects.card &&
        Object.keys(d.card.effects).length === 1
      )
        d.card.effects.card.for = d.end - d.start;
      changed(d.card);
    } catch (error) {
      editStatus(error.message, true);
      drawWindows();
    }
  } else if (d.resume && d.mode === "scrub") togglePlayback();
  drawWindows();
}
$("timeline").onpointerup = finishDrag;
$("timeline").onpointercancel = finishDrag;
$("sound").onchange = () => seek(time);
function togglePlayback() {
  if (!ready) {
    status("Playback is still loading.", true);
    return;
  }
  if (playing) {
    stop();
    return;
  }
  if (time >= film.duration) time = 0;
  if (editMode || picker) exitEdit();
  playing = true;
  previous = performance.now();
  playbackButtons();
  seek(time);
}
$("play").onclick = togglePlayback;
addEventListener("keydown", onKeyDown, true);
addEventListener("keyup", onKeyUp, true);
addEventListener("blur", () => {
  if (!scrub) return;
  scrub = null;
  seek(time);
});
addEventListener(
  "pointerdown",
  (e) => {
    keyboardEditing = false;
    if (e.target.closest?.("#timeline, #film")) document.activeElement?.blur?.();
  },
  true,
);
// A clicked button keeps focus; release it so Space and Enter stay shortcuts.
addEventListener("click", (e) => {
  const b = e.target.closest?.("button");
  if (b && e.detail > 0) b.blur();
});
$("reload").onclick = async () => {
  if (dirty && !confirm("Discard unsaved changes and reload?")) return;
  try {
    stop();
    generation++;
    clearTimeout(previewTimer);
    dirty = false;
    previewValid = true;
    undo.length = 0;
    display(await request("/api/state"), true);
    editStatus("Reloaded");
    status("");
  } catch (error) {
    editStatus(error.message, true);
  }
};
$("export").onclick = async () => {
  try {
    job(
      await post("/api/render", {
        revision: state.revision,
        preset: $("preset").value,
      }),
    );
  } catch (error) {
    editStatus(error.message, true);
  }
};
$("take").onchange = async () => {
  try {
    stop();
    editStatus("Switching take…");
    const data = await post("/api/take", {
      revision: state.revision,
      id: $("take").value,
    });
    generation++;
    undo.length = 0;
    time = 0;
    display(data, true);
    editStatus("Switched take");
  } catch (error) {
    $("take").value = state.takes.find((t) => t.current)?.id ?? "";
    editStatus(error.message, true);
  }
};
addEventListener("message", (e) => {
  if (e.source !== $("film").contentWindow || e.origin !== location.origin)
    return;
  if (e.data?.type === "demo-ready") {
    ready = true;
    $("sound").closest("label").hidden = !e.data.music;
    if (pendingPlan)
      $("film").contentWindow.postMessage(pendingPlan, location.origin);
    seek(time);
    status("");
    buttons();
  }
  if (e.data?.type === "demo-toggle-play") togglePlayback();
  // Keys pressed while the preview has focus.
  if (e.data?.type === "demo-key") {
    const forwarded = {
      ...e.data,
      target: document.body,
      preventDefault() {},
      stopPropagation() {},
    };
    (e.data.phase === "keyup" ? onKeyUp : onKeyDown)(forwarded);
  }
  if (e.data?.type === "demo-camera") {
    cameraPose = e.data;
    drawPlacement();
  }
  if (e.data?.type === "demo-error") {
    ready = false;
    status(e.data.message, true);
    editStatus(e.data.message, true);
  }
});
addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
function tick(now) {
  // Holding ← or → scrubs smoothly, speeding up the longer it is held.
  if (scrub && film) {
    const held = (now - scrub.since) / 1000;
    if (held > 0.28) {
      const rate = Math.min(6, 1 + (held - 0.28) * 2);
      seek(
        clamp(
          time + scrub.direction * rate * Math.min(0.05, (now - previous) / 1000),
          0,
          film.duration,
        ),
      );
    }
  }
  if (playing && film) {
    seek(
      Math.min(film.duration, time + Math.min(0.1, (now - previous) / 1000)),
    );
    if (time >= film.duration) stop();
  }
  previous = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
try {
  display(await request("/api/state"), true);
} catch (error) {
  editStatus(error.message, true);
}
setInterval(async () => {
  try {
    const latest = await request("/api/state");
    if (latest.revision !== state?.revision && !saving) {
      if (dirty) {
        stale = true;
        editStatus("Saved edits changed. Reload to continue.", true);
        buttons();
      } else {
        const at = retime(film, latest.film, time);
        const sameTake =
          state.takes.find((t) => t.current)?.id ===
            latest.takes.find((t) => t.current)?.id &&
          JSON.stringify(state.spans) === JSON.stringify(latest.spans);
        if (!sameTake) undo.length = 0;
        else if (JSON.stringify(state.edits) !== JSON.stringify(latest.edits))
          undo.push(snapshot());
        display(latest);
        applyFilm(latest.film, at);
        editStatus("");
      }
    } else {
      if (state) state.scrub = latest.scrub;
      job(latest.job);
    }
  } catch {
    editStatus("Disconnected. Reopen the preview.", true);
  }
}, 2500);
