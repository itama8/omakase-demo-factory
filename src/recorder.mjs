// The recorder: drive the real Omakase app at human pace on a private X
// display, record that display, and log every beat with its time and screen
// box. The director reads the log to place the camera, so a screenplay never
// has to describe where things are. Nothing here knows what Omakase's UI
// looks like; that knowledge lives in the action vocabulary.
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const MODIFIERS = {
  Ctrl: { key: "Control", code: "ControlLeft", vk: 17, bit: 2 },
  Shift: { key: "Shift", code: "ShiftLeft", vk: 16, bit: 8 },
  Alt: { key: "Alt", code: "AltLeft", vk: 18, bit: 1 },
  Meta: { key: "Meta", code: "MetaLeft", vk: 91, bit: 4 }
};
const NAMED = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
// US layout: the shifted symbol and the key it sits on.
const SHIFTED = { "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/" };
const SYMBOLS = { "`": ["Backquote", 192], "-": ["Minus", 189], "=": ["Equal", 187], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "\\": ["Backslash", 220], ";": ["Semicolon", 186], "'": ["Quote", 222], ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], " ": ["Space", 32] };

/** The physical key that produces `char`, and whether Shift is held. */
export function keyFor(char) {
  if (char === "\n" || char === "Enter") return { key: "Enter", code: "Enter", vk: 13, shift: false, text: "\r" };
  if (char === "Space") return keyFor(" ");
  if (char in NAMED) return { key: char, code: char, vk: NAMED[char], shift: false };
  if (/^[a-z]$/i.test(char)) return { key: char, code: `Key${char.toUpperCase()}`, vk: char.toUpperCase().charCodeAt(0), shift: char !== char.toLowerCase(), text: char };
  if (/^\d$/.test(char)) return { key: char, code: `Digit${char}`, vk: char.charCodeAt(0), shift: false, text: char };
  const base = SHIFTED[char] ?? char;
  if (/^\d$/.test(base)) return { key: char, code: `Digit${base}`, vk: base.charCodeAt(0), shift: true, text: char };
  if (!(base in SYMBOLS)) throw new Error(`No key known for ${JSON.stringify(char)}`);
  return { key: char, code: SYMBOLS[base][0], vk: SYMBOLS[base][1], shift: char in SHIFTED, text: char };
}

