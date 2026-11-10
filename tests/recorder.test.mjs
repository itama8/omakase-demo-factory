import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdir, open, unlink } from "node:fs/promises";
import { freeDisplay } from "../src/recorder.mjs";

test("private display selection skips X locks, pathname sockets and abstract sockets", { skip: process.platform !== "linux" }, async () => {
  await mkdir("/tmp/.X11-unix", { recursive: true, mode: 0o1777 });
  assert.ok(await freeDisplay() >= 90);
  const number = await freeDisplay(390, 400);
  const lock = `/tmp/.X${number}-lock`;
  const file = await open(lock, "wx");
  try { assert.notEqual(await freeDisplay(number, 401), number); }
  finally { await file.close(); await unlink(lock); }
  for (const socket of [`/tmp/.X11-unix/X${number}`, `\0/tmp/.X11-unix/X${number}`]) {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
    try { assert.notEqual(await freeDisplay(number, 401), number); }
    finally { await new Promise((resolve) => server.close(resolve)); }
  }
});
