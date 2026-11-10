// Reusable interactions adapted from the demo kit. No recording/editor code.
import path from "node:path";
import { access } from "node:fs/promises";

const q = JSON.stringify;
const visible = (selector) => `(() => { const e = document.querySelector(${q(selector)}); return !!e && !e.hidden && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0; })()`;
const text = { type: "text", required: true };
const lastCard = `[...document.querySelectorAll('.cm-invocation-card')].at(-1)`;
const doc = (stage) => stage.app.view("view.state.doc.toString()");
async function editor(stage) { await stage.app.view("(view.focus(), true)"); }
async function prefix(stage, ...keys) {
  await editor(stage);
  await stage.app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, text: "w" });
  try { for (const key of keys) await stage.stroke(key); }
  finally { await stage.app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 }); }
}
async function withFile(stage, file, run) {
  const target = path.resolve(stage.dir, file);
  await access(target);
  await stage.app.evaluateMain(`(() => { const { dialog } = ${stage.electron}; globalThis.__demoOpenDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${q(target)}] }); return true; })()`);
  try { return await run(); }
  finally { await stage.app.evaluateMain(`(() => { const { dialog } = ${stage.electron}; dialog.showOpenDialog = globalThis.__demoOpenDialog; delete globalThis.__demoOpenDialog; return true; })()`); }
}

