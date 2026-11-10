#!/usr/bin/env node
// The factory's one entry point. Run `node bin/demo.mjs` for the commands.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actions, app } from "../actions/omakase.mjs";
import { draft, findNarrations, resolveNarration } from "../src/draft.mjs";
import { spansOf } from "../src/edit.mjs";
import { buildProject } from "../src/project.mjs";
import { recordTake } from "../src/recorder.mjs";
import { loadScreenplay } from "../src/screenplay.mjs";
import { serveReview } from "../src/review.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The check runner starts in the app repo. Otherwise use the sibling checkout.
const omakaseRoot = process.env.OMAKASE_ROOT ?? (existsSync("scripts/app-session.mjs") ? process.cwd() : path.resolve(root, "../omakase-v2"));
const usage = `Usage: node bin/demo.mjs <command> [screenplay]

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
  spans <name>       list the take's spans and times, for writing edits
  cut <name>         direct the take and apply edit.yaml  -> out/<name>/project/
  preview <name>     serve an editable browser preview (--port <number> optional)
  studio <name>      open the cut in HyperFrames Studio
  render <name>      render the cut                   -> out/<name>/<name>.mp4
  make <name>        record, cut, and render`;

const [command, ...rest] = process.argv.slice(2);
const force = rest.includes("--force");
const all = rest.includes("--all");
const portAt = rest.indexOf("--port");
const port = portAt >= 0 ? Number(rest[portAt + 1]) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs a number between 0 and 65535");
const names = rest.filter((arg, index) => arg !== "--force" && arg !== "--all" && index !== portAt && (portAt < 0 || index !== portAt + 1));
const out = (name) => path.join(root, "out", name);
const safeName = (name) => { if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? "")) throw new Error("Demo name must contain lowercase letters, digits and dashes"); return name; };
const load = (name) => loadScreenplay(path.join(root, "screenplays", safeName(name), "screenplay.yaml"), { actions, app, omakaseRoot });
const hyperframes = (name, ...args) => {
  const result = spawnSync("npx", ["--yes", "hyperframes", ...args], { cwd: path.join(out(name), "project"), stdio: "inherit" });
  if (result.status !== 0) throw new Error(`hyperframes ${args[0]} failed`);
};
function one() {
  if (names.length !== 1) throw new Error(`"${command}" takes one screenplay name.\n\n${usage}`);
  return safeName(names[0]);
}

async function perform(name, options) {
  const play = await load(name);
  const started = Date.now();
  if (!options.record) {
    const take = await recordTake({ scenario: play.scenario, omakaseRoot, outDir: out(name), seed: play.seed, ...options });
    return { take, play, took: ((Date.now() - started) / 1000).toFixed(1) };
  }
  await mkdir(out(name), { recursive: true });
  const lockPath = path.join(out(name), ".recording.lock");
  const lock = await open(lockPath, "wx").catch((error) => { if (error.code === "EEXIST") throw new Error(`${name}: another recording is active (${lockPath})`); throw error; });
  await lock.writeFile(String(process.pid));
  const id = `${Date.now()}-${randomUUID()}`, folder = path.join(out(name), "takes", id);
  try {
    const take = await recordTake({ scenario: play.scenario, omakaseRoot, outDir: folder, seed: play.seed, ...options });
    take.video = `takes/${id}/take.mp4`;
    const pending = path.join(out(name), `take-${id}.json`);
    await writeFile(pending, JSON.stringify(take, null, 1));
    const link = path.join(out(name), `take-${id}.mp4`);
    await symlink(take.video, link); await rename(link, path.join(out(name), "take.mp4"));
    await rename(pending, path.join(out(name), "take.json"));
    return { take, play, took: ((Date.now() - started) / 1000).toFixed(1) };
  } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  finally { await lock.close(); await rm(lockPath, { force: true }); }
}
async function cut(name) {
  const play = await load(name);
  const built = await buildProject({ root, omakaseRoot, name, music: play.music });
  console.log(`${name}: cut to ${built.duration}s in ${built.pieces} piece(s), ${built.shots} shots, ${built.edits} edit(s) -> ${built.project}`);
}
async function record(name) {
  const { take } = await perform(name, { record: true });
  console.log(`${name}: recorded ${take.duration.toFixed(1)}s, ${take.beats.length} beats -> ${out(name)}`);
}
function render(name) {
  hyperframes(name, "check");
  hyperframes(name, "render", "--output", path.join(out(name), `${name}.mp4`));
}
const demos = async () => (await readdir(path.join(root, "screenplays"), { withFileTypes: true })).filter((entry) => entry.isDirectory() && existsSync(path.join(root, "screenplays", entry.name, "screenplay.yaml"))).map((entry) => entry.name).sort();
async function review(name) {
  await cut(name);
  await serveReview({ root, name, port, build: () => cut(name) });
}

const commands = {
  doctor() {
    const checks = [
      ["Node.js 22+", Number(process.versions.node.split(".")[0]) >= 22],
      ["Linux recording", process.platform === "linux"],
      ["Xvfb", spawnSync("Xvfb", ["-help"], { stdio: "ignore" }).error?.code !== "ENOENT"],
      ["FFmpeg", spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0],
      ["Built Omakase", existsSync(path.join(omakaseRoot, "dist/main.js")) && existsSync(path.join(omakaseRoot, "scripts/app-session.mjs"))]
    ];
    for (const [name, okay] of checks) console.log(`${okay ? "OK" : "MISSING"}  ${name}`);
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
    console.log(JSON.stringify({ root, omakaseRoot, defaultVault: path.join(omakaseRoot, app.defaultVault), demos: await demos(), actions: Object.fromEntries(Object.entries(actions).map(([name, { summary, args, setupOnly }]) => [name, { summary, args, setupOnly }])) }, null, 2));
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
  },
  async rehearse() {
    const { take } = await perform(one(), { record: false });
    console.log(`${take.name}: rehearsed ${take.duration.toFixed(1)}s, nothing saved`);
  },
  record: () => record(one()),
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
    render(name);
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
