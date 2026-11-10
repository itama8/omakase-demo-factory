// The recorder: drive the real Omakase app at human pace on a private X
// display, record that display, and log every beat with its time and screen
// box. The director reads the log to place the camera, so a screenplay never
// has to describe where things are. Nothing here knows what Omakase's UI
// looks like; that knowledge lives in the action vocabulary.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

/**
 * A display number nothing on this machine uses: no lock file, no socket
 * file, and no abstract socket. Starting high keeps clear of the desktop's
 * own X server and of the displays XWayland hands out. Letting Xvfb choose
 * is not safe: given a stale lock it will take over :0, the desktop's
 * display, and remove the desktop's socket when it exits.
 */
export async function freeDisplay(from = 90, to = 400) {
  const abstract = new Set((await readFile("/proc/net/unix", "utf8").catch(() => "")).split("\n").map((line) => line.trim().split(/\s+/).at(-1)).filter((name) => name?.startsWith("@/tmp/.X11-unix/X")));
  for (let n = from; n < to; n++) {
    if (existsSync(`/tmp/.X${n}-lock`) || existsSync(`/tmp/.X11-unix/X${n}`) || abstract.has(`@/tmp/.X11-unix/X${n}`)) continue;
    return n;
  }
  throw new Error(`no free X display between :${from} and :${to}`);
}

async function startDisplay(width, height) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await freeDisplay(90 + attempt * 7);
    try { return await openDisplay(number, width, height); }
    // Another process can take the same number between the check and the start; try the next.
    catch (error) { if (!/already active|Cannot establish|server already running/i.test(error.message)) throw error; }
  }
  throw new Error("could not start a private X display");
}

