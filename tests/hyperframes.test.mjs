import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHyperframes } from "../src/hyperframes.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "demo-hyperframes-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, "renderer.mjs");
  await writeFile(script, `
    import { mkdir, writeFile } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    const [name, mode] = process.argv.slice(2);
    await mkdir(process.env.HYPERFRAMES_EXTRACT_CACHE_DIR, {recursive:true});
    await writeFile(path.join(process.env.HYPERFRAMES_EXTRACT_CACHE_DIR, 'frame.jpg'), 'cache');
    await writeFile(path.join(os.tmpdir(), 'scratch'), 'temporary');
    await writeFile(name + '.json', JSON.stringify({temporary:os.tmpdir(), cache:process.env.HYPERFRAMES_EXTRACT_CACHE_DIR}));
    if (mode === 'interrupt') process.kill(process.ppid, 'SIGTERM');
    if (mode === 'interrupt') setInterval(() => {}, 1000);
    else process.exitCode = mode === 'fail' ? 7 : 0;
  `);
  await mkdir(path.join(root, "takes"));
  await writeFile(path.join(root, "takes", "original.mp4"), "keep");
  return { root, run: (name, mode) => runHyperframes({ root, cwd: root, command: process.execPath, prefix: [script], args: [name, mode] }) };
}

test("concurrent renders use private disk-backed caches and retain outputs", async (t) => {
  const { root, run } = await fixture(t);
  await Promise.all([run("first", "ok"), run("second", "ok")]);
  const first = JSON.parse(await readFile(path.join(root, "first.json")));
  const second = JSON.parse(await readFile(path.join(root, "second.json")));
  assert.notEqual(first.temporary, second.temporary);
  assert.equal(first.cache, path.join(first.temporary, "frames"));
  assert.equal(path.dirname(first.temporary), path.join(root, "out", "tmp", "hyperframes"));
  assert.deepEqual(await readdir(path.join(root, "out", "tmp", "hyperframes")), []);
  assert.equal(await readFile(path.join(root, "takes", "original.mp4"), "utf8"), "keep");
});

test("failed renders clean their scratch files", async (t) => {
  const { root, run } = await fixture(t);
  await assert.rejects(run("failed", "fail"), /exit 7/);
  assert.deepEqual(await readdir(path.join(root, "out", "tmp", "hyperframes")), []);
});

test("cancellation forwards the signal and cleans scratch files", async (t) => {
  const { root, run } = await fixture(t);
  await assert.rejects(run("cancelled", "interrupt"), /SIGTERM/);
  assert.deepEqual(await readdir(path.join(root, "out", "tmp", "hyperframes")), []);
});

test("failure to start the renderer also cleans scratch files", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(runHyperframes({ root, cwd: root, command: path.join(root, "missing"), args: ["render"] }), /ENOENT/);
  assert.deepEqual(await readdir(path.join(root, "out", "tmp", "hyperframes")), []);
});
