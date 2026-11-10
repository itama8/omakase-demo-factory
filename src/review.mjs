import http from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rename, realpath, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { parse, parseDocument } from "yaml";
import { compileEdit, spansOf } from "./edit.mjs";
import { planFilm } from "./film.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const missing = (error) => { if (error.code === "ENOENT") return ""; throw error; };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".mp4": "video/mp4", ".m4a": "audio/mp4", ".png": "image/png", ".ttf": "font/ttf" };

/** Local editable review, deliberately independent of a particular model CLI. */
export async function serveReview({ root, name, build, port = 0, renderCommand }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Demo name must contain lowercase letters, digits and dashes");
  const out = path.join(root, "out", name), file = path.join(root, "screenplays", name, "edit.yaml");
  let busy = false, job = { state: "idle", log: "" }, child;
  const readState = async () => {
    const [source, takeText] = await Promise.all([readFile(file, "utf8").catch(missing), readFile(path.join(out, "take.json"), "utf8")]);
    const take = JSON.parse(takeText), document = parse(source) ?? { edits: [] };
    const film = planFilm(take, compileEdit(document, take.beats));
    const revision = hash(source + takeText);
    return { name, revision, edits: document.edits ?? [], spans: spansOf(take.beats), film, job: { ...job, current: job.revision === revision }, source };
  };
  // Fail before announcing a link if there is no usable take.
  await readState();
  const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  async function body(req) {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw fail("Expected application/json", 415);
    let text = "";
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 256 * 1024) throw fail("Edit is too large", 413); }
    try { return JSON.parse(text); } catch { throw fail("Invalid JSON"); }
  }
  async function sendFile(req, res, target, base) {
    const resolved = await realpath(target), allowed = await realpath(base);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw fail("File outside preview", 403);
    const info = await stat(resolved);
    if (!info.isFile()) throw fail("Not a file", 404);
    const headers = { "Content-Type": mime[path.extname(resolved)] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
    let start = 0, end = info.size - 1;
    if (req.headers.range) {
      const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2])) throw fail("Invalid byte range", 416);
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size) { res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return; }
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(req.headers.range ? 206 : 200, headers);
    if (req.method === "HEAD") { res.end(); return; }
    const stream = createReadStream(resolved, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
  let origin;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) throw fail("Unexpected host", 403);
      if (req.headers.origin && req.headers.origin !== origin) throw fail("Preview is same-origin only", 403);
      const url = new URL(req.url, origin);
      if (req.method === "GET" && url.pathname === "/api/state") {
        const { source, ...state } = await readState(); json(res, 200, state); return;
      }
      if (req.method === "POST" && url.pathname === "/api/preview") {
        const data = await body(req), current = await readState();
        if (data.revision !== current.revision) throw fail("Saved edits changed. Reload to continue.", 409);
        if (!Array.isArray(data.edits)) throw fail("edits must be an array");
        const take = JSON.parse(await readFile(path.join(out, "take.json"), "utf8"));
        json(res, 200, { film: planFilm(take, compileEdit({ edits: data.edits }, take.beats)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/edit") {
        if (busy) throw fail("An export or save is running. Try again when it finishes.", 409);
        busy = true;
        try {
          const data = await body(req), current = await readState();
          if (data.revision !== current.revision) throw fail("The agent or another browser changed this demo. Reload before saving.", 409);
          if (!Array.isArray(data.edits)) throw fail("edits must be an array");
          const take = JSON.parse(await readFile(path.join(out, "take.json"), "utf8"));
          planFilm(take, compileEdit({ edits: data.edits }, take.beats));
          const document = parseDocument(current.source || "edits: []\n");
          document.set("edits", data.edits);
          await mkdir(path.join(out, "edit-history"), { recursive: true });
          await writeFile(path.join(out, "edit-history", `${Date.now()}-${randomUUID()}.yaml`), current.source);
          const pending = `${file}.${randomUUID()}.tmp`;
          await writeFile(pending, String(document)); await rename(pending, file);
          try { await build(); }
          catch (error) { await writeFile(file, current.source); await build().catch(() => {}); throw error; }
          const { source, ...state } = await readState(); json(res, 200, state);
        } finally { busy = false; }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/render") {
        if (busy) throw fail("An export or save is already running", 409);
        busy = true;
        try {
          const data = await body(req), state = await readState();
          if (data.revision !== state.revision) throw fail("Reload the latest edit before exporting", 409);
          await build();
          job = { state: "running", revision: state.revision, log: "" };
          const command = renderCommand ?? [process.execPath, path.join(root, "bin/demo.mjs"), "render", name];
          child = spawn(command[0], command.slice(1), { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
          const log = (data) => { job.log = (job.log + data).slice(-12_000); };
          child.stdout.on("data", log); child.stderr.on("data", log);
          child.once("error", (error) => { job.state = "failed"; job.log += error.message; busy = false; });
          child.once("exit", (code) => { job.state = code === 0 ? "ready" : "failed"; busy = false; child = null; });
          json(res, 202, job);
        } catch (error) { busy = false; throw error; }
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) throw fail("Method not allowed", 405);
      if (url.pathname === "/") return await sendFile(req, res, path.join(root, "review/index.html"), path.join(root, "review"));
      if (url.pathname.startsWith("/project/")) return await sendFile(req, res, path.resolve(out, "." + decodeURIComponent(url.pathname)), path.join(out, "project"));
      if (["/review.js", "/review.css", "/edits.js", "/timeline.js", "/camera-grid.js"].includes(url.pathname)) return await sendFile(req, res, path.join(root, "review", url.pathname.slice(1)), path.join(root, "review"));
      if (url.pathname === "/download") {
        const state = await readState();
        if (job.state !== "ready" || job.revision !== state.revision) throw fail("Export the current edit first", 409);
        res.setHeader("Content-Disposition", `attachment; filename="${name}.mp4"`);
        return await sendFile(req, res, path.join(out, `${name}.mp4`), out);
      }
      throw fail("Not found", 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, error.status ?? (error.code === "ENOENT" ? 404 : 400), { error: error.message });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Preview: ${origin}/\nEdits: ${file}\nKeep this process running while reviewing.`);
  return { server, url: origin + "/", close: async () => { child?.kill("SIGTERM"); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}
