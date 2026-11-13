#!/usr/bin/env node
// The factory's one entry point. Run `node bin/demo.mjs` for the commands.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "yaml";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actions, app } from "../actions/omakase.mjs";
import { draft, findNarrations, resolveNarration } from "../src/draft.mjs";
import { spansOf } from "../src/edit.mjs";
import { buildProject } from "../src/project.mjs";
import { filmOptions, filmSize } from "../src/film.mjs";
import { recordTake } from "../src/recorder.mjs";
import { loadScreenplay } from "../src/screenplay.mjs";
import { serveReview } from "../src/review.mjs";
import { exportFile, exportPreset, PRESETS } from "../src/export.mjs";
import { listTakes, spliceBeats, spliceVideo, useTake } from "../src/takes.mjs";
import { BASE_THEME, ensureLuts, recolourTake, webExport } from "../src/themes.mjs";
import { importVideo, importedSettings } from "../src/import-video.mjs";
import { serveFactory, libraryProjects } from "../src/factory.mjs";
import { runHyperframes } from "../src/hyperframes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The check runner starts in the app repo. Otherwise use the sibling checkout.
const omakaseRoot = process.env.OMAKASE_ROOT ?? (existsSync("scripts/app-session.mjs") ? process.cwd() : path.resolve(root, "../omakase-v2"));
const usage = `Usage: node bin/demo.mjs <command> [screenplay]

  start              start the local video library (--port 4310 by default)
  import <file> [name]  import your own video and start its editor
  doctor             check local recording and rendering prerequisites
  init <name> <idea>  start a demo from an idea; the agent maintains the script
  context            print the action vocabulary and existing demos as JSON
  validate [name...]  validate scripts without opening the app
  produce <name>     check, record, cut, then serve an editable preview link
  draft              list every narration and whether its screenplay is new, changed, or current
  draft <note>       turn a narration into a screenplay that passes the check   -> screenplays/<name>/
  draft --all        draft every narration that is new or changed
  actions            list what a screenplay can ask the app to do
  check [name...]    perform at full speed with no recording; fails if the app has drifted
  rehearse <name>    perform at demo pace with no recording; saves a screenshot per jump
  record <name>      record a take                    -> out/<name>/take.mp4, take.json
  retake <name> <scene>  record one scene again and splice it into the take in use
  takes <name>       list the kept takes; "takes <name> <id>" switches to one
  spans <name>       list the take's spans and times, for writing edits
  cut <name>         direct the take and apply edit.yaml  -> out/<name>/project/
  preview <name>     serve an editable browser preview (--port <number> optional)
  studio <name>      open the cut in HyperFrames Studio
  render <name>      render the cut                   -> out/<name>/<name>.mp4
                     --preset ${Object.keys(PRESETS).join(" | ")}
  themes <name>      render the take in every theme for the website  -> out/<name>/films/
                     --only lumon,daylight to choose themes
  luts               rebuild the theme colour maps from themes/refs/
  make <name>        record, cut, and render`;

const [command, ...rest] = process.argv.slice(2);
const names = [], options = {};
for (let index = 0; index < rest.length; index++) {
  const arg = rest[index];
  if (["--port", "--preset", "--at", "--only"].includes(arg)) options[arg.slice(2)] = rest[++index];
  else if (arg === "--force" || arg === "--all") options[arg.slice(2)] = true;
  else names.push(arg);
}
const { force = false, all = false } = options;
const port = options.port === undefined ? 0 : Number(options.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs a number between 0 and 65535");
const preset = options.preset ?? "1080p";
if (!PRESETS[preset]) throw new Error(`--preset must be one of ${Object.keys(PRESETS).join(", ")}`);
const at = options.at === undefined ? undefined : Number(options.at);
if (at !== undefined && !(at >= 0)) throw new Error("--at needs a time in seconds");
const out = (name) => path.join(root, "out", name);
const safeName = (name) => { if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? "")) throw new Error("Demo name must contain lowercase letters, digits and dashes"); return name; };
const load = (name) => existsSync(path.join(root, "screenplays", safeName(name), "video.json")) ? importedSettings(root, name) : loadScreenplay(path.join(root, "screenplays", name, "screenplay.yaml"), { actions, app, omakaseRoot });
const refs = path.join(root, "themes", "refs"), luts = path.join(root, "out", "luts");
const hyperframes = (name, ...args) => hyperframesIn(path.join(out(name), "project"), ...args);
const hyperframesIn = (cwd, ...args) => runHyperframes({ root, cwd, args });
function one() {
  if (names.length !== 1) throw new Error(`"${command}" takes one screenplay name.\n\n${usage}`);
  return safeName(names[0]);
}

