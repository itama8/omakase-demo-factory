// Real-app recording proof; no provider, personal profile or desktop input.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { actions, app } from "../actions/omakase.mjs";
import { loadScreenplay } from "../src/screenplay.mjs";
import { recordTake } from "../src/recorder.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const omakaseRoot = process.env.OMAKASE_ROOT ?? path.resolve(root, "../omakase-v2");
const dir = await mkdtemp(path.join(os.tmpdir(), "demo-isolation-"));
const keys = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE", "ELECTRON_OZONE_PLATFORM_HINT", "GDK_SCALE", "GTK_USE_PORTAL", "DBUS_SESSION_BUS_ADDRESS"];
const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const cwd = process.cwd();
const restored = () => {
  assert.equal(process.cwd(), cwd);
  assert.deepEqual(Object.fromEntries(keys.map((key) => [key, process.env[key]])), before);
};
await mkdir(path.join(os.tmpdir(), "omakase-check"), { recursive: true });
try {
  const file = path.join(dir, "screenplay.yaml");
  await writeFile(file, stringify({
    title: "Private recording and PDF readiness",
    vault: path.join(root, "screenplays/website-sushi/vault"),
    appearance: { theme: "retro-82" },
    setup: [{ sidebar: "open" }, { "open-note": "Sewer check" }, { "attach-pdf": path.join(root, "screenplays/website-sushi/manual.pdf") }],
    scenes: [{ name: "pages", steps: [{ "pdf-page": 4 }, { "pdf-page": 26 }, { pause: "500ms" }] }]
  }));
  const play = await loadScreenplay(file, { actions, app, omakaseRoot });
  const prepare = play.scenario.prepare;
  play.scenario.prepare = async (stage) => {
    const env = await stage.app.evaluateMain(`({ display: process.env.DISPLAY, wayland: process.env.WAYLAND_DISPLAY ?? null, bus: process.env.DBUS_SESSION_BUS_ADDRESS })`);
    assert.match(env.display, /^:(?:9\d|[1-3]\d\d)$/);
    assert.notEqual(env.display, before.DISPLAY);
    assert.equal(env.wayland, null);
    assert.ok(env.bus?.startsWith("unix:"));
    assert.notEqual(env.bus, before.DBUS_SESSION_BUS_ADDRESS);
    await prepare(stage);
    // These calls are intercepted; no browser or file manager may launch.
    await stage.app.evaluateMain(`(() => { const { shell } = ${stage.electron}; globalThis.__demoOpenResult = null; Promise.all([shell.openExternal("https://example.invalid/demo-isolation"), shell.openPath("/demo-isolation-missing")]).then((result) => { globalThis.__demoOpenResult = result[1]; }); return true; })()`);
    await stage.app.until("external opens are intercepted", async () => (await stage.app.evaluateMain("globalThis.__demoOpenResult")) === "");
    console.log(`PASS: app uses private X display ${env.display}, private session bus, and intercepted external opens`);
  };
  const take = await recordTake({ scenario: play.scenario, omakaseRoot, outDir: path.join(dir, "take"), width: 1680, height: 1000, fps: 30, scale: 2, pace: 1 });
  assert.equal(take.appearance.theme, "retro-82");
  assert.ok(take.captured >= 27, `capture fell behind: ${take.captured}`);
  restored();
  await assert.rejects(recordTake({ scenario: { name: "expected-failure", prepare: async () => { throw new Error("expected isolation failure"); } }, omakaseRoot, outDir: dir, record: false, scale: 1 }), /expected isolation failure/);
  restored();
  console.log("PASS: PDF pages reach sharp projections; recording succeeds; success and failure restore the caller environment");
} finally {
  await rm(dir, { recursive: true, force: true });
}
