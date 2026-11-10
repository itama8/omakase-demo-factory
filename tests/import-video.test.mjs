import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { importVideo, probeVideo } from "../src/import-video.mjs";
import { serveFactory, libraryProjects } from "../src/factory.mjs";
import { importCards } from "../review/range-edits.js";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "demo-import-"));
  const source = path.join(root, "my original recording.mov");
  const made = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=96x64:rate=30:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  assert.equal(made.status, 0, made.stderr?.toString());
  return { root, source };
}
test("import copies a video into a normal take, retains sound and source, and refuses overwrites or invalid media", async () => {
  const { root, source } = await fixture();
  try {
    const before = hash(await readFile(source));
    const a = await importVideo({ root, source, title: "My recording" });
    assert.equal(a.name, "my-recording");
    assert.equal(a.take.audio, true);
    assert.equal(a.take.beats[1].id, "clip");
    assert.ok(
      (await probeVideo(path.join(root, "out", a.name, "take.mp4"))).audio,
    );
    assert.equal(hash(await readFile(source)), before);
    assert.deepEqual(
      parse(
        await readFile(
          path.join(root, "screenplays", a.name, "edit.yaml"),
          "utf8",
        ),
      ),
      { edits: [] },
    );
    await assert.rejects(
      importVideo({ root, source, name: a.name }),
      /already exists/,
    );
    const b = await importVideo({ root, source, title: "My recording" });
    assert.equal(b.name, "my-recording-2");
    const bad = path.join(root, "not-video.mp4");
    await writeFile(bad, "not a recording");
    await assert.rejects(importVideo({ root, source: bad }), /Could not read/);
    await assert.rejects(
      importVideo({ root, source, name: "../escape" }),
      /demo name/,
    );
    await mkdir(path.join(root, "out", "reserved"));
    await writeFile(path.join(root, "out", "reserved", "keep"), "keep");
    await assert.rejects(
      importVideo({ root, source, name: "reserved" }),
      /EEXIST/,
    );
    assert.equal(
      await readFile(path.join(root, "out", "reserved", "keep"), "utf8"),
      "keep",
    );
    assert.deepEqual(
      (await libraryProjects(root)).map((p) => p.name),
      [a.name, b.name],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("library uploads and opens a video without a built Omakase app; AI edits use the same persisted edit API", async () => {
  const { root, source } = await fixture();
  let factory;
  try {
    await symlink(path.join(repo, "review"), path.join(root, "review"));
    await symlink(path.join(repo, "template"), path.join(root, "template"));
    await symlink(
      path.join(repo, "node_modules"),
      path.join(root, "node_modules"),
    );
    factory = await serveFactory({
      root,
      omakaseRoot: path.join(root, "no-app"),
      port: 0,
    });
    const upload = await fetch(
      new URL("api/import?filename=My%20video.mov", factory.url),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: await readFile(source),
      },
    );
    assert.equal(upload.status, 201);
    const imported = await upload.json();
    const stateUrl = new URL("api/state", imported.url);
    let state = await (await fetch(stateUrl)).json();
    assert.equal(state.title, "My video");
    assert.equal(state.factoryUrl, factory.url.slice(0, -1));
    assert.equal(state.film.logo, 0);
    assert.equal(state.film.sourceAudio, true);
    const html = await (
      await fetch(new URL("project/index.html", imported.url))
    ).text();
    assert.match(html, /original-audio/);
    assert.equal(
      (
        await probeVideo(
          path.join(
            root,
            "out",
            imported.name,
            "project",
            "assets",
            "take.mp4",
          ),
        )
      ).audio,
      false,
    );
    assert.doesNotMatch(html, /__FONTFACE__|__LOGOMARK__/);
    const opened = await fetch(new URL(`open/${imported.name}`, factory.url), {
      redirect: "manual",
    });
    assert.equal(opened.headers.get("location"), imported.url);
    // Agent-authored YAML needs no origin tag or browser-specific fields.
    const file = path.join(root, "screenplays", imported.name, "edit.yaml");
    await writeFile(
      file,
      "# Agent edit kept alongside browser edits\nedits:\n  - caption: From AI\n    over: clip\n  - speed: 2\n    over: clip@start .. clip@end\n",
    );
    const next = await (await fetch(stateUrl)).json();
    assert.notEqual(next.revision, state.revision);
    assert.equal(importCards(next.edits, next.spans).length, 1);
    const edited = next.edits.map((e) =>
      "caption" in e
        ? { ...e, caption: "Adjusted by hand", box: [0.2, 0.3, 0.6, 0.15] }
        : e,
    );
    const save = await fetch(new URL("api/edit", imported.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: next.revision, edits: edited }),
    });
    assert.equal(save.status, 200);
    const saved = parse(await readFile(file, "utf8"));
    assert.equal(saved.edits[0].caption, "Adjusted by hand");
    assert.match(await readFile(file, "utf8"), /Agent edit kept/);
    assert.equal(
      (await fetch(new URL("api/projects", factory.url))).status,
      200,
    );
    const rejected = await fetch(new URL("api/import", factory.url), {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/octet-stream",
      },
      body: "x",
    });
    assert.equal(rejected.status, 400);
    const bad = await fetch(
      new URL("api/import?filename=bad.mp4", factory.url),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "bad video",
      },
    );
    assert.equal(bad.status, 400);
    assert.equal((await libraryProjects(root)).length, 1);
    assert.deepEqual(await readdir(path.join(root, "out", ".uploads")), []);
  } finally {
    await factory?.close();
    await rm(root, { recursive: true, force: true });
  }
});