// The built app's identity: a rebuild replaces dist/main.js.
const appBuild = () => { try { return statSync(path.join(omakaseRoot, "dist/main.js")).mtimeMs; } catch { return null; } };
const checkedFile = path.join(root, "out", "checked.json");

async function perform(name, options) {
  const play = await load(name);
  if (play.imported) throw new Error(`${name} is an imported video. Use preview, cut or render to edit it; it has no app performance to record.`);
  const started = Date.now();
  const took = () => ((Date.now() - started) / 1000).toFixed(1);
  const base = { scenario: play.scenario, omakaseRoot, seed: play.seed, ...play.capture };
  if (!options.record) {
    const take = await recordTake({ ...base, outDir: out(name), ...options });
    return { take, play, took: took() };
  }
  await mkdir(out(name), { recursive: true });
  const lockPath = path.join(out(name), ".recording.lock");
  const lock = await open(lockPath, "wx").catch((error) => { if (error.code === "EEXIST") throw new Error(`${name}: another recording is active (${lockPath})`); throw error; });
  await lock.writeFile(String(process.pid));
  const id = `${Date.now()}-${randomUUID()}`, folder = path.join(out(name), "takes", id);
  try {
    let take;
    if (options.only) {
      // Film the one scene the way the take in use was filmed, then splice it in.
      const old = JSON.parse(await readFile(path.join(out(name), "take.json"), "utf8").catch(() => { throw new Error(`${name}: no take to splice into. Run "record ${name}" first.`); }));
      const part = await recordTake({ ...base, fps: old.fps, scale: old.window.scale, width: old.window.width, height: old.window.height, outDir: path.join(folder, "part"), ...options });
      const { beats, segments, joins } = spliceBeats(old, part, options.only);
      await spliceVideo({ oldVideo: path.join(out(name), old.video ?? "take.mp4"), partVideo: path.join(folder, "part", "take.mp4"), segments, fps: old.fps, file: path.join(folder, "take.mp4") });
      take = { ...old, spliced: options.only, duration: beats.at(-1).t, beats, joins };
      delete take.video;
      await writeFile(path.join(folder, "take.json"), JSON.stringify(take, null, 1));
      await rm(path.join(folder, "part"), { recursive: true, force: true });
    } else take = await recordTake({ ...base, outDir: folder, ...options });
    // A failure before this line leaves the take in use untouched.
    await useTake(out(name), id);
    return { take, play, took: took() };
  } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  finally { await lock.close(); await rm(lockPath, { force: true }); }
}
async function cut(name) {
  const play = await load(name);
  const built = await buildProject({ root, omakaseRoot, name, music: play.music, sfx: play.sfx, film: play.film });
  console.log(`${name}: cut to ${built.duration.toFixed(1)}s at ${built.fps} fps in ${built.pieces} piece(s), ${built.shots} shots, ${built.edits} edit(s) -> ${built.project}`);
  if (built.closest > built.sharp + 0.01) console.log(`  Note: the closest shot zooms ${built.closest.toFixed(2)}x, and this take is sharp to ${built.sharp.toFixed(2)}x. For crisp close-ups set "capture: { scale: 3 }" in the screenplay and record again.`);
}
async function record(name) {
  const { take } = await perform(name, { record: true });
  console.log(`${name}: recorded ${take.duration.toFixed(1)}s, ${take.beats.length} beats -> ${out(name)}`);
}
async function render(name) {
  const master = exportFile(out(name), name, "1080p");
  const cutAt = statSync(path.join(out(name), "project", "index.html")).mtimeMs;
  // Other presets are made from the master, so render it only when the cut is newer.
  if (preset === "1080p" || !existsSync(master) || statSync(master).mtimeMs < cutAt) {
    await hyperframes(name, "check");
    await hyperframes(name, "render", "--output", master);
  }
  console.log(`${name}: exported -> ${exportPreset({ out: out(name), name, preset, at })}`);
}
const demos = async () => (await readdir(path.join(root, "screenplays"), { withFileTypes: true })).filter((entry) => entry.isDirectory() && existsSync(path.join(root, "screenplays", entry.name, "screenplay.yaml"))).map((entry) => entry.name).sort();
async function review(name) {
  await cut(name);
  const play = await load(name);
  await serveReview({ root, name, title: play.title, port, build: () => cut(name), film: filmOptions(play.film) });
}