function openDisplay(number, width, height) {
  return new Promise((resolve, reject) => {
    // -nolisten tcp: reachable only from this machine. The take never touches the desktop's display.
    const server = spawn("Xvfb", [`:${number}`, "-screen", "0", `${width}x${height}x24`, "-noreset", "-nocursor", "-nolisten", "tcp"], { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "", ready = false, poll;
    server.stderr.on("data", (chunk) => { errors += chunk; });
    server.once("error", (error) => { clearInterval(poll); reject(error); });
    server.once("exit", (code) => { clearInterval(poll); if (!ready) reject(new Error(`Xvfb :${number} exited early (code ${code}): ${errors.trim()}`)); });
    const started = Date.now();
    poll = setInterval(() => {
      if (existsSync(`/tmp/.X11-unix/X${number}`)) {
        clearInterval(poll); ready = true;
        resolve({ display: `:${number}`, stop: () => server.kill("SIGTERM") });
      } else if (Date.now() - started > 10_000) { clearInterval(poll); server.kill("SIGKILL"); reject(new Error(`Xvfb :${number} did not start: ${errors.trim()}`)); }
    }, 50);
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

// A session bus of the take's own. The app's keyring, file pickers and
// notifications go over the session bus; on the desktop's bus they would
// prompt or open windows on the live screen. This bus can start nothing.
const PRIVATE_BUS = `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><listen>unix:tmpdir=${os.tmpdir()}</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>`;

async function startBus() {
  const config = path.join(os.tmpdir(), `omakase-demo-bus-${process.pid}.conf`);
  await writeFile(config, PRIVATE_BUS);
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const bus = spawn("dbus-daemon", [`--config-file=${config}`, "--nofork", "--print-address=3"], { env, stdio: ["ignore", "ignore", "pipe", "pipe"] });
    let errors = "";
    bus.stderr.on("data", (chunk) => { errors += chunk; });
    bus.once("error", (error) => reject(error.code === "ENOENT" ? new Error("dbus-daemon is needed to keep the app off the desktop's session bus") : error));
    bus.once("exit", (code) => reject(new Error(`dbus-daemon exited early (code ${code}): ${errors.trim()}`)));
    bus.stdio[3].once("data", (chunk) => resolve({ address: String(chunk).trim(), stop: async () => { bus.kill("SIGTERM"); await rm(config, { force: true }); } }));
  });
}

/** Strip a secret from anything that might be printed. */
const redact = (text, secret) => secret ? String(text).split(secret).join("***") : String(text);

/** Sign the throwaway profile in to Gemini with a key from the environment, and choose a fast model. */
async function signInGemini(app) {
  const key = process.env.GEMINI_API_KEY ?? process.env.OMK_KEY;
  if (!key) throw new Error("sushi: gemini needs a Gemini API key in GEMINI_API_KEY (or OMK_KEY)");
  try {
    const set = await app.evaluate(`window.omakase.setProviderApiKey({ providerId: "google", apiKey: ${JSON.stringify(key)} }).then((r) => ({ ok: r.ok, error: r.error ?? null }))`);
    if (!set.ok) throw new Error(`Gemini refused the key: ${set.error ?? "no reason given"}`);
    const ids = await app.evaluate(`window.omakase.listSushiModels().then((all) => all.filter((m) => (m.providerId ?? m.provider) === "google").map((m) => m.modelId ?? m.id))`);
    const model = ["gemini-3.5-flash", "gemini-3-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"].find((id) => ids.includes(id)) ?? ids.find((id) => /flash/.test(id));
    if (!model) throw new Error(`no Gemini flash model is available; the key offers: ${ids.join(", ") || "nothing"}`);
    await app.evaluate(`window.omakase.setSushiModel({ providerId: "google", modelId: ${JSON.stringify(model)} }).then(() => true)`);
    console.log(`  Sushi: Gemini ${model} (live; answers vary between takes)`);
  } catch (error) { throw new Error(redact(error.message, key)); }
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

/** Frames the capture actually wrote each second, or null when ffprobe cannot say. */
export function capturedRate(file) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets:format=duration", "-of", "json", file], { encoding: "utf8" });
  try {
    const info = JSON.parse(probe.stdout);
    return Number(info.streams[0].nb_read_packets) / Number(info.format.duration);
  } catch { return null; }
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
 *
 * `only` names one scene to record. The scenes before it run at check speed
 * with the camera off, so the app is in the state that scene starts from.
 */
export async function recordTake({ scenario, omakaseRoot, outDir, width = 1280, height = 720, scale = 2, fps = 60, seed = 7, record = true, pace: wanted = 1, only = null }) {
  if (scenario.geminiKey && !(process.env.GEMINI_API_KEY ?? process.env.OMK_KEY)) throw new Error("sushi: gemini needs a Gemini API key in GEMINI_API_KEY (or OMK_KEY)");
  // Under the check runner the display is already private; never use the desktop's.
  if (process.env.OMAKASE_CHECK === "1" && !record && (width > 1280 || height > 1024)) scale = 1;
  // The lead-in to a single scene runs at check speed; the pace returns when the camera rolls.
  let pace = only ? 0 : wanted;
  // The app session resolves dist/ and electron from the working directory.
  const originalCwd = process.cwd();
  const environmentKeys = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE", "ELECTRON_OZONE_PLATFORM_HINT", "GDK_SCALE", "GTK_USE_PORTAL", "DBUS_SESSION_BUS_ADDRESS"];
  const environment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const { launchApp, electronExpression, editorReady } = await import(pathToFileURL(path.join(omakaseRoot, "scripts/app-session.mjs")).href);
  if (record) await mkdir(outDir, { recursive: true });
  // Checks rebuild dist/ under this lock. Holding it keeps a build from
  // replacing the app in the middle of a take. Under the runner it is already held.
  const lock = process.env.OMAKASE_CHECK === "1" ? { release() {} } : await (await import(pathToFileURL(path.join(omakaseRoot, "scripts/check.mjs")).href))
    .acquireLock(process.env.OMAKASE_CHECK_LOCK ?? path.join(os.tmpdir(), "omakase-check", `lock-${omakaseRoot.replace(/[^\w.-]+/g, "_")}`));
  const pixels = { width: width * scale, height: height * scale };
  // Under `npm run check` the runner already owns an isolated display.
  let screen, bus;
  let beats = [];
  let app, recording, sushi, clock = null;
  let profilePath;
  try {
    process.chdir(omakaseRoot);
    screen = process.env.OMAKASE_CHECK === "1" && !record ? { display: process.env.DISPLAY, stop() {} } : await startDisplay(pixels.width, pixels.height);
    // Electron prefers Wayland whenever WAYLAND_DISPLAY is set, which would put
    // the window on the live desktop instead of the recorded one.
    delete process.env.WAYLAND_DISPLAY;
    Object.assign(process.env, { DISPLAY: screen.display, XDG_SESSION_TYPE: "x11", ELECTRON_OZONE_PLATFORM_HINT: "x11", GDK_SCALE: "1", GTK_USE_PORTAL: "0" });
    // "sushi: live" decrypts a key saved with the desktop's keyring, so it alone keeps the desktop's bus.
    bus = scenario.liveProvider ? null : await startBus();
    if (bus) process.env.DBUS_SESSION_BUS_ADDRESS = bus.address;
    // A human delay, scaled by the pace. Waits on the app are never scaled.
    const rest = (ms) => pace > 0 ? delay(ms * pace) : undefined;

    const random = mulberry32(seed);
    // Sushi scenes answer from a scripted local model server instead of a
    // real provider: the demo profile has no credentials. The real runtime
    // still runs every tool the script calls.
    if (scenario.sushi) {
      const { startFakeModelProvider, configureFakeModelProvider } = await import(pathToFileURL(path.join(omakaseRoot, "scripts/fixtures/fake-model-provider.mjs")).href);
      sushi = { script: scenario.sushi, configure: configureFakeModelProvider };
      sushi.server = await startFakeModelProvider((request, count) => scenario.sushi.respond(request, { count, pace, rest: (ms) => rest(ms) ?? Promise.resolve() }));
    }
    app = await launchApp({
      prefix: "omakase-demo-", main: true, args: ["--ozone-platform=x11", `--force-device-scale-factor=${scale}`, ...(bus ? ["--password-store=basic"] : [])],
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
    // A link the take follows must not open the desktop's browser or file manager.
    await app.evaluateMain(`(() => { const { shell } = ${electronExpression}; shell.openExternal = async (url) => { console.log("demo: kept external link inside the take: " + url); }; shell.openPath = async () => ""; shell.showItemInFolder = () => {}; return true; })()`);
    if (scenario.geminiKey) await signInGemini(app);
    // A recording needs the window to cover the screen exactly. A check only
    // needs it close: X can settle a pixel short when nothing is being filmed.
    const slack = record ? 0 : 2;
    await app.until(`window is ${width}x${height}`, () => app.evaluate(`Math.abs(innerWidth - ${width}) <= ${slack} && Math.abs(innerHeight - ${height}) <= ${slack}`));

    let held = 0;
    const send = (type, key, extra = {}) => app.send("Input.dispatchKeyEvent", { type, key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, modifiers: held, ...extra });
    const stage = {
      app, width, height, random, get pace() { return pace; }, profile: profilePath, dir: scenario.dir, electron: electronExpression,
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
        // One beat per key, for the sound of the keyboard. A check has no sound.
        if (pace > 0 && clock !== null) stage.beat("key");
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
      /**
       * Click `selector` the way a hand does: head for it, arrive, then press.
       * The recording has no pointer, so the two beats are what the film draws
       * one from. Use this instead of `app.click` for any click the viewer should see.
       */
      async click(selector, { button = "left", ctrl = false, shift = false, ...options } = {}) {
        const frac = (at) => ({ x: Number((at.x / width).toFixed(4)), y: Number((at.y / height).toFixed(4)) });
        // The app's own hit test scrolls the target into view and says where the click will land.
        // Before the camera rolls there is no pointer to draw.
        const filmed = pace > 0 && clock !== null;
        if (filmed) { stage.beat("pointer", frac(await app.hitPoint(selector))); await rest(520); }
        let point;
        if (button === "left" && !ctrl && !shift) point = await app.click(selector, options);
        else {
          // A held modifier is pressed on the keyboard first, so the keystroke HUD shows it.
          // Find the point first: a held modifier can re-render the target (a link previews under Ctrl).
          point = await app.hitPoint(selector);
          const mods = [...(ctrl ? ["Ctrl"] : []), ...(shift ? ["Shift"] : [])];
          for (const mod of mods) { await stage.down(mod); await rest(140); }
          for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...point, button, clickCount: 1, modifiers: held });
          await rest(90);
          for (const mod of mods.reverse()) await stage.up(mod);
        }
        if (filmed && point) stage.beat("click", { ...frac(point), button });
        await rest(180);
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
    if (only) {
      await scenario.perform(stage, { before: only });
      // Let the app finish painting what the lead-in did before the camera rolls.
      await delay(900);
      beats = [];
      pace = wanted;
    }
    if (record) {
      recording = await startRecording({ display: screen.display, ...pixels, fps, file: path.join(outDir, "take.mp4") });
      clock = recording.startMs;
    } else {
      clock = Date.now();
    }
    stage.beat("start");
    await scenario.perform(stage, only ? { only } : {});
    stage.beat("end");
    await rest(400);
  } catch (error) {
    const screenshot = await app?.screenshot(`demo-${scenario.name}-failure`).catch(() => null);
    if (screenshot) console.error(`Evidence: screenshot=${screenshot}`);
    throw error;
  } finally {
    try {
      const cleanup = async (stop) => { try { await stop(); } catch (error) { console.error(`Teardown: ${error.message}`); } };
      await cleanup(() => recording?.stop());
      await cleanup(() => app?.close());
      await cleanup(() => sushi?.server?.close());
      await cleanup(() => screen?.stop());
      await cleanup(() => bus?.stop());
    } finally {
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      process.chdir(originalCwd);
      lock.release();
    }
  }
  const take = { name: scenario.name, fps, window: { width, height, scale }, appearance: scenario.appearance, ...(only ? { only } : {}), duration: beats.at(-1)?.t ?? 0, beats };
  if (record) {
    // A capture that cannot keep up drops frames silently. Say so, because it shows as stutter.
    const rate = capturedRate(path.join(outDir, "take.mp4"));
    if (rate !== null) take.captured = Number(rate.toFixed(1));
    if (rate !== null && rate < fps * 0.92) console.warn(`Warning: the capture averaged ${rate.toFixed(1)} of ${fps} frames a second. Lower capture.fps or capture.scale in the screenplay if the take stutters.`);
  }
  // Only a recorded take is kept. A rehearsal or a check must not replace it.
  if (record) await writeFile(path.join(outDir, "take.json"), JSON.stringify(take, null, 1));
  return take;
}
