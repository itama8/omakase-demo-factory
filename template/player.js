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
  const MEDIA = "video:not(#scrub-proxy), audio";
  let media = [...document.querySelectorAll(MEDIA)];
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
    media = [...document.querySelectorAll(MEDIA)];
    clips = [...document.querySelectorAll("[data-start][data-track-index]")];
  }
  // Scrubbing asks for a new frame on every pointer move. A decoder can only
  // seek one at a time, so keep just the latest request while one is in
  // flight instead of queueing a backlog the picture has to catch up with.
  const pending = new WeakMap();
  const target = (el) =>
    pending.has(el) ? pending.get(el) : el.seeking ? el._seekTo : el.currentTime;
  function seekMedia(el, at) {
    if (!el._coalesced) {
      el._coalesced = true;
      el.addEventListener("seeked", () => {
        if (!pending.has(el)) return;
        const next = pending.get(el);
        pending.delete(el);
        if (Math.abs(el.currentTime - next) > 0.001) {
          el._seekTo = next;
          el.currentTime = next;
        }
      });
    }
    if (el.seeking) {
      pending.set(el, at);
      return;
    }
    el._seekTo = at;
    el.currentTime = at;
  }
  // While scrubbing, a light copy of the take with dense keyframes stands in
  // for the full one, on top of it inside #camera so zoom and crop still
  // apply. Once the playhead settles the full take seeks once and the copy
  // steps aside.
  let proxy = null,
    proxyOn = false,
    settling = 0;
  function useProxy(url) {
    if (!url || proxy?.dataset.url === url) return;
    proxy?.remove();
    proxy = document.createElement("video");
    Object.assign(proxy, { id: "scrub-proxy", className: "take", muted: true, playsInline: true, preload: "auto", src: url });
    proxy.dataset.url = url;
    proxy.style.visibility = "hidden";
    proxyOn = false;
    document.getElementById("camera").append(proxy);
  }
  function settled(el, done) {
    if (!el.seeking && !pending.has(el)) done();
    else el.addEventListener("seeked", () => settled(el, done), { once: true });
  }
  function seek(t, playing, sound, inspection, scrubbing = false) {
    const quick = scrubbing && !playing && proxy?.readyState >= 1;
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
    let shown = null,
      shownAt = 0;
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
      if (el.tagName === "VIDEO" && active) {
        shown = el;
        shownAt = at;
      }
      if (!quick && active && Math.abs(target(el) - at) > (playing ? 0.2 : 0.015))
        seekMedia(el, at);
      if (active && playing && el.paused) el.play().catch(() => {});
      if ((!active || !playing) && !el.paused) el.pause();
    }
    if (quick && shown) {
      const takes = [...document.querySelectorAll("#camera video.take:not(#scrub-proxy)")];
      if (takes.at(-1)?.nextElementSibling !== proxy) takes.at(-1)?.after(proxy);
      if (Math.abs(target(proxy) - shownAt) > 0.01) seekMedia(proxy, shownAt);
      proxy.style.visibility = "visible";
      proxyOn = true;
      settling++;
    } else if (proxyOn) {
      const generation = ++settling;
      const hide = () => {
        if (generation !== settling) return;
        proxy.style.visibility = "hidden";
        proxyOn = false;
      };
      if (shown) settled(shown, hide);
      else hide();
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
    useProxy(event.data.scrub);
    const t = Number(event.data.time);
    if (Number.isFinite(t))
      seek(
        Math.min(window.__film.duration, Math.max(0, t)),
        !!event.data.playing,
        !!event.data.sound,
        event.data.inspection,
        !!event.data.scrubbing,
      );
  });
  // The review page owns every shortcut; hand keys on to it when the film has focus.
  const forward = (event) => {
    if (
      event.target.closest?.("input,textarea,select,[contenteditable=true]")
    )
      return;
    if (
      event.code === "Space" ||
      /^(Arrow|Page|Home$|End$)/.test(event.key)
    )
      event.preventDefault();
    const { key, code, ctrlKey, shiftKey, altKey, metaKey, repeat } = event;
    parent.postMessage(
      { type: "demo-key", phase: event.type, key, code, ctrlKey, shiftKey, altKey, metaKey, repeat },
      location.origin,
    );
  };
  addEventListener("keydown", forward);
  addEventListener("keyup", forward);
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
