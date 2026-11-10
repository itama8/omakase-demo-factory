import { retime, filmTime } from "./edits.js";
import { timelineSpans } from "./timeline.js";
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
const clock = (t) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
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
  if (ready)
    $("film").contentWindow.postMessage(
      {
        type: "demo-seek",
        time,
        playing,
        sound: $("sound").checked,
        inspection: inspection(),
      },
      location.origin,
    );
}
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
      el.onkeydown = (e) => {
        if (e.key === "Enter") {
          activate(card);
          e.preventDefault();
        }
      };
    }
    el.title = `${
      Object.keys(card.effects)
        .map((k) => EFFECTS[k])
        .join(" + ") || "Edit"
    } · ${start.toFixed(2)}–${end.toFixed(2)}s · Drag to move; Alt bypasses snapping`;
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
  return `${a.toFixed(2)}–${b.toFixed(2)}s`;
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
    el.querySelectorAll("[data-range]").forEach((input, i) => {
      if (document.activeElement !== input) input.value = number(times[i]);
      input.max = number(film.duration);
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
function cameraGrid(parent, card, effect) {
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
  const box = node("fieldset", { "data-effect": kind });
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
    let refresh = () => {};
    input(
      box,
      "Zoom (×)",
      effect.camera === "wide" ? 1 : effect.camera.zoom,
      (v) => {
        if (effect.camera === "wide") effect.camera = { on: [0.5, 0.5] };
        effect.camera.zoom = v;
        refresh();
        changed(card);
      },
      { min: "1", max: "4", step: ".05" },
    );
    refresh = cameraGrid(box, card, effect);
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
    input(
      box,
      "Duration (seconds)",
      effectSeconds(effect.for),
      (v) => mutate("for", v),
      { min: ".2", max: "10", step: ".1" },
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
      range = node("div", { class: "pair range-inputs" });
    el.append(body);
    body.append(range);
    const times = cardTimes(card, film, state.spans);
    ["Start (seconds)", "End (seconds)"].forEach((name, i) => {
      const inputEl = input(range, name, number(times[i]), () => {}, {
        min: "0",
        step: ".01",
        "data-range": i === 0 ? "start" : "end",
      });
      inputEl.addEventListener("change", () => {
        const values = [...range.querySelectorAll("input")].map((x) =>
          Number(x.value),
        );
        try {
          card.range = moveRange(card, film, state.spans, ...values);
          if (card.effects.card && Object.keys(card.effects).length === 1)
            card.effects.card.for = values[1] - values[0];
          active = card.id;
          changed(card);
        } catch (error) {
          dirty = true;
          editStatus(error.message, true);
          previewValid = false;
          buttons();
        }
      });
    });
    const effectList = node("div", { class: "effect-list" });
    body.append(effectList);
    for (const [kind, effect] of Object.entries(card.effects))
      renderEffect(effectList, card, kind, effect);
    const add = node("select", { "aria-label": "Add effect" });
    add.add(new Option("Add an effect…", ""));
    for (const [kind, name] of Object.entries(EFFECTS))
      if (kind !== "transition" && !card.effects[kind])
        add.add(new Option(name, kind));
    add.onchange = () => {
      const kind = add.value;
      if (!kind) return;
      card.effects[kind] = defaultEffect(kind);
      active = card.id;
      placementKind = kind;
      if (kind === "camera") card.effects[kind].for = 0.001;
      changed(card, true);
    };
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
    del.onclick = () => {
      cards = cards.filter((c) => c !== card);
      if (active === card.id) active = cards.at(-1)?.id ?? null;
      dirty = true;
      localVersion++;
      previewValid = true;
      renderCards();
      preview();
    };
    actions.append(jump, del);
    body.append(actions);
    $("edit-cards").append(el);
  }
  updateRanges();
  drawPlacement();
  buttons();
}
function addCard(start = time, end = Math.min(film.duration, time + 3)) {
  stop();
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
    renderCards();
    editStatus("Choose one or more effects for this range.");
    document
      .querySelector(`[data-card="${card.id}"] select`)
      ?.focus({ preventScroll: true });
  } catch (error) {
    editStatus(error.message, true);
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
    pendingPlan = null;
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
  playing = true;
  previous = performance.now();
  playbackButtons();
  seek(time);
}
$("play").onclick = togglePlayback;
addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    !e.repeat &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.target.closest("input,textarea,select,button,a,[contenteditable=true]")
  ) {
    e.preventDefault();
    togglePlayback();
  }
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
    } else job(latest.job);
  } catch {
    editStatus("Disconnected. Reopen the preview.", true);
  }
}, 2500);
