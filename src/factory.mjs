// A loopback-only library. Editors share the existing review server and edit.yaml.
import http from "node:http";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  importVideo,
  importedSettings,
  safeDemoName,
} from "./import-video.mjs";
import { buildProject } from "./project.mjs";
import { serveReview } from "./review.mjs";
import { filmOptions } from "./film.mjs";

export async function demoSettings({ root, omakaseRoot, name }) {
  safeDemoName(name);
  try {
    return await importedSettings(root, name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const doc = parse(
    await readFile(
      path.join(root, "screenplays", name, "screenplay.yaml"),
      "utf8",
    ),
  );
  return {
    name,
    title: doc.title ?? name,
    film: doc.film ?? {},
    music: doc.music ? path.resolve(omakaseRoot, doc.music) : null,
    sfx: doc.sfx ?? false,
  };
}
export async function libraryProjects(root) {
  const entries = await readdir(path.join(root, "out"), {
    withFileTypes: true,
  }).catch(() => []);
  const projects = [];
  for (const item of entries) {
    if (!item.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/.test(item.name))
      continue;
    try {
      const take = JSON.parse(
        await readFile(path.join(root, "out", item.name, "take.json"), "utf8"),
      );
      let title = item.name.replaceAll("-", " ");
      try {
        title = JSON.parse(
          await readFile(
            path.join(root, "screenplays", item.name, "video.json"),
            "utf8",
          ),
        ).title;
      } catch {
        try {
          title =
            parse(
              await readFile(
                path.join(root, "screenplays", item.name, "screenplay.yaml"),
                "utf8",
              ),
            ).title ?? title;
        } catch {
          continue;
        }
      }
      projects.push({
        name: item.name,
        title,
        duration: take.duration,
        imported: !!take.imported,
        url: `/open/${item.name}`,
      });
    } catch {
      /* An unfinished recording is not ready to edit. */
    }
  }
  return projects.sort((a, b) => a.title.localeCompare(b.title));
}
export async function serveFactory({ root, omakaseRoot, port = 4310 }) {
  const editors = new Map(),
    opening = new Map();
  let origin,
    importing = false;
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  async function openDemo(name) {
    safeDemoName(name);
    if (editors.has(name)) return editors.get(name);
    if (opening.has(name)) return opening.get(name);
    const pending = (async () => {
      const settings = await demoSettings({ root, omakaseRoot, name });
      const build = () =>
        buildProject({ root, omakaseRoot, name, ...settings });
      await build();
      const editor = await serveReview({
        root,
        name,
        build,
        film: filmOptions(settings.film),
        title: settings.title,
        factoryUrl: origin,
      });
      editors.set(name, editor);
      return editor;
    })();
    opening.set(name, pending);
    try {
      return await pending;
    } finally {
      opening.delete(name);
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host)
        throw new Error("Unexpected host");
      if (req.headers.origin && req.headers.origin !== origin)
        throw new Error("Factory requests must come from this page.");
      const url = new URL(req.url, origin);
      if (req.method === "GET" && url.pathname === "/api/projects") {
        json(res, 200, { projects: await libraryProjects(root), importing });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/open/")) {
        const name = safeDemoName(decodeURIComponent(url.pathname.slice(6)));
        const editor = await openDemo(name);
        res.writeHead(302, { Location: editor.url });
        res.end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/import") {
        if (importing) {
          json(res, 409, {
            error: "A video is already importing. Wait for it to finish.",
          });
          return;
        }
        if (req.headers["content-type"] !== "application/octet-stream")
          throw new Error("Choose a video file to import.");
        importing = true;
        let temporary;
        try {
          const originalName = path.basename(
            url.searchParams.get("filename") ?? "video.mp4",
          );
          await mkdir(path.join(root, "out", ".uploads"), { recursive: true });
          temporary = await mkdtemp(
            path.join(root, "out", ".uploads", "upload-"),
          );
          let bytes = 0;
          const limit = 4 * 1024 ** 3;
          const count = new Transform({
            transform(chunk, encoding, callback) {
              bytes += chunk.length;
              callback(
                bytes > limit
                  ? new Error("Choose a video smaller than 4 GB.")
                  : null,
                chunk,
              );
            },
          });
          const file = path.join(temporary, "source");
          await pipeline(req, count, createWriteStream(file, { flags: "wx" }));
          const imported = await importVideo({
            root,
            source: file,
            title: url.searchParams.get("title"),
            originalName,
          });
          const editor = await openDemo(imported.name);
          json(res, 201, { name: imported.name, url: editor.url });
        } finally {
          importing = false;
          if (temporary) await rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      const pages = {
        "/": ["factory.html", "text/html"],
        "/factory.js": ["factory.js", "text/javascript"],
        "/factory.css": ["factory.css", "text/css"],
      };
      if (req.method === "GET" && pages[url.pathname]) {
        const [file, type] = pages[url.pathname];
        const content = await readFile(path.join(root, "review", file));
        res.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-cache",
        });
        res.end(content);
        return;
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      if (!res.headersSent)
        json(res, error.code === "ENOENT" ? 404 : 400, {
          error: error.message,
        });
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(
    `Demo factory: ${origin}/\nKeep this terminal running. Use Import video to add a recording.`,
  );
  return {
    server,
    url: origin + "/",
    close: async () => {
      await Promise.all([...editors.values()].map((e) => e.close()));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
