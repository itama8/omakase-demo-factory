// A screenplay is a YAML file of scenes, each a list of steps. A step names
// one action from the vocabulary and gives its arguments. This module reads
// a screenplay, rejects anything the vocabulary does not know, and compiles
// it into a scenario the recorder can perform.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

/** "800ms", "1.2s", or a bare number of seconds, as seconds. */
export function seconds(value, what = "duration") {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = typeof value === "string" && value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(ms|s)$/);
  if (!match) throw new Error(`${what} must look like 800ms or 1.2s; got ${JSON.stringify(value)}`);
  return Number(match[1]) / (match[2] === "ms" ? 1000 : 1);
}

const STEP_KEYS = new Set(["id", "custom"]);

function readArgs(action, name, step, where) {
  const args = {};
  for (const [key, spec] of Object.entries(action.args)) {
    const raw = key === "value" ? step[name] : step[key];
    if (raw === undefined || raw === null) {
      if (spec.required) throw new Error(`${where}: "${name}" needs ${key === "value" ? "a value" : `"${key}"`}${spec.doc ? ` (${spec.doc})` : ""}`);
      if (spec.default !== undefined) args[key] = spec.default;
      continue;
    }
    const label = `${where}: ${key === "value" ? name : `${name}.${key}`}`;
    if (spec.type === "duration") args[key] = seconds(raw, label) * (key === "value" ? 1000 : 1);
    else if (spec.type === "number") { if (typeof raw !== "number") throw new Error(`${label} must be a number; got ${JSON.stringify(raw)}`); args[key] = raw; }
    else if (spec.type === "enum") { if (!spec.values.includes(String(raw))) throw new Error(`${label} must be one of ${spec.values.join(", ")}; got ${JSON.stringify(raw)}`); args[key] = String(raw); }
    // YAML block text ends with a line break that nobody meant to type.
    else args[key] = String(raw).replace(/\n$/, "");
  }
  for (const key of Object.keys(step)) {
    if (key !== name && !STEP_KEYS.has(key) && !(key in action.args)) throw new Error(`${where}: "${name}" has no "${key}". It takes: ${Object.keys(action.args).filter((arg) => arg !== "value").join(", ") || "nothing else"}`);
  }
  return args;
}

function compileSteps(steps, { actions, where, scene, setup, dir }) {
  if (!Array.isArray(steps)) throw new Error(`${where} must be a list of steps`);
  const seen = new Map();
  return steps.map((step, index) => {
    const at = `${where}, step ${index + 1}`;
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`${at} must be a mapping such as "- pause: 1s"`);
    const name = Object.keys(step).find((key) => key === "custom" || key in actions);
    if (!name) throw new Error(`${at}: no known action in {${Object.keys(step).join(", ")}}. Known: ${Object.keys(actions).join(", ")}, custom`);
    const other = Object.keys(step).find((key) => key !== name && (key === "custom" || key in actions) && !(name !== "custom" && key in actions[name].args));
    if (other) throw new Error(`${at} names two actions, "${name}" and "${other}". Use one step for each.`);
    // A step is addressed as scene/id. The id defaults to the action's name,
    // numbered when a scene uses the same action more than once.
    const base = step.id ?? name;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    if (step.id && count > 1) throw new Error(`${at}: id "${step.id}" is used twice in ${scene ?? "setup"}`);
    const id = `${scene ? `${scene}/` : ""}${count > 1 ? `${base}-${count}` : base}`;

    if (name === "custom") {
      // The escape hatch: "custom: file.mjs#name" calls an exported
      // function(stage, step) from a file beside the screenplay.
      const [file, exported = "default"] = String(step.custom).split("#");
      return { id, name, run: async (stage) => {
        const module = await import(pathToFileURL(path.resolve(dir, file)).href);
        if (typeof module[exported] !== "function") throw new Error(`${at}: ${file} does not export a function "${exported}"`);
        return module[exported](stage, step);
      } };
    }
    const action = actions[name];
    if (action.setupOnly && !setup) throw new Error(`${at}: "${name}" only works in setup, before the camera rolls`);
    const args = readArgs(action, name, step, at);
    return { id, name, run: (stage) => action.run(stage, args) };
  });
}

/** Read and validate a screenplay. Throws with the place and the fix on any mistake. */
export async function loadScreenplay(file, { actions, app, omakaseRoot }) {
  const dir = path.dirname(file);
  const doc = parse(await readFile(file, "utf8"));
  if (!doc || typeof doc !== "object") throw new Error(`${file} is empty`);
  const known = new Set(["title", "vault", "music", "seed", "setup", "scenes"]);
  for (const key of Object.keys(doc)) if (!known.has(key)) throw new Error(`${file}: unknown key "${key}". Known: ${[...known].join(", ")}`);
  if (!Array.isArray(doc.scenes) || !doc.scenes.length) throw new Error(`${file}: needs at least one scene`);

  const names = new Set();
  const scenes = doc.scenes.map((scene, index) => {
    if (!scene?.name || !/^[a-z0-9-]+$/.test(scene.name)) throw new Error(`${file}: scene ${index + 1} needs a name of lowercase letters, digits, and dashes`);
    if (names.has(scene.name)) throw new Error(`${file}: two scenes are named "${scene.name}"`);
    names.add(scene.name);
    return { name: scene.name, steps: compileSteps(scene.steps, { actions, where: `scene "${scene.name}"`, scene: scene.name, dir }) };
  });
  const setup = compileSteps(doc.setup ?? [], { actions, where: "setup", setup: true, dir });
  const name = path.basename(dir);

  return {
    name,
    title: doc.title ?? name,
    music: doc.music ? path.resolve(omakaseRoot, doc.music) : null,
    seed: doc.seed ?? 7,
    spans: scenes.flatMap((scene) => [scene.name, ...scene.steps.map((step) => step.id)]),
    scenario: {
      name,
      vault: path.resolve(omakaseRoot, doc.vault ?? app.defaultVault),
      async prepare(stage) { for (const step of setup) await step.run(stage); },
      async perform(stage) {
        for (const scene of scenes) {
          await stage.span(scene.name, async () => {
            for (const step of scene.steps) await stage.span(step.id, () => step.run(stage));
          });
        }
      }
    }
  };
}
