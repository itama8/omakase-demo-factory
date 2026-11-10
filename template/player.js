// Review-only playback adapter. Export/Studio retain ownership of media.
// The composition's GSAP timeline is shared; this adapter supplies the clock.
if (new URLSearchParams(location.search).has("review")) {
  const root = document.getElementById("root");
  // A CSS transform changes the picture, but leaves its original layout
  // size behind. Contain that full-size canvas in the iframe's viewport
  // so shrinking it cannot create an invisible, scrollable document.
  Object.assign(document.documentElement.style, { overflow: "clip" });
  Object.assign(document.body.style, {
    position: "fixed",
    inset: "0",
    overflow: "clip",
  });
  const resize = () => {
    const width = Number(root.dataset.width),
      height = Number(root.dataset.height);
    const scale = Math.min(innerWidth / width, innerHeight / height);
    Object.assign(root.style, {
      position: "absolute",
      width: `${width}px`,
      height: `${height}px`,
      left: `${(innerWidth - width * scale) / 2}px`,
      top: `${(innerHeight - height * scale) / 2}px`,
      transformOrigin: "0 0",
      transform: `scale(${scale})`,
    });
    scrollTo(0, 0);
  };
  resize();
  addEventListener("resize", resize);
  new ResizeObserver(resize).observe(document.body);
  let media = [...document.querySelectorAll("video, audio")];
  let clips = [...document.querySelectorAll("[data-start][data-track-index]")];
  addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLMediaElement)
        parent.postMessage(
          {
            type: "demo-error",
            message:
              "The recording could not load. Reload the preview to retry.",
          },
          location.origin,
        );
    },
    true,
  );
  const saved = JSON.stringify(window.__film.pieces);
  function applyFilm(film) {
    for (const el of media) el.pause();
    const camera = document.getElementById("camera"),
      old = [...camera.querySelectorAll("video")];
    // Reuse decoders where possible: dragging a control should not reload
    // the recording or wait for another video render.
    film.pieces.forEach((piece, i) => {
      const el = old[i] ?? document.createElement("video");
      if (!old[i]) {
        el.src = "assets/take.mp4";
        el.muted = true;
        el.playsInline = true;
        camera.append(el);
      }
      el.id = `take-${i + 1}`;
      el.className = "clip take";
      Object.assign(el.dataset, {
        start: film.logo + piece.at,
        duration: (piece.b - piece.a) / piece.rate,
        mediaStart: piece.a,
        playbackRate: piece.rate,
        trackIndex: 0,
      });
    });
    old.slice(film.pieces.length).forEach((el) => el.remove());
    const oldAudio = [...document.querySelectorAll(".original-audio")];
    if (film.sourceAudio)
      film.pieces.forEach((piece, i) => {
        const el = oldAudio[i] ?? document.createElement("audio");
        if (!oldAudio[i]) {
          el.src = "assets/original.m4a";
          el.className = "original-audio";
          root.append(el);
        }
        el.id = `original-${i}`;
        Object.assign(el.dataset, {
          start: film.logo + piece.at,
          duration: (piece.b - piece.a) / piece.rate,
          mediaStart: piece.a,
          playbackRate: piece.rate,
          trackIndex: 5,
          volume: 1,
        });
      });
    oldAudio
      .slice(film.sourceAudio ? film.pieces.length : 0)
      .forEach((el) => el.remove());
    // The server draws the overlays from the plan, as it does for export.
    document.getElementById("marks").innerHTML = film.html.camera;
    document.getElementById("overlays").innerHTML = film.html.screen;
    const music = document.getElementById("music");
    if (music) music.dataset.duration = film.duration - film.logo;
    // The key sounds were mixed for the saved cut. Keep them quiet while an
    // unsaved preview has moved the keys.
    const sfx = document.getElementById("sfx");
    if (sfx) sfx.dataset.stale = String(JSON.stringify(film.pieces) !== saved);
    window.__film = film;
    window.__buildTimeline(film);
    media = [...document.querySelectorAll("video, audio")];
    clips = [...document.querySelectorAll("[data-start][data-track-index]")];
  }
  function seek(t, playing, sound, inspection) {
    window.__timelines.main.pause().seek(t, false);
    const effects = !playing && inspection?.effects;
    if (effects?.camera) {
      const f =
        effects.camera.camera === "wide"
          ? { on: [0.5, 0.5], zoom: 1 }
          : effects.camera.camera;
      const w = Number(root.dataset.width),
        h = Number(root.dataset.height),
        z = f.zoom;
      gsap.set("#camera", {
        scale: z,
        x: Math.max(w - w * z, Math.min(0, w / 2 - f.on[0] * w * z)),
        y: Math.max(h - h * z, Math.min(0, h / 2 - f.on[1] * h * z)),
      });
    }
    const show = (kind, entries, match) => {
      const i = entries.findIndex(
        (e) => e.start <= t && t < e.start + e.duration && match(e),
      );
      if (i >= 0) gsap.set(`#${kind}-${i}`, { opacity: 1, scale: 1, y: 0 });
    };
    if (effects?.caption)
      show(
        "caption",
        window.__film.captions,
        (c) => c.text === effects.caption.caption,
      );
    if (effects?.keys)
      show("keys", window.__film.keys, (k) => k.label === effects.keys.keys);
    if (effects?.highlight)
      show("highlight", window.__film.highlights, () => true);
    if (effects?.card && inspection.kind === "card")
      show("card", window.__film.cards, (c) => c.text === effects.card.card);
    // Report the rendered pose, including easing between automatic shots.
    // Reading the next shot's target would disagree with the visible crop.
    const zoom = Number(gsap.getProperty("#camera", "scaleX"));
    const width = Number(root.dataset.width),
      height = Number(root.dataset.height);
    parent.postMessage(
      {
        type: "demo-camera",
        time: t,
        zoom,
        x:
          (width / 2 - Number(gsap.getProperty("#camera", "x"))) /
          (width * zoom),
        y:
          (height / 2 - Number(gsap.getProperty("#camera", "y"))) /
          (height * zoom),
      },
      location.origin,
    );
    for (const el of clips) {
      const start = Number(el.dataset.start),
        duration = Number(el.dataset.duration);
      el.style.visibility =
        t >= start && t < start + duration ? "visible" : "hidden";
    }
    for (const el of media) {
      const start = Number(el.dataset.start),
        end = start + Number(el.dataset.duration),
        active = t >= start && t < end;
      const rate = Number(el.dataset.playbackRate ?? 1);
      const at =
        Number(el.dataset.mediaStart ?? 0) + Math.max(0, t - start) * rate;
      el.playbackRate = rate;
      el.muted =
        el.tagName === "VIDEO" || !sound || el.dataset.stale === "true";
      if (el.tagName === "AUDIO") {
        // Only the music fades out with the film.
        const fade =
          el.id === "music" ? Math.min(1, Math.max(0, (end - t) / 1.4)) : 1;
        el.volume = Number(el.dataset.volume ?? 1) * fade;
      }
      if (active && Math.abs(el.currentTime - at) > (playing ? 0.2 : 0.015))
        el.currentTime = at;
      if (active && playing && el.paused) el.play().catch(() => {});
      if ((!active || !playing) && !el.paused) el.pause();
    }
  }
  addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === "demo-plan") {
      try {
        applyFilm(event.data.film);
        seek(event.data.time ?? 0, false, !!event.data.sound);
        parent.postMessage(
          { type: "demo-applied", requestId: event.data.requestId },
          location.origin,
        );
      } catch (error) {
        parent.postMessage(
          { type: "demo-error", message: error.message },
          location.origin,
        );
      }
      return;
    }
    if (event.data?.type !== "demo-seek") return;
    const t = Number(event.data.time);
    if (Number.isFinite(t))
      seek(
        Math.min(window.__film.duration, Math.max(0, t)),
        !!event.data.playing,
        !!event.data.sound,
        event.data.inspection,
      );
  });
  addEventListener("keydown", (event) => {
    if (
      event.code === "Space" &&
      !event.repeat &&
      !event.target.closest(
        "input,textarea,select,button,a,[contenteditable=true]",
      )
    ) {
      event.preventDefault();
      parent.postMessage({ type: "demo-toggle-play" }, location.origin);
    }
  });
  try {
    seek(0, false, false);
    parent.postMessage(
      { type: "demo-ready", music: !!document.querySelector("audio") },
      location.origin,
    );
  } catch (error) {
    parent.postMessage(
      {
        type: "demo-error",
        message: "Playback could not load. Reload the preview to retry.",
      },
      location.origin,
    );
  }
}
