// Notes, tabs, panes and PDFs: moves from the website video kit, rebuilt on
// the factory's recorder. Every click goes through stage.click, so the film
// draws the pointer, and every move waits on the app before it returns.
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as settle } from "node:timers/promises";

const q = JSON.stringify;
const text = { type: "text", required: true };
const NOTE_NAME = "document.getElementById('noteNameBtn').textContent.trim()";
const ACTIVE_TAB = "document.querySelector('#noteTabStrip .note-tab.active .note-tab-name')?.textContent.trim()";
const CARD = "[...document.querySelectorAll('.cm-invocation-card')].at(-1)";
const PDF_VIEWPORT = "#pdfViewerViewport";
const PDF_READY = "document.querySelectorAll('#pdfViewerPages .pdf-viewer-text-layer span').length > 0";
// Scrolling can first show a low-resolution cached page. Wait for the sharp
// projection and its text, rather than spending the scene's hold on a placeholder.
const sharpPage = (page) => `(() => {
  const slot = ${page};
  const projection = slot?.querySelector('.pdf-page-projection:not(.pdf-page-projection-preparing):not(.pdf-page-projection-cached)');
  return !!projection?.querySelector('.pdf-viewer-text-layer span') && !!projection?.querySelector('canvas')?.width;
})()`;

/**
 * Mark the element an expression finds, so a click can name it with a
 * selector. Text is matched exactly after trimming, or by inclusion with `~`.
 */
async function mark(stage, label, find) {
  const found = await stage.app.evaluate(`(() => {
    document.querySelectorAll('[data-demo-target]').forEach((e) => delete e.dataset.demoTarget);
    const e = (${find})();
    if (!e) return false;
    e.dataset.demoTarget = "one";
    return true;
  })()`);
  if (!found) throw new Error(`${label} is not on screen`);
  return '[data-demo-target="one"]';
}
const byText = (selector, value) => `() => [...document.querySelectorAll(${q(selector)})].find((e) => e.offsetParent && e.textContent.trim() === ${q(value)})`;
const holding = (selector, value) => `() => [...document.querySelectorAll(${q(selector)})].find((e) => e.offsetParent && e.textContent.includes(${q(value)}))`;
const arrive = (stage, note) => stage.until(`"${note}" is open`, `${NOTE_NAME} === ${q(note)} && !!document.querySelector('#cm6EditorHost .cm-content')`);