// Seeded, so a take's rhythm is the same on every run.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startDisplay(width, height) {
  return new Promise((resolve, reject) => {
    // -displayfd makes Xvfb pick a free display and report its number.
    const server = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", `${width}x${height}x24`, "-noreset", "-nocursor"], { stdio: ["ignore", "ignore", "pipe", "pipe"] });
    let errors = "";
    server.stderr.on("data", (chunk) => { errors += chunk; });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Xvfb exited early (code ${code}): ${errors.trim()}`)));
    server.stdio[3].once("data", (chunk) => resolve({ display: `:${String(chunk).trim()}`, stop: () => server.kill("SIGTERM") }));
  });
}

function startRecording({ display, width, height, fps, file }) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-y", "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(fps), "-video_size", `${width}x${height}`, "-i", display,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", "-g", String(fps), file
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let log = "";
    let done = false;
    const exited = new Promise((resolveExit) => ffmpeg.once("exit", resolveExit));
    ffmpeg.once("error", reject);
    ffmpeg.stderr.on("data", (chunk) => {
      log = (log + chunk).slice(-20_000);
      // x11grab stamps frames with wall-clock time, and ffmpeg prints the
      // first stamp as the input's start. That is the take's clock origin.
      const start = !done && log.match(/start: (\d+\.\d+)/);
      if (!start || !/frame=\s*\d+/.test(log)) return;
      done = true;
      resolve({
        startMs: Number(start[1]) * 1000,
        log: () => log,
        async stop() {
          ffmpeg.stdin.write("q");
          await Promise.race([exited, delay(10_000).then(() => ffmpeg.kill("SIGKILL"))]);
        }
      });
    });
    exited.then((code) => { if (!done) reject(new Error(`ffmpeg stopped before recording (code ${code}):\n${log}`)); });
  });
}

async function seedVault(source, vault) {
  // The app dates a note by when its file was made, which here is this
  // minute for every note. A vault that was written over a few weeks has
  // days to browse, so date the notes back from yesterday: three that day,
  // then one a day with every third day off.
  const created = {};
  const noon = new Date().setHours(12, 0, 0, 0);
  let count = 0;
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const notes = (await readdir(path.join(source, entry.name))).filter((name) => name.endsWith(".md")).sort();
    if (!notes.length) continue;
    await mkdir(path.join(vault, entry.name), { recursive: true });
    for (const note of notes) {
      await cp(path.join(source, entry.name, note), path.join(vault, entry.name, note));
      const daysAgo = count < 3 ? 1 : count - 1 + Math.floor((count - 2) / 3);
      created[path.join(vault, entry.name, note)] = noon - daysAgo * 86_400_000 - count * 60_000;
      count += 1;
    }
  }
  await mkdir(path.join(vault, ".omakase", "state"), { recursive: true });
  await writeFile(path.join(vault, ".omakase", "state", "note-order.json"), JSON.stringify(created, null, 2));
}

/**
 * Record one take of `scenario` and write `take.mp4` and `take.json` to `outDir`.
 *
 * A scenario has `prepare(stage)`, which runs before the camera rolls, and
 * `perform(stage)`, which is the recorded performance. A compiled screenplay
 * is a scenario.
 *
 * `pace` scales every human delay. At 0 the scenario runs as fast as the app
 * answers, which turns it into a check: only its waits and assertions remain.
 */
export async function recordTake({ scenario, omakaseRoot, outDir, width = 1280, height = 720, scale = 2, fps = 30, seed = 7, record = true, pace = 1 }) {
  // The app session resolves dist/ and electron from the working directory.
  process.chdir(omakaseRoot);
  const { launchApp, electronExpression, editorReady } = await import(pathToFileURL(path.join(omakaseRoot, "scripts/app-session.mjs")).href);
  if (record) await mkdir(outDir, { recursive: true });
  // Checks rebuild dist/ under this lock. Holding it keeps a build from
  // replacing the app in the middle of a take. Under the runner it is already held.
  const lock = process.env.OMAKASE_CHECK === "1" ? { release() {} } : await (await import(pathToFileURL(path.join(omakaseRoot, "scripts/check.mjs")).href))
    .acquireLock(process.env.OMAKASE_CHECK_LOCK ?? path.join(os.tmpdir(), "omakase-check", `lock-${omakaseRoot.replace(/[^\w.-]+/g, "_")}`));
  const pixels = { width: width * scale, height: height * scale };
  // Under `npm run check` the runner already owns an isolated display.
  const screen = process.env.OMAKASE_CHECK === "1" && !record ? { display: process.env.DISPLAY, stop() {} } : await startDisplay(pixels.width, pixels.height);
  // Electron prefers Wayland whenever WAYLAND_DISPLAY is set, which would put
  // the window on the live desktop instead of the recorded one.
  delete process.env.WAYLAND_DISPLAY;
  Object.assign(process.env, { DISPLAY: screen.display, XDG_SESSION_TYPE: "x11", ELECTRON_OZONE_PLATFORM_HINT: "x11", GDK_SCALE: "1" });
  // A human delay, scaled by the pace. Waits on the app are never scaled.
  const rest = (ms) => pace > 0 ? delay(ms * pace) : undefined;

  const random = mulberry32(seed);
  const beats = [];
  let app, recording, sushi, clock = null;
  let profilePath;
  try {
    // Sushi scenes answer from a scripted local model server instead of a
    // real provider: the demo profile has no credentials. The real runtime
    // still runs every tool the script calls.
    if (scenario.sushi) {
      const { startFakeModelProvider, configureFakeModelProvider } = await import(pathToFileURL(path.join(omakaseRoot, "scripts/fixtures/fake-model-provider.mjs")).href);
      sushi = { script: scenario.sushi, configure: configureFakeModelProvider };
      sushi.server = await startFakeModelProvider((request, count) => scenario.sushi.respond(request, { count, pace, rest: (ms) => rest(ms) ?? Promise.resolve() }));
    }
    app = await launchApp({
      prefix: "omakase-demo-", main: true, args: [`--force-device-scale-factor=${scale}`],
      env: scenario.voiceFixture ? { OMAKASE_VOICE_USE_FIXTURE: "1" } : {},
      setup: async (profile) => {
        profilePath = profile;
        if (scenario.vault) await seedVault(scenario.vault, path.join(profile, "vault"));
        if (sushi) {
          await sushi.configure(profile, sushi.server.baseUrl);
          await sushi.script.setup?.(profile);
        }
        const configPath = path.join(profile, "omakase.config.json");
        let config = await readFile(configPath, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return {}; throw error; });
        if (scenario.liveProvider) {
          if (!process.env.OMAKASE_PROFILE) throw new Error("sushi: live needs OMAKASE_PROFILE pointing at your saved Omakase profile");
          const real = path.resolve(process.env.OMAKASE_PROFILE);
          const saved = JSON.parse(await readFile(path.join(real, "omakase.config.json"), "utf8"));
          await cp(path.join(real, "secrets/pi-agent"), path.join(profile, "secrets/pi-agent"), { recursive: true });
          config.sushi = saved.sushi;
        }
        if (scenario.appearance) config.appearance = { ...config.appearance, ...scenario.appearance };
        if (scenario.liveProvider || scenario.appearance) await writeFile(configPath, JSON.stringify(config));
      }
    });
    await app.evaluateMain(`${electronExpression}.BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: ${width}, height: ${height} }), true`);
    // A recording needs the window to cover the screen exactly. A check only
    // needs it close: X can settle a pixel short when nothing is being filmed.
    const slack = record ? 0 : 2;
    await app.until(`window is ${width}x${height}`, () => app.evaluate(`Math.abs(innerWidth - ${width}) <= ${slack} && Math.abs(innerHeight - ${height}) <= ${slack}`));

    let held = 0;
    const send = (type, key, extra = {}) => app.send("Input.dispatchKeyEvent", { type, key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, modifiers: held, ...extra });
    const stage = {
      app, width, height, random, pace, profile: profilePath, dir: scenario.dir, electron: electronExpression,
      action: (name, args) => scenario.action(name, stage, args),
      /** Seconds since the first recorded frame. */
      now: () => clock === null ? 0 : (Date.now() - clock) / 1000,
      /** Log a beat. Boxes are fractions of the window, so the log does not depend on resolution. */
      beat(type, data = {}) { const entry = { t: Number(stage.now().toFixed(3)), type, ...data }; beats.push(entry); return entry; },
      pause: (ms) => rest(ms),
      /** Wait for a renderer expression to become truthy. */
      until: (label, expression, options) => app.until(label, () => app.evaluate(expression), options),
      /** Log a beat that carries the box of `selector`, for the camera to frame. */
      async show(type, selector, data = {}) { return stage.beat(type, { ...data, box: await stage.box(selector) }); },
      /** Save a screenshot during a rehearsal. Does nothing in a take or a check. */
      async shot(name) { if (!record && pace > 0) console.log(`  shot ${name}: ${await app.screenshot(`demo-${name.replace(/[^\w.-]+/g, "-")}`)}`); },
      /**
       * Run one named span of the performance. Its start and end are logged,
       * which is what lets an edit point at "the typing" instead of at a second.
       */
      async span(id, run) {
        stage.beat("span-start", { id });
        try { return await run(); } finally { stage.beat("span-end", { id }); }
      },
      /** The box of the first visible match for `selector`, or null. */
      async box(selector) {
        return app.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          const r = el && Array.from(el.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0) || el?.getBoundingClientRect();
          if (!r || !r.width || !r.height) return null;
          const f = (n) => Number(n.toFixed(4));
          return { x: f(r.left / innerWidth), y: f(r.top / innerHeight), w: f(r.width / innerWidth), h: f(r.height / innerHeight) };
        })()`);
      },
      /** The caret's box in the note editor, or null when the caret is off screen. */
      async caret() {
        const state = await app.editorState();
        if (!state.caret) return null;
        const f = (n) => Number(n.toFixed(4));
        return { x: f(state.caret.left / width), y: f(state.caret.top / height), w: 0, h: f((state.caret.bottom - state.caret.top) / height) };
      },
      async down(name) { const mod = MODIFIERS[name]; held |= mod.bit; await send("rawKeyDown", mod); },
      async up(name) { const mod = MODIFIERS[name]; held &= ~mod.bit; await send("keyUp", mod); },
      /** One key stroke, with Shift pressed and released around it when the character needs it. */
      async stroke(char, { holdMs = 45 } = {}) {
        if ([...char].length === 1 && !/^[\x20-\x7e\n]$/.test(char)) {
          if (held) throw new Error("Unicode input cannot be used as a shortcut");
          await app.send("Input.insertText", { text: char });
          await rest(holdMs);
          return;
        }
        const key = keyFor(char);
        // With Shift held, a letter key reports its capital. Shortcuts match on it.
        if (held & 8 && /^[a-z]$/.test(key.key)) key.key = key.key.toUpperCase();
        if (key.shift && !(held & 8)) { await stage.down("Shift"); await rest(30); }
        // A key held with Ctrl, Alt, or Meta is a command, so it carries no text.
        const text = held & 7 ? undefined : key.text;
        await send(text ? "keyDown" : "rawKeyDown", key, text ? { text } : {});
        await rest(holdMs);
        await send("keyUp", key);
        if (key.shift && held === 8) await stage.up("Shift");
      },
      /**
       * Type `text` into whatever has focus, one key at a time. `where` reads
       * the box the camera should follow: the caret by default.
       */
      async type(text, { wpm = 62, where = () => stage.caret(), label } = {}) {
        const perChar = 60_000 / (wpm * 5);
        stage.beat("type-start", { text: label ?? text, box: await where() });
        for (const char of text) {
          await stage.stroke(char);
          // People pause after a word and longer after a line.
          const weight = char === "\n" ? 3.2 : char === " " ? 1.5 : /[.,:;]/.test(char) ? 1.9 : 1;
          await rest(Math.max(20, perChar * weight * (0.65 + random() * 0.7) - 45));
          // The caret trail is for the camera. A check has no camera.
          const box = pace > 0 ? await where() : null;
          if (box) stage.beat("caret", { box });
        }
        stage.beat("type-end", { box: await where() });
      },
      /** A key combination such as "Ctrl+Shift+F", pressed the way a hand does: modifiers first. The camera goes to `watch`; pass null to leave it where it is. */
      async chord(combo, { label = combo, watch = "body > .keystroke-hud-card[popover]" } = {}) {
        const parts = combo.split("+");
        const key = parts.pop();
        const entry = stage.beat("chord", { label });
        for (const mod of parts) { await stage.down(mod); await rest(110 + random() * 60); }
        await stage.stroke(key.length === 1 ? key.toLowerCase() : key, { holdMs: 120 });
        entry.pressed = Number(stage.now().toFixed(3));
        entry.box = watch ? await stage.box(watch) : null;
        await rest(90);
        for (const mod of parts.reverse()) { await stage.up(mod); await rest(40); }
        return entry;
      }
    };

    await scenario.prepare?.(stage);
    if (record) {
      recording = await startRecording({ display: screen.display, ...pixels, fps, file: path.join(outDir, "take.mp4") });
      clock = recording.startMs;
    } else {
      clock = Date.now();
    }
    stage.beat("start");
    await scenario.perform(stage);
    stage.beat("end");
    await rest(400);
  } catch (error) {
    const screenshot = await app?.screenshot(`demo-${scenario.name}-failure`).catch(() => null);
    if (screenshot) console.error(`Evidence: screenshot=${screenshot}`);
    throw error;
  } finally {
    await recording?.stop();
    await app?.close().catch((error) => console.error(`Teardown: ${error.message}`));
    await sushi?.server?.close();
    screen.stop();
    lock.release();
  }
  const take = { name: scenario.name, fps, window: { width, height, scale }, duration: beats.at(-1)?.t ?? 0, beats };
  // Only a recorded take is kept. A rehearsal or a check must not replace it.
  if (record) await writeFile(path.join(outDir, "take.json"), JSON.stringify(take, null, 1));
  return take;
}