export const kitActions = {
  focus: {
    summary: "Caption a moment and frame a visible element, or pull back with wide. Caption persists until the next focus; use an empty caption to clear it.",
    args: { value: text, on: { type: "text", default: "wide", doc: "CSS selector or wide" }, position: { type: "enum", values: ["top", "bottom"], default: "bottom" }, zoom: { type: "number", default: 2.1 }, mark: { type: "enum", values: ["none", "ring", "spotlight"], default: "none", doc: "draw a ring around the element, or dim everything else" } },
    async run(stage, { value: caption, on, position, zoom, mark }) {
      if (mark !== "none" && on === "wide") throw new Error("focus.mark needs an element in \"on\"");
      if (zoom < 1 || zoom > 4) throw new Error("focus.zoom must be between 1 and 4");
      if (on !== "wide") await stage.until(`camera target ${on} is visible`, visible(on));
      stage.beat("focus", { caption, position, zoom, mark, box: on === "wide" ? null : await stage.box(on) });
    }
  },
  click: {
    summary: "Click a visible CSS target. Optionally wait for an element or note text proving the result.",
    args: { value: text, shows: { type: "text" }, reads: { type: "text" } },
    async run(stage, { value, shows, reads }) {
      await stage.until(`click target ${value}`, visible(value));
      await stage.show("modal", value);
      await stage.click(value);
      if (shows) await stage.until(`click shows ${shows}`, visible(shows));
      if (reads) await stage.app.until(`note contains ${reads}`, async () => (await doc(stage)).includes(reads));
    }
  },
  caret: {
    summary: "Place the caret at start, end, or the first occurrence of text in the note.",
    args: { value: text },
    async run(stage, { value }) {
      const content = await doc(stage);
      const offset = value === "end" ? content.length : value === "start" ? 0 : content.indexOf(value);
      if (offset < 0) throw new Error(`caret: note has no ${q(value)}`);
      await stage.app.view(`(view.dispatch({ selection: { anchor: ${offset} }, scrollIntoView: true }), view.focus(), true)`);
    }
  },
  rename: {
    summary: "Rename the current note.", args: { value: text },
    async run(stage, { value }) {
      await stage.click("#noteNameBtn");
      await stage.until("rename input", visible("#noteNameInput"));
      await stage.app.evaluate("document.getElementById('noteNameInput').select(), true");
      await stage.type(value, { where: () => stage.box("#noteNameInput") });
      await stage.stroke("Enter");
      await stage.until("note renamed", `document.getElementById('noteNameBtn').textContent.trim() === ${q(value)}`);
      await editor(stage);
    }
  },
  "project-tag": {
    summary: "Set the current note's project tag.", args: { value: text },
    async run(stage, { value }) {
      value = value.replace(/^#/, "");
      await stage.click("#hudNoteTag");
      await stage.until("tag input", visible("#hudNoteTagInput"));
      await stage.app.evaluate("document.getElementById('hudNoteTagInput').select(), true");
      await stage.type(value, { where: () => stage.box("#hudNoteTagInput") });
      await stage.stroke("Enter");
      await stage.until("project tagged", `document.getElementById('hudNoteTag').textContent.trim() === ${q(`#${value}`)}`);
      await editor(stage);
    }
  },
  "inline-sushi": {
    summary: "Ask inline Sushi, wait for a completion, and accept it. Needs scripted replies or sushi: live.",
    args: { value: text, reads: { type: "text" } },
    async run(stage, { value, reads }) {
      const before = await doc(stage);
      await prefix(stage, "0", "0");
      await stage.until("inline Sushi", visible("#sushiInlinePill"));
      await stage.app.evaluate("document.getElementById('sushiInlinePillInput').focus(), true");
      await stage.show("modal", "#sushiInlinePill");
      await stage.type(value, { where: () => stage.box("#sushiInlinePill") });
      await stage.stroke("Enter");
      stage.beat("wait-start");
      await stage.until("inline completion ready", "document.body.innerText.includes('Enter to accept')", { timeoutMs: 120_000 });
      stage.beat("wait-end");
      await stage.pause(1800);
      await stage.stroke("Enter");
      await stage.app.until("inline completion accepted", async () => { const after = await doc(stage); return after !== before && (!reads || after.includes(reads)); });
    }
  },
  "ask-sushi": {
    summary: "Ask Sushi at the caret and wait for the answer card. Needs scripted replies or sushi: live.",
    args: { value: text, answer: { type: "text", doc: "text the answer must contain; leave it out for a live model" }, cites: { type: "enum", values: ["any", "pdf"], default: "any", doc: "pdf: the answer must cite the open PDF" } },
    async run(stage, { value, answer, cites }) {
      const before = await stage.app.evaluate("document.querySelectorAll('.cm-invocation-card').length");
      await prefix(stage, "d", "d");
      const input = ".selected-sushi-composer-input";
      await stage.until("Sushi composer", `document.activeElement?.classList.contains('selected-sushi-composer-input')`);
      await stage.show("modal", input);
      await stage.type(value, { where: () => stage.box(input) });
      await stage.stroke("Enter");
      // The film shortens what follows: the wait for a model is not worth watching.
      stage.beat("wait-start");
      await stage.until("Sushi answer finished", `document.querySelectorAll('.cm-invocation-card').length > ${before} && ['done', 'error', 'failed', 'cancelled'].includes(${lastCard}?.dataset.phase)`, { timeoutMs: 180_000 });
      stage.beat("wait-end");
      const phase = await stage.app.evaluate(`${lastCard}.dataset.phase`);
      if (phase !== "done") throw new Error(`Sushi's answer ended as "${phase}": ${await stage.app.evaluate(`${lastCard}.innerText.slice(0, 300)`)}`);
      if (cites === "pdf") await stage.until("the answer cites the PDF", `!!${lastCard}?.querySelector('.cm-sushi-pdf-citation-chip')`);
      if (answer) await stage.until("Sushi answer content", `${lastCard}?.textContent.includes(${q(answer)})`);
      await stage.app.evaluate(`${lastCard}.scrollIntoView({ block: 'center' }), true`);
      await stage.show("modal", ".cm-invocation-card:last-of-type");
    }
  },
  "card-action": {
    summary: "Merge, copy, or dismiss the last invocation card; optionally assert merged note text.",
    args: { value: text, reads: { type: "text" } },
    async run(stage, { value, reads }) {
      await stage.app.evaluate(`(() => { document.querySelectorAll('[data-demo-target]').forEach(e => delete e.dataset.demoTarget); const e = ${lastCard}?.querySelector('[data-invocation-action=' + ${q(value)} + ']'); if (!e) throw new Error('card action not found'); e.dataset.demoTarget = 'action'; e.scrollIntoView({ block: 'center' }); return true; })()`);
      await stage.click('[data-demo-target="action"]');
      if (reads) await stage.app.until("card edit merged", async () => (await doc(stage)).includes(reads));
    }
  },
  "csv-chart": {
    summary: "Insert a chart from a CSV file relative to the screenplay folder.", args: { value: text },
    async run(stage, { value }) {
      const before = await doc(stage);
      await withFile(stage, value, async () => {
        await stage.action("launcher", { value: "Insert Chart", wpm: 48 });
        await stage.until("chart picker", visible("#chartInsertCsvBtn"));
        await stage.show("modal", "#chartInsertOverlay");
        await stage.click("#chartInsertCsvBtn");
        await stage.app.until("CSV chart inserted", async () => (await doc(stage)).split("```chart").length > before.split("```chart").length);
      });
    }
  },
  "open-pdf": {
    summary: "Open a PDF relative to the screenplay folder, and wait for its text layer.", args: { value: text, reads: { type: "text" } },
    async run(stage, { value, reads }) {
      await withFile(stage, value, async () => {
        await stage.action("launcher", { value: "Open PDF File…", wpm: 48 });
        await stage.until("PDF text ready", `[...document.querySelectorAll('#pdfViewerPages .pdf-viewer-text-layer span')].some(e => e.textContent.includes(${q(reads ?? "")}))`, { timeoutMs: 30_000 });
      });
      await stage.show("modal", "#pdfViewerViewport");
      stage.beat("pane", { kind: "pdf", box: await stage.box("#pdfViewerViewport") });
    }
  },
  "pdf-passage": {
    summary: "Select a PDF passage between two text spans and send it to Sushi.", args: { value: text, through: text },
    async run(stage, { value, through }) {
      await stage.app.evaluate(`(() => { const all = [...document.querySelectorAll('#pdfViewerPages .pdf-viewer-text-layer span')]; const a = all.find(e => e.textContent.includes(${q(value)})); const b = all.find(e => e.textContent.includes(${q(through)})); if (!a?.firstChild || !b?.firstChild) throw new Error('PDF passage not found'); const r = document.createRange(); r.setStart(a.firstChild, 0); r.setEnd(b.firstChild, b.firstChild.textContent.length); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('#pdfViewerViewport').focus(); return true; })()`);
      const button = '.pdf-selection-toolbar button[data-command="pdf.sendSelectionToSushi"]';
      await stage.until("PDF selection toolbar", visible(button));
      await stage.show("modal", button);
      await stage.pause(1200);
      await stage.click(button);
    }
  },
  browser: {
    summary: "Open a URL beside the note, or close the browser with closed. Waits for the actual page load.", args: { value: text },
    async run(stage, { value }) {
      const open = "!!document.querySelector('.browser-split-open')";
      const want = value !== "closed";
      if (!!(await stage.app.evaluate(open)) !== want) { await editor(stage); await stage.chord("Ctrl+Shift+B"); }
      await stage.until("browser visibility", `(${open}) === ${want}`);
      if (!want) return;
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("browser expects an HTTP(S) URL");
      await stage.click("#browserAddressInput");
      await stage.until("browser address focused", "document.activeElement === document.getElementById('browserAddressInput')");
      await stage.chord("Ctrl+A", { watch: null });
      await stage.type(url.href, { where: () => stage.box("#browserAddressInput") });
      await stage.until("browser address entered", `document.getElementById('browserAddressInput').value === ${q(url.href)}`);
      await stage.stroke("Enter");
      const pages = `(() => { const { webContents } = ${stage.electron}; return webContents.getAllWebContents().map(w => ({ url: w.getURL(), loading: w.isLoading() })); })()`;
      try { await stage.app.until("browser page loaded", async () => (await stage.app.evaluateMain(pages)).some((page) => page.url.startsWith(url.origin) && !page.loading), { timeoutMs: 30_000 }); }
      catch (error) { throw new Error(`${error.message}; pages: ${JSON.stringify(await stage.app.evaluateMain(pages))}`); }
      await stage.show("modal", "#browserAddressInput");
    }
  },
  dictation: {
    summary: "Demonstrate dictation using the voice fixture (no microphone). Stop, review, then insert the transcript.",
    args: { value: { type: "enum", values: ["fixture"], required: true }, reads: { type: "text" } },
    async run(stage, { reads }) {
      const phase = "document.getElementById('voiceDictationHud')?.dataset.phase";
      const before = await doc(stage);
      await editor(stage); await stage.chord("Ctrl+Shift+D");
      await stage.until("voice recording", `${phase} === 'recording'`, { timeoutMs: 20_000 });
      await stage.show("modal", "#voiceDictationHud");
      await stage.pause(2500); await stage.stroke("Enter");
      await stage.until("voice review", `${phase} === 'review'`, { timeoutMs: 45_000 });
      await stage.pause(2000); await stage.stroke("Enter");
      await stage.app.until("voice inserted", async () => { const after = await doc(stage); return after !== before && (!reads || after.includes(reads)); });
    }
  }
};
