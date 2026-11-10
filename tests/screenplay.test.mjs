import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScreenplay, seconds } from "../src/screenplay.mjs";

const actions = {
  pause: { summary: "", args: { value: { type: "duration", required: true } }, run: (stage, { value }) => stage.log.push(`pause ${value}`) },
  say: { summary: "", args: { value: { type: "text", required: true }, loud: { type: "enum", values: ["yes", "no"], default: "no" } }, run: (stage, { value, loud }) => stage.log.push(loud === "yes" ? value.toUpperCase() : value) },
  hud: { summary: "", setupOnly: true, args: { value: { type: "text", required: true } }, run: (stage) => stage.log.push("hud") }
};
const app = { defaultVault: "demo-notes" };

async function load(yaml) {
  const root = await mkdtemp(path.join(os.tmpdir(), "demo-screenplay-"));
  const dir = path.join(root, "demo");
  await mkdir(dir);
  await writeFile(path.join(dir, "screenplay.yaml"), yaml);
  try { return await loadScreenplay(path.join(dir, "screenplay.yaml"), { actions, app, omakaseRoot: "/app" }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const stage = () => {
  const log = [];
  return { log, span: async (id, run) => { log.push(`[${id}`); await run(); log.push(`${id}]`); } };
};

test("durations read as seconds, and a mistake names the fix", () => {
  assert.equal(seconds("800ms"), 0.8);
  assert.equal(seconds("1.5s"), 1.5);
  assert.equal(seconds(2), 2);
  assert.throws(() => seconds("2 minutes"), /800ms or 1.2s/);
});

test("steps get stable addresses, numbered when an action repeats in a scene", async () => {
  const play = await load(`scenes:\n  - name: hi\n    steps:\n      - say: a\n      - say: b\n        loud: "yes"\n      - pause: 1s\n        id: breath\n`);
  assert.deepEqual(play.spans, ["hi", "hi/say", "hi/say-2", "hi/breath"]);
  assert.deepEqual(play.capture, { fps: 60, scale: 2 });
  assert.equal(play.sfx, false);
  const s = stage();
  await play.scenario.perform(s);
  assert.deepEqual(s.log, ["[hi", "[hi/say", "a", "hi/say]", "[hi/say-2", "B", "hi/say-2]", "[hi/breath", "pause 1000", "hi/breath]", "hi]"]);
});

test("a single-scene retake can run the lead-in, then only its scene", async () => {
  const play = await load(`scenes:\n  - name: one\n    steps: [{ say: a }]\n  - name: two\n    steps: [{ say: b }]\n  - name: three\n    steps: [{ say: c }]\n`);
  const lead = stage(); await play.scenario.perform(lead, { before: "two" });
  assert.deepEqual(lead.log.filter((line) => line.length === 1), ["a"]);
  const only = stage(); await play.scenario.perform(only, { only: "two" });
  assert.deepEqual(only.log, ["[two", "[two/say", "b", "two/say]", "two]"]);
  await assert.rejects(play.scenario.perform(stage(), { only: "four" }), /No scene named "four"/);
});

test("the loader rejects what it cannot perform before the app starts", async () => {
  const bad = async (yaml, pattern) => assert.rejects(load(yaml), pattern);
  await bad("scenes: []\n", /at least one scene/);
  await bad("scenes:\n  - name: a\n    steps: [{ shout: hi }]\n", /no known action/);
  await bad("scenes:\n  - name: a\n    steps: [{ say: hi, volume: 3 }]\n", /has no "volume"/);
  await bad("scenes:\n  - name: a\n    steps: [{ say: hi, loud: maybe }]\n", /must be one of yes, no/);
  await bad("scenes:\n  - name: a\n    steps: [{ hud: on }]\n", /only works in setup/);
  await bad("scenes:\n  - name: a\n    steps: [{ say: x, id: k }, { say: y, id: k }]\n", /used twice/);
  await bad("capture: { fps: 45 }\nscenes:\n  - name: a\n    steps: [{ say: hi }]\n", /capture.fps/);
  await bad("capture: { zoom: 2 }\nscenes:\n  - name: a\n    steps: [{ say: hi }]\n", /capture takes fps and scale/);
  await bad("sfx: loud\nscenes:\n  - name: a\n    steps: [{ say: hi }]\n", /sfx must be true or false/);
  await bad("tempo: fast\nscenes:\n  - name: a\n    steps: [{ say: hi }]\n", /unknown key "tempo"/);
});

test("capture and sound options carry through to the recording", async () => {
  const play = await load(`capture: { fps: 30, scale: 3 }\nsfx: true\nsetup: [{ hud: on }]\nscenes:\n  - name: a\n    steps: [{ say: hi }]\n`);
  assert.deepEqual(play.capture, { fps: 30, scale: 3 });
  assert.equal(play.sfx, true);
  const s = stage(); await play.scenario.prepare(s);
  assert.deepEqual(s.log, ["hud"]);
});
