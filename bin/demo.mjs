#!/usr/bin/env node
// The factory's one entry point. Run `node bin/demo.mjs` for the commands.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actions, app } from "../actions/omakase.mjs";
import { draft, findNarrations, resolveNarration } from "../src/draft.mjs";
import { spansOf } from "../src/edit.mjs";
import { buildProject } from "../src/project.mjs";
import { recordTake } from "../src/recorder.mjs";
import { loadScreenplay } from "../src/screenplay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The check runner starts in the app repo. Otherwise use the sibling checkout.
const omakaseRoot = process.env.OMAKASE_ROOT ?? (existsSync("scripts/app-session.mjs") ? process.cwd() : path.resolve(root, "../omakase-v2"));
const usage = `Usage: node bin/demo.mjs <command> [screenplay]

  draft              list the narration notes found in your Omakase vault
  draft <note>       turn a narration into a screenplay that passes the check   -> screenplays/<name>/
  actions            list what a screenplay can ask the app to do
  check [name...]    perform at full speed with no recording; fails if the app has drifted
  rehearse <name>    perform at demo pace with no recording; saves a screenshot per jump
  record <name>      record a take                    -> out/<name>/take.mp4, take.json
  spans <name>       list the take's spans and times, for writing edits
  cut <name>         direct the take and apply edit.yaml  -> out/<name>/project/
  preview <name>     open the cut in HyperFrames Studio
  render <name>      render the cut                   -> out/<name>/<name>.mp4
  make <name>        record, cut, and render`;

const [command, ...rest] = process.argv.slice(2);
const force = rest.includes("--force");
const names = rest.filter((arg) => arg !== "--force");
const out = (name) => path.join(root, "out", name);
const load = (name) => loadScreenplay(path.join(root, "screenplays", name, "screenplay.yaml"), { actions, app, omakaseRoot });
const hyperframes = (name, ...args) => {
  const result = spawnSync("npx", ["--yes", "hyperframes", ...args], { cwd: path.join(out(name), "project"), stdio: "inherit" });
  if (result.status !== 0) throw new Error(`hyperframes ${args[0]} failed`);
};
function one() {
  if (names.length !== 1) throw new Error(`"${command}" takes one screenplay name.\n\n${usage}`);
  return names[0];
}

async function perform(name, options) {
  const play = await load(name);
  const started = Date.now();
  const take = await recordTake({ scenario: play.scenario, omakaseRoot, outDir: out(name), seed: play.seed, ...options });
  return { take, play, took: ((Date.now() - started) / 1000).toFixed(1) };
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

const commands = {
  async draft() {
    if (!names.length) {
      const notes = await findNarrations();
      if (!notes.length) console.log('No narration notes found. A narration is a note whose first line is "# Screenplay: <title>".');
      for (const note of notes) console.log(`${note.name.padEnd(28)} ${note.file}`);
      return;
    }
    const narration = await resolveNarration(names.join(" "));
    const { file, unsupported, orphans } = await draft({
      narration, root, omakaseRoot, actions, app, force,
      validate: (path) => loadScreenplay(path, { actions, app, omakaseRoot }),
      perform: (name) => perform(name, { record: false, pace: 0, scale: 1 })
    });
    console.log(`${narration.name}: drafted and checked -> ${file}`);
    if (unsupported.length) console.log(`\nNot in the screenplay, because no action can do it yet:\n${unsupported.map((line) => `  - ${line}`).join("\n")}`);
    if (orphans.length) console.log(`\nedit.yaml names spans this screenplay no longer has. Fix them before cutting:\n${orphans.map((id) => `  - ${id}`).join("\n")}`);
    console.log(`\nNext: node bin/demo.mjs make ${narration.name}`);
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
    const all = names.length ? names : (await readdir(path.join(root, "screenplays"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
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
  preview: () => hyperframes(one(), "preview"),
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
