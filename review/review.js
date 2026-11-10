import { editMoment, filmTime, retime, settingsFor } from "./edits.js";
import { timelineSpans } from "./timeline.js";
import { mountCameraGrid } from "./camera-grid.js";
const $ = (id) => document.getElementById(id);
const cameraGrid = mountCameraGrid();
let state,
  film,
  time = 0,
  playing = false,
  previous = performance.now(),
  saving = false,
  dirty = false;
let ready = false,
  previewTimer,
  generation = 0,
  stale = false,
  pendingPlan = null,
  previewValid = true;
const changed = new Set(),
  undo = [],
  drafts = new Map();
let timelineItems = [];
const clock = (t) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const label = (id) =>
  id
    .split("/")
    .map((part) => part.replaceAll("-", " "))
    .join(" / ");
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
  $("save").disabled = !dirty || busy || stale || !previewValid;
  $("discard").disabled = !dirty || saving;
  $("undo").disabled = !undo.length || busy || dirty;
  $("export").disabled = dirty || busy || stale;
  $("export").title = dirty ? "Save or discard the preview changes first" : "";
  cameraGrid.refresh();
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
  paintTimeline();
  syncCaption();
  if (ready)
    $("film").contentWindow.postMessage(
      { type: "demo-seek", time, playing, sound: $("sound").checked },
      location.origin,
    );
}
function stop() {
  const wasPlaying = playing;
  playing = false;
  playbackButtons();
  if (wasPlaying) editStatus(dirty ? "Unsaved preview" : "Paused");
  seek(time);
}
function playbackButtons() {
  for (const [id, active, action] of [
    ["play", playing, playing ? "Pause playback" : "Play full video"],
  ]) {
    $(id).dataset.playing = String(active);
    $(id).setAttribute("aria-label", action);
    $(id).title = action;
  }
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
}
function settings() {
  return {
    start: Number($("trim-start").value),
    end: Number($("trim-end").value),
    speed: $("speed").value,
    caption: $("caption").value,
    position: $("position").value,
    removed: $("cut").checked,
    camera: changed.has("auto-camera")
      ? null
      : {
          on: [Number($("camera-x").value), Number($("camera-y").value)],
          zoom: Number($("zoom").value),
        },
  };
}
function remember() {
  if (!state || !dirty) return;
  drafts.set($("span").value, { settings: settings(), changed: [...changed] });
}
function proposed() {
  let edits = structuredClone(state.edits);
  for (const [id, draft] of drafts)
    edits = editMoment(
      edits,
      id,
      state.spans[id].end - state.spans[id].start,
      draft.settings,
      new Set(draft.changed),
    );
  return edits;
}
function syncCaption() {
  if (!film || changed.has("caption")) return;
  const caption = film.captions.findLast(
    (c) => c.start <= time && time < c.start + c.duration,
  );
  $("caption").value = caption?.text ?? "";
  $("position").value = caption?.position ?? "bottom";
}
function loadControls(id) {
  const span = state.spans[id],
    duration = span.end - span.start,
    draft = drafts.get(id);
  const values = draft?.settings ?? settingsFor(state.edits, id, duration);
  changed.clear();
  for (const kind of draft?.changed ?? []) changed.add(kind);
  $("trim-start").value = Number(values.start.toFixed(3));
  $("trim-end").value = Number(values.end.toFixed(3));
  $("trim-start").max = Number(duration.toFixed(3));
  $("trim-end").max = Number(duration.toFixed(3));
  $("speed").value = String(values.speed);
  $("cut").checked = values.removed;
  const at = filmTime(state.film, span.start + Math.min(0.8, duration / 2));
  const caption = state.film.captions.find(
    (c) => c.start <= at && at < c.start + c.duration,
  );
  $("caption").value = values.caption ?? caption?.text ?? "";
  $("position").value =
    values.caption !== null ? values.position : (caption?.position ?? "bottom");
  const automatic = state.film.shots.findLast((shot) => shot.t <= at)
    ?.frame ?? { x: 0.5, y: 0.5, zoom: 1 };
  const camera =
    values.camera === "wide"
      ? { on: [0.5, 0.5], zoom: 1 }
      : (values.camera ?? {
          on: [automatic.x, automatic.y],
          zoom: automatic.zoom,
        });
  $("zoom").value = camera.zoom ?? 1.4;
  $("camera-x").value = camera.on[0];
  $("camera-y").value = camera.on[1];
  $("zoom-value").textContent = `${Number($("zoom").value).toFixed(2)}×`;
}
function select(id, at = null) {
  stop();
  // Instantaneous actions can be jumped to, while their scene owns edits.
  if (![...$("span").options].some((option) => option.value === id))
    id = id.split("/")[0];
  $("span").value = id;
  loadControls(id);
  const span = state.spans[id];
  seek(
    at ??
      filmTime(film, span.start + Math.min(0.8, (span.end - span.start) / 2)),
  );
  $("timeline-menu").hidden = true;
  editStatus(dirty ? "Unsaved preview" : "Changes preview instantly.");
  buttons();
}
function paintTimeline() {
  if (!film) return;
  $("playhead").style.left = `${(100 * time) / film.duration}%`;
  const selected = $("span").value;
  for (const { element, start, end, id } of timelineItems) {
    const current = start <= time && time < end;
    element.classList.toggle("is-current", current);
    element.classList.toggle(
      "is-selected",
      !!id && (id === selected || selected.startsWith(id + "/")),
    );
    element.setAttribute("aria-current", String(current));
  }
}
function renderTimeline() {
  if (!state || !film) return;
  const { scenes, steps, markers } = timelineSpans(state.spans, film);
  $("scenes").replaceChildren();
  $("steps").replaceChildren();
  $("timeline-menu").hidden = true;
  timelineItems = [];
  const block = (entry, row, name = label(entry.id).split(" / ").at(-1)) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "timeline-block";
    element.textContent = name;
    element.title = `${label(entry.id)} · ${entry.start.toFixed(2)}–${entry.end.toFixed(2)}s`;
    element.setAttribute("aria-label", `Jump to ${label(entry.id)}`);
    element.dataset.span = entry.id;
    element.style.left = `${(100 * entry.start) / film.duration}%`;
    element.style.width = `${(100 * (entry.end - entry.start)) / film.duration}%`;
    element.onclick = () => select(entry.id, entry.start);
    row.append(element);
    timelineItems.push({ ...entry, element });
    return element;
  };
  if (film.logo > 0) {
    const intro = block(
      { id: "intro", start: 0, end: film.logo },
      $("scenes"),
      "Intro",
    );
    intro.onclick = () => {
      stop();
      seek(0);
    };
  }
  scenes.forEach((entry) => block(entry, $("scenes")));
  steps.forEach((entry) => block(entry, $("steps")));
  for (const marker of markers) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "timeline-marker";
    element.style.left = `${(100 * marker.start) / film.duration}%`;
    element.textContent = "·";
    element.title = marker.entries.map((entry) => label(entry.id)).join("\n");
    element.setAttribute(
      "aria-label",
      marker.entries.length === 1
        ? `Jump to ${label(marker.entries[0].id)}`
        : `${marker.entries.length} short steps in ${marker.scene}`,
    );
    element.onclick = () => {
      if (marker.entries.length === 1) {
        select(marker.entries[0].id, marker.entries[0].start);
        return;
      }
      stop();
      const menu = $("timeline-menu");
      menu.replaceChildren();
      for (const entry of marker.entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label(entry.id).split(" / ").at(-1);
        button.setAttribute("aria-label", `Jump to ${label(entry.id)}`);
        button.onclick = () => select(entry.id, entry.start);
        menu.append(button);
      }
      const width = $("timeline").clientWidth;
      menu.style.left = `${Math.max(0, Math.min(width - 180, (marker.start / film.duration) * width))}px`;
      menu.hidden = false;
      menu.querySelector("button").focus({ preventScroll: true });
    };
    $("steps").append(element);
  }
  paintTimeline();
}
function display(data, reloadFilm = false) {
  const selected = $("span").value;
  state = data;
  film = data.film;
  stale = false;
  document.title = `${data.name} · Demo review`;
  $("title").textContent = data.name.replaceAll("-", " ");
  $("span").replaceChildren();
  for (const [id, span] of Object.entries(data.spans)) {
    if (span.end - span.start < 0.04) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${label(id)} · ${(span.end - span.start).toFixed(1)}s`;
    $("span").append(option);
  }
  renderTimeline();
  $("edits").replaceChildren();
  $("edit-count").textContent = `(${data.edits.length})`;
  data.edits.forEach((edit, index) => {
    const item = document.createElement("li"),
      remove = document.createElement("button");
    const kind = ["cut", "speed", "camera", "caption"].find((k) => k in edit);
    const detail =
      kind === "camera"
        ? "Framing"
        : kind === "speed"
          ? `${edit.speed}× speed`
          : kind === "cut"
            ? "Removed"
            : edit.caption || "No caption";
    item.append(
      document.createTextNode(
        `${detail} · ${label(String(edit.over ?? edit.cut).split("@")[0])}`,
      ),
    );
    remove.textContent = "Remove";
    remove.type = "button";
    remove.onclick = () => save(data.edits.filter((_, i) => i !== index));
    item.append(remove);
    $("edits").append(item);
  });
  if (reloadFilm) {
    ready = false;
    pendingPlan = null;
    $("film").src = `/project/index.html?review=1&v=${data.revision}`;
  }
  select(
    [...$("span").options].some((o) => o.value === selected)
      ? selected
      : $("span").options[0].value,
  );
  job(data.job);
}
function job(value) {
  if (state) state.job = value;
  $("download").hidden = !(value?.state === "ready" && value.current && !dirty);
  $("log").textContent = value?.log || "No export running.";
  if (value?.state === "running") status("Exporting MP4…");
  else if (value?.state === "failed")
    status("Export failed. See Export progress.", true);
  buttons();
}
async function preview() {
  clearTimeout(previewTimer);
  remember();
  const id = ++generation;
  try {
    const edits = proposed();
    const result = await post("/api/preview", {
      revision: state.revision,
      edits,
    });
    if (id !== generation) return false;
    previewValid = true;
    stop();
    const values = settings();
    const at = retime(film, result.film, time);
    applyFilm(result.film, at);
    if (changed.has("auto-camera")) {
      const automatic = result.film.shots.findLast((shot) => shot.t <= time)
        ?.frame ?? { x: 0.5, y: 0.5, zoom: 1 };
      $("zoom").value = automatic.zoom;
      $("camera-x").value = automatic.x;
      $("camera-y").value = automatic.y;
      $("zoom-value").textContent = `${Number($("zoom").value).toFixed(2)}×`;
    }
    editStatus(
      values.removed
        ? "Removed from preview · not saved"
        : dirty
          ? "Unsaved preview"
          : "Saved",
    );
    buttons();
    return true;
  } catch (error) {
    if (id === generation) {
      previewValid = false;
      editStatus(error.message, true);
      buttons();
    }
    return false;
  }
}
async function save(edits = null, restoring = false) {
  clearTimeout(previewTimer);
  remember();
  if (saving || stale) return;
  try {
    edits ??= proposed();
    saving = true;
    buttons();
    stop();
    editStatus("Saving…");
    const before = structuredClone(state.edits),
      data = await post("/api/edit", { revision: state.revision, edits });
    const at = retime(film, data.film, time);
    if (!restoring) undo.push(before);
    else undo.pop();
    generation++;
    dirty = false;
    drafts.clear();
    changed.clear();
    previewValid = true;
    display(data);
    applyFilm(data.film, at);
    editStatus("Saved");
    status("");
  } catch (error) {
    editStatus(error.message, true);
  } finally {
    saving = false;
    buttons();
  }
}
const kinds = {
  "trim-start": "trim",
  "trim-end": "trim",
  cut: "trim",
  speed: "speed",
  caption: "caption",
  position: "caption",
  zoom: "camera",
  "camera-x": "camera",
  "camera-y": "camera",
};
$("editor").addEventListener("input", (event) => {
  const kind = kinds[event.target.id];
  if (!kind) return;
  if (kind === "camera") changed.delete("auto-camera");
  changed.add(kind);
  dirty = true;
  previewValid = false;
  remember();
  $("zoom-value").textContent = `${Number($("zoom").value).toFixed(2)}×`;
  editStatus("Updating preview…");
  buttons();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => preview(), 160);
});
$("editor").onsubmit = (event) => {
  event.preventDefault();
  save();
};
$("auto-camera").onclick = () => {
  changed.add("camera");
  changed.add("auto-camera");
  dirty = true;
  remember();
  buttons();
  preview();
};
$("discard").onclick = () => {
  generation++;
  clearTimeout(previewTimer);
  stop();
  dirty = false;
  drafts.clear();
  changed.clear();
  previewValid = true;
  const at = retime(film, state.film, time);
  film = state.film;
  loadControls($("span").value);
  applyFilm(state.film, at);
  editStatus("Discarded");
  buttons();
};
$("undo").onclick = () => {
  if (undo.length) save(undo.at(-1), true);
};
$("span").onchange = () => select($("span").value);
$("seek").oninput = () => {
  seek(Number($("seek").value));
};
let timelineDrag = null;
const scrubTimeline = (clientX) => {
  const rect = $("timeline").getBoundingClientRect();
  seek(((clientX - rect.left) / rect.width) * film.duration);
};
$("timeline").addEventListener("pointerdown", (event) => {
  if (
    !film ||
    event.button !== 0 ||
    event.target.closest("button, input, #timeline-menu")
  )
    return;
  event.preventDefault();
  timelineDrag = { pointerId: event.pointerId, resume: playing };
  stop();
  $("timeline-menu").hidden = true;
  $("timeline").setPointerCapture(event.pointerId);
  scrubTimeline(event.clientX);
});
$("timeline").addEventListener("pointermove", (event) => {
  if (timelineDrag?.pointerId === event.pointerId) scrubTimeline(event.clientX);
});
const finishTimelineDrag = (event) => {
  if (timelineDrag?.pointerId !== event.pointerId) return;
  const resume = timelineDrag.resume;
  timelineDrag = null;
  if ($("timeline").hasPointerCapture(event.pointerId))
    $("timeline").releasePointerCapture(event.pointerId);
  if (resume && time < film.duration && event.type !== "pointercancel") {
    playing = true;
    previous = performance.now();
    playbackButtons();
    seek(time);
  }
};
$("timeline").addEventListener("pointerup", finishTimelineDrag);
$("timeline").addEventListener("pointercancel", finishTimelineDrag);
document.addEventListener("pointerdown", (event) => {
  if (!$("timeline").contains(event.target)) $("timeline-menu").hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("timeline-menu").hidden = true;
});
$("sound").onchange = () => seek(time);
$("play").onclick = () => {
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
};
$("reload").onclick = async () => {
  if (dirty && !confirm("Discard unsaved preview changes and reload?")) return;
  try {
    stop();
    generation++;
    dirty = false;
    drafts.clear();
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
    job(await post("/api/render", { revision: state.revision }));
  } catch (error) {
    editStatus(error.message, true);
  }
};
addEventListener("message", (event) => {
  if (
    event.source !== $("film").contentWindow ||
    event.origin !== location.origin
  )
    return;
  if (event.data?.type === "demo-ready") {
    ready = true;
    $("sound").closest("label").hidden = !event.data.music;
    if (pendingPlan)
      $("film").contentWindow.postMessage(pendingPlan, location.origin);
    seek(time);
    status("");
    buttons();
  }
  if (event.data?.type === "demo-camera") {
    // Keep an in-progress camera edit stable until its preview is applied.
    // Other edits must not prevent automatic framing from following playback.
    if (changed.has("camera") && !changed.has("auto-camera")) return;
    const camera = event.data;
    if (Math.abs(camera.time - time) > 0.15) return;
    if (![camera.zoom, camera.x, camera.y].every(Number.isFinite)) return;
    $("zoom").value = camera.zoom;
    $("camera-x").value = camera.x;
    $("camera-y").value = camera.y;
    $("zoom-value").textContent = `${camera.zoom.toFixed(2)}×`;
    cameraGrid.refresh();
  }
  if (event.data?.type === "demo-error") {
    ready = false;
    editStatus(event.data.message, true);
    status(event.data.message, true);
    buttons();
  }
});
addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function tick(now) {
  if (playing && film) {
    const end = film.duration;
    seek(Math.min(end, time + Math.min(0.1, (now - previous) / 1000)));
    if (time >= end) stop();
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
        const at = time;
        display(latest);
        applyFilm(latest.film, at);
        editStatus("Updated");
      }
    } else job(latest.job);
  } catch {
    editStatus("Disconnected. Reopen the preview.", true);
  }
}, 2500);
