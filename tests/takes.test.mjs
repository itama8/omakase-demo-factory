import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listTakes, spliceBeats, useTake } from "../src/takes.mjs";

const scene = (id, from, to) => [{ type: "span-start", id, t: from }, { type: "key", t: (from + to) / 2 }, { type: "span-end", id, t: to }];
const old = { fps: 60, beats: [{ type: "start", t: 0.5 }, ...scene("one", 0.5, 4), ...scene("two", 4, 9), ...scene("three", 9, 12), { type: "end", t: 12 }] };

test("splicing a longer scene moves the scenes after it, and keeps those before it", () => {
  const part = { beats: [{ type: "start", t: 0.2 }, ...scene("two", 0.2, 7.2), { type: "end", t: 7.2 }] };
  const { beats, segments } = spliceBeats(old, part, "two");
  const at = (type, id) => beats.find((beat) => beat.type === type && beat.id === id).t;
  assert.equal(at("span-start", "one"), 0.5);
  assert.equal(at("span-start", "two"), 4);
  assert.equal(at("span-end", "two"), 11);
  assert.equal(at("span-start", "three"), 11);
  assert.equal(beats.at(-1).t, 14);
  assert.deepEqual(segments, [{ source: "old", from: 0, to: 4 }, { source: "part", from: 0.2, to: 7.2 }, { source: "old", from: 9, to: null }]);
  assert.deepEqual(spliceBeats(old, part, "two").joins, [4, 11]);
  // Retaking the last scene keeps the earlier joins, shifted by nothing before it.
  const again = spliceBeats({ ...old, joins: [4, 9] }, { beats: scene("three", 1, 2) }, "three");
  assert.deepEqual(again.joins, [4, 9, 10]);
});

test("splicing the first scene drops a head too short to cut", () => {
  const tight = { fps: 60, beats: [{ type: "start", t: 0 }, ...scene("one", 0.01, 4), ...scene("two", 4, 9), { type: "end", t: 9 }] };
  const part = { beats: [...scene("one", 0.3, 2.3)] };
  const { beats, segments } = spliceBeats(tight, part, "one");
  assert.equal(segments[0].source, "part");
  assert.equal(beats.find((beat) => beat.id === "two").t, 2);
  assert.throws(() => spliceBeats(tight, part, "missing"), /no scene "missing"/);
});

test("switching takes repoints take.json and take.mp4, and the list marks the one in use", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "demo-takes-"));
  for (const [id, duration] of [["100-a", 5], ["200-b", 7]]) {
    await mkdir(path.join(out, "takes", id), { recursive: true });
    await writeFile(path.join(out, "takes", id, "take.json"), JSON.stringify({ fps: 60, duration, beats: [] }));
    await writeFile(path.join(out, "takes", id, "take.mp4"), "");
  }
  await useTake(out, "100-a");
  assert.equal(JSON.parse(await readFile(path.join(out, "take.json"), "utf8")).video, "takes/100-a/take.mp4");
  assert.equal(await readlink(path.join(out, "take.mp4")), "takes/100-a/take.mp4");
  assert.deepEqual((await listTakes(out)).map((take) => [take.id, take.current]), [["200-b", false], ["100-a", true]]);
  await useTake(out, "200-b");
  assert.equal((await listTakes(out)).find((take) => take.current).duration, 7);
  await assert.rejects(useTake(out, "../x"), /not a take id/);
  await assert.rejects(useTake(out, "300-c"), /No take/);
});
