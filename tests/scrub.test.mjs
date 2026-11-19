import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, chmod, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { scrubCopy, SCRUB_ARGS } from "../src/scrub.mjs";

test("the scrub copy has a keyframe every 0.2s and no audio", () => {
  const args = SCRUB_ARGS("in.mp4", "out.part");
  assert.equal(args[args.indexOf("-g") + 1], "6");
  assert.equal(args[args.indexOf("-r") + 1], "30");
  assert.ok(args.includes("-an"));
  assert.equal(args.at(-1), "out.part");
});

test("a scrub copy is made once per take, replaced when the take changes, and never served half-written", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scrub-")),
    out = path.join(root, "out"),
    assets = path.join(out, "project", "assets");
  await mkdir(assets, { recursive: true });
  // Stands in for ffmpeg: writes its last argument after a short pause.
  const fake = path.join(root, "fake-ffmpeg");
  await writeFile(fake, '#!/bin/sh\nfor a; do last="$a"; done\nsleep 0.2\necho copy > "$last"\n');
  await chmod(fake, 0o755);
  try {
    await writeFile(path.join(assets, "take.mp4"), "first take");
    const scrub = scrubCopy(out, { command: fake });
    await scrub.refresh();
    assert.equal(scrub.url, null);
    for (let i = 0; i < 50 && !scrub.url; i++) await delay(50);
    const first = scrub.url;
    assert.match(first, /^\/scrub\.mp4\?v=[0-9a-f]{16}$/);
    assert.deepEqual(await readdir(scrub.folder), [path.basename(scrub.file)]);
    await writeFile(path.join(assets, "take.mp4"), "second, longer take");
    await scrub.refresh();
    assert.equal(scrub.url, null);
    for (let i = 0; i < 50 && !scrub.url; i++) await delay(50);
    assert.notEqual(scrub.url, first);
    assert.deepEqual(await readdir(scrub.folder), [path.basename(scrub.file)]);
    scrub.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without a project take there is no scrub copy, and nothing is created", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scrub-"));
  try {
    const scrub = scrubCopy(path.join(root, "out"));
    await scrub.refresh();
    assert.equal(scrub.url, null);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