export const noteActions = {
  "open-note": {
    summary: "Open a note by clicking it in the sidebar. The sidebar must be open.",
    args: { value: text },
    async run(stage, { value }) {
      await stage.until(`sidebar lists "${value}"`, `!!(${holding(".note-item", value)})()`);
      await stage.click(await mark(stage, `sidebar note "${value}"`, holding(".note-item", value)));
      await arrive(stage, value);
      stage.beat("land", { box: await stage.box("#cm6EditorHost .cm-content") });
    }
  },
  "follow-link": {
    summary: "Ctrl-click a [[link]] in the note to open its note in a new tab.",
    args: { value: { type: "text", required: true, doc: "the link's text" }, lands: { type: "text", doc: "the note it must open; defaults to the link text" } },
    async run(stage, { value, lands }) {
      const link = byText("#cm6EditorHost .cm-wikilink-resolved", value);
      await stage.until(`link "${value}"`, `!!(${link})()`);
      await stage.click(await mark(stage, `link "${value}"`, link), { ctrl: true });
      await stage.until(`tab "${lands ?? value}" is active`, `${ACTIVE_TAB} === ${q(lands ?? value)}`);
      await arrive(stage, lands ?? value);
    }
  },
  back: {
    summary: "Go back to the previous tab with Ctrl+R.",
    args: { value: { type: "text", required: true, doc: "the note it must return to" } },
    async run(stage, { value }) {
      await stage.chord("Ctrl+R");
      await stage.until(`back in "${value}"`, `${ACTIVE_TAB} === ${q(value)}`);
      await arrive(stage, value);
    }
  },
  tab: {
    summary: "Click a tab in the left pane's tab strip.",
    args: { value: text },
    async run(stage, { value }) {
      await stage.click(await mark(stage, `tab "${value}"`, `() => [...document.querySelectorAll('#noteTabStrip .note-tab')].find((e) => e.querySelector('.note-tab-name')?.textContent.trim() === ${q(value)})`));
      await stage.until(`tab "${value}" is active`, `${ACTIVE_TAB} === ${q(value)}`);
      await arrive(stage, value);
    }
  },
  "note-menu": {
    summary: "Right-click a note in the sidebar and choose from its menu.",
    args: { value: { type: "text", required: true, doc: "the note" }, choose: { type: "enum", values: ["right-pane"], required: true, doc: "right-pane moves the note beside the current one" } },
    async run(stage, { value, choose }) {
      await stage.click(await mark(stage, `sidebar note "${value}"`, holding(".note-item", value)), { button: "right" });
      const item = `.note-context-menu [data-note-action=${q(choose)}]`;
      await stage.until("note menu", `!!document.querySelector(${q(item)})`);
      await stage.show("modal", ".note-context-menu");
      await stage.pause(500);
      await stage.click(item);
      if (choose === "right-pane") await stage.until(`"${value}" in the right pane`, `[...document.querySelectorAll('#rightNoteHeader .note-tab-name')].some((e) => e.textContent.trim() === ${q(value)})`);
    }
  },
  "attach-pdf": {
    summary: "Import a PDF (relative to the screenplay folder) into the current note, and open it beside the note from the asset library.",
    args: { value: text },
    async run(stage, { value }) {
      const file = path.resolve(stage.dir, value);
      await access(file);
      const imported = await stage.app.evaluate(`(async () => { const notePath = document.querySelector('.note-item.active')?.dataset.path; if (!notePath) return 'no note is open'; const r = await window.omakase.importPdfAsset({ sourcePath: ${q(file)}, notePath }); return r.ok ? true : (r.error ?? 'import failed'); })()`);
      if (imported !== true) throw new Error(`attach-pdf: ${imported}`);
      const library = ".asset-library-list";
      if (!(await stage.app.evaluate(`!!document.querySelector(${q(library)})?.offsetParent`))) await stage.click("#assetLibraryHudToggle");
      const name = path.basename(value, path.extname(value));
      const entry = `() => [...document.querySelectorAll('.asset-library-name')].find((e) => e.offsetParent && e.textContent.includes(${q(name)}))?.closest('button')`;
      await stage.until(`library lists ${name}`, `!!(${entry})()`);
      await stage.click(await mark(stage, `library entry ${name}`, entry));
      await stage.until("PDF text ready", PDF_READY, { timeoutMs: 60_000 });
      if (await stage.app.evaluate(`!!document.querySelector(${q(library)})?.offsetParent`)) await stage.click("#assetLibraryHudToggle");
      await stage.until("library closed", `!document.querySelector(${q(library)})?.offsetParent`);
      stage.beat("pane", { kind: "pdf", box: await stage.box(PDF_VIEWPORT) });
    }
  },
  "pdf-page": {
    summary: "Scroll the open PDF to a page, the way a reader would.",
    args: { value: { type: "number", required: true, doc: "the page number, from 1" } },
    async run(stage, { value }) {
      const target = `(() => { const v = document.querySelector(${q(PDF_VIEWPORT)}); const page = document.querySelector('#pdfViewerPages').children[${value - 1}]; return page ? v.scrollTop + page.getBoundingClientRect().top - v.getBoundingClientRect().top - 24 : null; })()`;
      const to = await stage.app.evaluate(target);
      if (to === null) throw new Error(`the PDF has no page ${value}`);
      const from = await stage.app.evaluate(`document.querySelector(${q(PDF_VIEWPORT)}).scrollTop`);
      const steps = stage.pace > 0 ? 24 : 1;
      for (let i = 1; i <= steps; i++) {
        const eased = 1 - (1 - i / steps) ** 3;
        await stage.app.evaluate(`document.querySelector(${q(PDF_VIEWPORT)}).scrollTop = ${from + (to - from) * eased}, true`);
        await stage.pause(28);
      }
      await stage.until(`page ${value} is in view`, `Math.abs(document.querySelector(${q(PDF_VIEWPORT)}).scrollTop - ${to}) < 4`);
      await stage.until(`page ${value} has a sharp projection`, sharpPage(`document.querySelector('#pdfViewerPages').children[${value - 1}]`), { timeoutMs: 60_000 });
    }
  },
  citation: {
    summary: "Click the PDF citation in Sushi's last answer; the PDF jumps to the cited page.",
    args: {},
    async run(stage) {
      const chip = `() => ${CARD}?.querySelector('.cm-sushi-pdf-citation-chip')`;
      await stage.until("a PDF citation", `!!(${chip})()`);
      await stage.app.evaluate(`(${chip})().scrollIntoView({ block: 'center' }), true`);
      const before = await stage.app.evaluate(`document.querySelector(${q(PDF_VIEWPORT)})?.scrollTop ?? null`);
      await stage.click(await mark(stage, "the citation", chip));
      await stage.until("the PDF jumps to the citation", `!!document.querySelector('#pdfViewerPages .pdf-region-flash') || Math.abs((document.querySelector(${q(PDF_VIEWPORT)})?.scrollTop ?? 0) - ${before ?? 0}) > 40`, { timeoutMs: 10_000 });
      await stage.until("the cited page has a sharp projection", sharpPage("document.querySelector('#pdfViewerPages .pdf-region-flash')?.closest('[data-page-number]') ?? document.querySelector('#pdfViewerPages [data-page-number=\"' + document.getElementById('pdfViewerPageInput').value + '\"]')"), { timeoutMs: 60_000 });
      await stage.show("modal", PDF_VIEWPORT);
    }
  },
  "theme-refs": {
    summary: "Screenshot the current screen in every theme, for rebuilding the colour maps (themes/refs/). Use it last, in a screenplay that ends on a screen with the PDF open.",
    args: { value: { type: "text", required: true, doc: "the refs folder, relative to the screenplay" } },
    async run(stage, { value }) {
      const out = path.resolve(stage.dir, value);
      const themes = (await stage.app.evaluate("window.omakase.listThemes()")).map((theme) => theme.name);
      const original = await stage.app.evaluate("document.documentElement.dataset.theme ?? null");
      await stage.app.evaluate("document.activeElement?.blur?.(), true");
      const regions = {
        screen: null,
        note: await stage.box("#cm6EditorHost"),
        card: await stage.box(".cm-invocation-card:last-of-type")
      };
      const pdf = await stage.box(PDF_VIEWPORT);
      for (const theme of themes) {
        const set = await stage.app.evaluate(`window.omakase.setTheme({ name: ${q(theme)} }).then((r) => r.ok)`);
        if (!set) throw new Error(`theme-refs: the app would not switch to ${theme}`);
        // Repainting a theme takes the app a moment, at any pace.
        await settle(1300);
        for (const [kind, box] of Object.entries(regions)) {
          if (kind !== "screen" && !box) continue;
          const clip = box ? { x: box.x * stage.width, y: box.y * stage.height, width: box.w * stage.width, height: box.h * stage.height, scale: 1 } : { x: 0, y: 0, width: stage.width, height: stage.height, scale: 1 };
          const { data } = await stage.app.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
          await mkdir(path.join(out, kind), { recursive: true });
          await writeFile(path.join(out, kind, `${theme}.png`), Buffer.from(data, "base64"));
        }
      }
      await writeFile(path.join(out, "meta.json"), JSON.stringify({ pdfFrom: pdf ? pdf.x : 1, themes, note: "pdfFrom: where the PDF pane starts, as a fraction of the screen screenshots' width" }, null, 1) + "\n");
      if (original) await stage.app.evaluate(`window.omakase.setTheme({ name: ${q(original)} }).then(() => true)`);
      console.log(`  references for ${themes.length} themes -> ${out}. Run "node bin/demo.mjs luts" next.`);
    }
  }
};
