import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { serveReview } from "../src/review.mjs";

test("review saves persist, reject stale edits, roll back failed builds, and constrain served files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "demo-review-test-"));
  const out = path.join(root, "out/demo"), dir = path.join(root, "screenplays/demo");
  await mkdir(path.join(out, "project/assets"), { recursive: true }); await mkdir(dir, { recursive: true }); await mkdir(path.join(root, "review"));
  const file = path.join(dir, "edit.yaml");
  const beats = [{ type: "start", t: 0 }, { type: "span-start", id: "hello", t: 0 }, { type: "span-end", id: "hello", t: 5 }, { type: "end", t: 5 }];
  await writeFile(path.join(out, "take.json"), JSON.stringify({ beats }));
  await writeFile(file, "# Keep my comment\nedits: []\n");
  await writeFile(path.join(root, "review/index.html"), "<h1>Review</h1>");
  await writeFile(path.join(root, "review/review.css"), "body{}");
  await writeFile(path.join(out, "project/assets/take.mp4"), "0123456789");
  await writeFile(path.join(root, "private.txt"), "private");
  await symlink(path.join(root, "private.txt"), path.join(out, "project/leak.txt"));
  let broken = false;
  const service = await serveReview({ root, name: "demo", build: async () => { if (broken) throw new Error("build failed"); }, renderCommand: [process.execPath, "-e", "process.exit(1)"] });
  const get = (pathname, options) => fetch(new URL(pathname, service.url), options);
  const post = (pathname, data, headers = {}) => get(pathname, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
  try {
    const initial = await (await get("api/state")).json();
    assert.equal((await get("review.css")).headers.get("content-type"), "text/css");
    const edits = [{ speed: 2, over: "hello" }, { caption: "One useful moment", over: "hello" }];
    const preview = await post("api/preview", { revision: initial.revision, edits });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).film.duration, 5.1);
    assert.deepEqual(parse(await readFile(file, "utf8")).edits, []);
    assert.equal((await post("api/preview", { revision: initial.revision, edits: [{ cut: "hello" }] })).status, 400);
    const saved = await post("api/edit", { revision: initial.revision, edits }); assert.equal(saved.status, 200);
    const state = await saved.json(); assert.equal(state.film.duration, 5.1);
    assert.equal((await post("api/preview", { revision: initial.revision, edits: [] })).status, 409);
    assert.deepEqual(parse(await readFile(file, "utf8")).edits, edits); assert.match(await readFile(file, "utf8"), /Keep my comment/);
    assert.equal((await readdir(path.join(out, "edit-history"))).length, 1);
    assert.equal((await post("api/edit", { revision: initial.revision, edits: [] })).status, 409);
    assert.deepEqual(parse(await readFile(file, "utf8")).edits, edits);
    assert.equal((await post("api/edit", { revision: state.revision, edits: [{ cut: "hello" }] })).status, 400);
    assert.equal((await post("api/edit", { revision: state.revision, edits: [] }, { Origin: "https://unrelated.example" })).status, 403);
    broken = true;
    assert.equal((await post("api/edit", { revision: state.revision, edits: [] })).status, 400);
    assert.deepEqual(parse(await readFile(file, "utf8")).edits, edits);
    broken = false;
    const range = await get("project/assets/take.mp4", { headers: { Range: "bytes=2-5" } }); assert.equal(range.status, 206); assert.equal(await range.text(), "2345");
    assert.equal((await get("project/leak.txt")).status, 403);
    assert.equal((await get("private.txt")).status, 404);
    assert.equal((await get("download")).status, 409);
    const render = await post("api/render", { revision: state.revision }); assert.equal(render.status, 202);
    let latest;
    for (let i = 0; i < 50; i++) { latest = await (await get("api/state")).json(); if (latest.job.state !== "running") break; await new Promise((resolve) => setTimeout(resolve, 20)); }
    assert.equal(latest.job.state, "failed");
    assert.equal((await get("download")).status, 409);
    assert.equal((await post("api/edit", { revision: state.revision, edits: [] })).status, 200);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});