const commands = {
  async start() {
    if (names.length) throw new Error('start takes no demo name; open a demo from the library.');
    const factory = await serveFactory({root,omakaseRoot,port:options.port === undefined ? 4310 : port});
    const stop = () => factory.close().finally(() => process.exit(0));
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  },
  async import() {
    if (names.length < 1 || names.length > 2) throw new Error('import takes a video path and an optional demo name.');
    const imported = await importVideo({root,source:names[0],name:names[1]});
    console.log(`${imported.name}: imported ${imported.take.duration.toFixed(1)}s. Your original file was not changed.`);
    await review(imported.name);
  },
  async doctor() {
    const checks = [
      ["Node.js 22+", Number(process.versions.node.split(".")[0]) >= 22],
      ["Linux recording", process.platform === "linux"],
      ["Xvfb", spawnSync("Xvfb", ["-help"], { stdio: "ignore" }).error?.code !== "ENOENT"],
      ["Private session bus (dbus-daemon)", spawnSync("dbus-daemon", ["--version"], { stdio: "ignore" }).status === 0],
      ["FFmpeg", spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0],
      ["Built Omakase", existsSync(path.join(omakaseRoot, "dist/main.js")) && existsSync(path.join(omakaseRoot, "scripts/app-session.mjs"))]
    ];
    for (const [name, okay] of checks) console.log(`${okay ? "OK" : "MISSING"}  ${name}`);
    const checked = existsSync(checkedFile) ? JSON.parse(await readFile(checkedFile, "utf8")) : null;
    console.log(`${checked?.build === appBuild() ? "OK     " : "STALE  "} Screenplays checked against this build of the app${checked?.build === appBuild() ? "" : ': run "node bin/demo.mjs check"'}`);
    console.log(`App: ${omakaseRoot}\nFor export diagnostics: npx hyperframes doctor\nAgent workflow: .agents/skills/omakase-demo/SKILL.md`);
    if (checks.some(([, okay]) => !okay)) throw new Error("Resolve the missing prerequisites before recording");
  },
  async init() {
    const [rawName, ...idea] = names, name = safeName(rawName);
    if (!idea.length) throw new Error("init takes a demo name and an idea in plain language");
    const dir = path.join(root, "screenplays", name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "story.md"), `# Screenplay: ${name.replaceAll("-", " ")}\n\n${idea.join(" ")}\n`, { flag: "wx" });
    console.log(`Started ${name}: ${dir}/story.md\nDiscuss the story with the user, then maintain screenplay.yaml behind the scenes.\nRead .agents/skills/omakase-demo/SKILL.md for the workflow.`);
  },
  async context() {
    console.log(JSON.stringify({ root, omakaseRoot, defaultVault: path.join(omakaseRoot, app.defaultVault), demos: await demos(), videos: await libraryProjects(root), actions: Object.fromEntries(Object.entries(actions).map(([name, { summary, args, setupOnly }]) => [name, { summary, args, setupOnly }])) }, null, 2));
  },
  async validate() {
    for (const name of names.length ? names : await demos()) { await load(name); console.log(`${name}: valid`); }
  },
  async produce() {
    const name = one();
    await perform(name, { record: false, pace: 0, scale: 1 });
    await record(name);
    await review(name);
  },
  async draft() {
    const draftOne = async (narration) => {
      const { file, unsupported, orphans } = await draft({
        narration, root, omakaseRoot, actions, app, force,
        validate: (path) => loadScreenplay(path, { actions, app, omakaseRoot }),
        perform: (name) => perform(name, { record: false, pace: 0, scale: 1 })
      });
      console.log(`${narration.name}: drafted and checked -> ${file}`);
      if (unsupported.length) console.log(`\nNot in the screenplay, because no action can do it yet:\n${unsupported.map((line) => `  - ${line}`).join("\n")}`);
      if (orphans.length) console.log(`\nedit.yaml names spans this screenplay no longer has. Fix them before cutting:\n${orphans.map((id) => `  - ${id}`).join("\n")}`);
      console.log(`\nNext: node bin/demo.mjs make ${narration.name}`);
    };
    if (names.length) return draftOne(await resolveNarration(names.join(" "), root));
    const notes = await findNarrations(root);
    if (!all) {
      if (!notes.length) console.log('No narrations found. Put a Markdown file under screenplays/, or start a vault note with "# Screenplay: <title>".');
      for (const note of notes) console.log(`${note.state.padEnd(13)} ${note.name.padEnd(28)} ${path.relative(root, note.file).startsWith("..") ? note.file : path.relative(root, note.file)}`);
      return;
    }
    const due = notes.filter((note) => note.state === "new" || note.state === "changed");
    if (!due.length) console.log("Every narration's screenplay is current.");
    // One failed draft must not stop the others.
    let failed = 0;
    for (const note of due) {
      try { await draftOne(note); } catch (error) { failed++; console.error(`${note.name}: ${error.message}`); }
      console.log();
    }
    if (failed) throw new Error(`${failed} of ${due.length} drafts failed`);
  },
  actions() {
    for (const [name, action] of Object.entries(actions)) {
      console.log(`${name}${action.setupOnly ? "  (setup only)" : ""}\n  ${action.summary}`);
      for (const [arg, spec] of Object.entries(action.args)) {
        const kind = spec.type === "enum" ? spec.values.join(" | ") : spec.type;
        const need = spec.required ? "required" : spec.default !== undefined ? `default ${spec.default}` : "optional";
        console.log(`    ${arg === "value" ? `${name}:` : `${arg}:`} ${kind}, ${need}${spec.doc ? `. ${spec.doc}` : ""}`);
      }
    }
    console.log("custom\n  The escape hatch: \"custom: file.mjs#name\" calls an exported function(stage, step) from a file beside the screenplay.");
  },
  async check() {
    const all = names.length ? names : await demos();
    for (const name of all) {
      // Scale 1 fits the check runner's 1280x1024 display.
      const { take, took } = await perform(name, { record: false, pace: 0, scale: 1 });
      console.log(`${name}: ${take.beats.filter((beat) => beat.type === "span-end").length} spans held in ${took}s`);
    }
    console.log(`screenplays passed: ${all.join(", ")}`);
    // A full pass is a statement about this build of the app. "doctor" reports when the app has moved on.
    if (!names.length) { await mkdir(path.dirname(checkedFile), { recursive: true }); await writeFile(checkedFile, JSON.stringify({ build: appBuild(), at: new Date().toISOString(), demos: all }, null, 1)); }
  },
  async rehearse() {
    const { take } = await perform(one(), { record: false });
    console.log(`${take.name}: rehearsed ${take.duration.toFixed(1)}s, nothing saved`);
  },
  record: () => record(one()),
  async luts() {
    const themes = await ensureLuts(refs, luts, options.only?.split(","));
    console.log(`colour maps current for ${themes.length} themes -> ${luts}`);
  },
  async themes() {
    const name = one(), play = await load(name);
    if (play.imported) throw new Error('Theme recolouring needs a Retro 82 app recording. Use render to export your imported video.');
    if (play.scenario.appearance?.theme !== BASE_THEME) throw new Error(`${name}: themes recolours a take recorded in ${BASE_THEME}. Set "appearance: { theme: ${BASE_THEME} }" in the screenplay and record again.`);
    const take = JSON.parse(await readFile(path.join(out(name), "take.json"), "utf8"));
    if (take.appearance?.theme && take.appearance.theme !== BASE_THEME) throw new Error(`${name}: the recorded take uses ${take.appearance.theme}; record it again in ${BASE_THEME} before recolouring.`);
    const only = options.only?.split(",");
    const themes = [BASE_THEME, ...await ensureLuts(refs, luts, only)].filter((theme) => !only || only.includes(theme));
    const slug = play.film.slug ?? name, films = path.join(out(name), "films");
    await mkdir(films, { recursive: true });
    const source = path.join(out(name), take.video ?? "take.mp4");
    // A camera that never zooms needs no more pixels than the film has, so recolour at the film's size.
    const edits = parse(await readFile(path.join(root, "screenplays", name, "edit.yaml"), "utf8").catch(() => "")) ?? {};
    const still = filmOptions(play.film).camera === "still" && !(edits.edits ?? []).some((edit) => "camera" in edit);
    const fit = still ? filmSize(take.window) : null;
    for (const theme of themes) {
      const started = Date.now(), dir = path.join(out(name), "themes", theme);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const video = theme === BASE_THEME ? source : path.join(dir, "take.mp4");
      if (theme !== BASE_THEME) await recolourTake({ source, file: video, theme, take, luts, fit });
      const project = path.join(dir, "project");
      await buildProject({ root, omakaseRoot, name, music: play.music, sfx: play.sfx, film: play.film, video, out: project });
      // The website plays films silently at 30 frames a second, so render no more than that.
      await hyperframesIn(project, "render", "--quiet", "--fps", "30", "--output", path.join(dir, "film.mp4"));
      const file = path.join(films, `${theme}-${slug}.mp4`);
      webExport({ master: path.join(dir, "film.mp4"), file, poster: play.film.poster ?? 0 });
      await rm(dir, { recursive: true, force: true });
      console.log(`${theme}: ${path.relative(root, file)} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    console.log(`${name}: ${themes.length} theme(s) -> ${films}`);
  },
  async retake() {
    const [rawName, scene] = names, name = safeName(rawName);
    if (names.length !== 2) throw new Error(`"retake" takes a screenplay name and a scene.\n\n${usage}`);
    const { take } = await perform(name, { record: true, only: scene });
    console.log(`${name}: retook "${scene}", take is now ${take.duration.toFixed(1)}s -> ${out(name)}\nLater scenes are the earlier footage. If "${scene}" now leaves the app in a different state, record a whole take.`);
  },
  async takes() {
    const [rawName, id] = names, name = safeName(rawName);
    if (id) { await useTake(out(name), id); console.log(`${name}: using take ${id}. Run "cut ${name}" or reload the preview.`); return; }
    const kept = await listTakes(out(name));
    if (!kept.length) console.log(`${name}: no takes yet`);
    for (const take of kept) console.log(`${take.current ? "*" : " "} ${take.id}  ${new Date(take.at).toLocaleString()}  ${take.duration.toFixed(1)}s  ${take.fps} fps${take.scene ? `  retook ${take.scene}` : ""}`);
  },
  async spans() {
    const take = JSON.parse(await readFile(path.join(out(one()), "take.json"), "utf8"));
    for (const [id, span] of Object.entries(spansOf(take.beats))) console.log(`${span.start.toFixed(2).padStart(7)}  ${(span.end - span.start).toFixed(2).padStart(6)}s  ${id.includes("/") ? "  " : ""}${id}`);
  },
  cut: () => cut(one()),
  preview: () => review(one()),
  studio: () => hyperframes(one(), "preview"),
  render: () => render(one()),
  async make() {
    const name = one();
    await record(name);
    await cut(name);
    await render(name);
  }
};

if (!commands[command]) {
  console.error(usage);
  process.exit(2);
}
try {
  await commands[command]();
} catch (error) {
  // A screenplay mistake is a message for its author, not a stack trace.
  console.error(error.stack?.includes("app-session") || error.code === "ERR_ASSERTION" ? error : `Error: ${error.message}`);
  process.exit(1);
}
