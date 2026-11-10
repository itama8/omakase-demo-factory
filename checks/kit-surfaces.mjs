// Focused real-app proof for the kit's PDF and browser interactions.
// Uses a local page and the existing PDF fixture; no external site/model.
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { actions, app } from "../actions/omakase.mjs";
import { loadScreenplay } from "../src/screenplay.mjs";
import { recordTake } from "../src/recorder.mjs";
import { setup } from "../screenplays/table-sushi-loading/replies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const omakaseRoot = process.env.OMAKASE_ROOT ?? path.resolve(root, "../omakase-v2");
const dir = await mkdtemp(path.join(os.tmpdir(), "demo-kit-surfaces-"));
const server = http.createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Demo research</title><h1>Cache study reference</h1>"); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await setup(dir);
  const file = path.join(dir, "screenplay.yaml");
  await writeFile(file, stringify({ title: "Kit research surfaces", scenes: [{ name: "research", steps: [
    { type: "# Research\n" },
    { "open-pdf": path.join(dir, "CPHEEO sewerage manual excerpt.pdf"), reads: "Contributory population" },
    { "pdf-passage": "Contributory population", through: "Treatment units" },
    { browser: `http://127.0.0.1:${server.address().port}/` },
    { browser: "closed" }
  ] }] }));
  const play = await loadScreenplay(file, { actions, app, omakaseRoot });
  await recordTake({ scenario: play.scenario, omakaseRoot, outDir: dir, record: false, pace: 0, scale: 1 });
  console.log("PASS: PDF open, text selection sent to Sushi, local browser navigation and close");
} finally { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
