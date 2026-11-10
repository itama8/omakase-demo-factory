// The scripted model for this demo. Each reply comes after a short think so
// every step stays on screen long enough to read. Tools run for real in the
// app against the seeded vault and the imported PDF.
import { writeFile } from "node:fs/promises";
import path from "node:path";

// Shared with the note demo, which reuses this vault and PDF.
export const state = { profile: null, assetId: null };
const NOTE = "estimates/EQ01 Option 6 sewage.md";

function makePdf(lines) {
  const stream = ["BT /F1 15 Tf 36 740 Td 20 TL", ...lines.map((line) => `(${line}) Tj T*`), "ET"].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  return Buffer.from(`${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

export async function setup(dir) {
  state.profile = dir;
  await writeFile(path.join(dir, "CPHEEO sewerage manual excerpt.pdf"), makePdf([
    "CPHEEO Manual on Sewerage, Part A - Chapter 3 (excerpt)",
    "3.6 Peak factor",
    "Contributory population up to 20,000: peak factor 3.0",
    "20,000 to 50,000: peak factor 2.5",
    "50,000 to 7,50,000: peak factor 2.25",
    "Treatment units: biological reactors are sized on average flow.",
    "Hydraulic elements, screens and decanters are checked at peak flow."
  ]));
}

/** Setup step: attach the manual to the estimate note, as a reviewer would. */
export async function attachPdf(stage) {
  const notePath = path.join(state.profile, "vault", NOTE);
  const imported = await stage.app.evaluate(`window.omakase.importPdfAsset(${JSON.stringify({ sourcePath: path.join(state.profile, "CPHEEO sewerage manual excerpt.pdf"), notePath })})`);
  if (!imported?.ok) throw new Error(`PDF import failed: ${JSON.stringify(imported)}`);
  state.assetId = imported.assetId;
  const text = (await stage.app.editorState()).text + `\n[CPHEEO sewerage manual excerpt.pdf](omakase-asset://${state.assetId})\n`;
  await stage.app.view(`(view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } }), true)`);
  await stage.app.evaluate(`window.omakase.saveNote(${JSON.stringify({ path: notePath, content: text })})`);
}

const called = (request, name) => (request.messages ?? []).some((message) => (message.tool_calls ?? []).some((call) => call.function?.name === name));
const results = (request) => (request.messages ?? []).filter((message) => message.role === "tool").map((message) => String(message.content)).join("\n");

export async function respond(request, { rest }) {
  await rest(1500);
  if (!called(request, "workspace_searchNotes")) return { toolCalls: [{ name: "workspace_searchNotes", arguments: { query: "D7 flow basis" } }] };
  if (!called(request, "workspace_readNote")) return { toolCalls: [{ name: "workspace_readNote", arguments: { notePath: path.join(state.profile, "vault/estimates/D7 flow basis.md") } }] };
  if (!called(request, "pdf_readPage")) return { toolCalls: [{ name: "pdf_readPage", arguments: { assetId: state.assetId, page: 1 } }] };
  if (!called(request, "table_submitResult")) {
    const citation = results(request).match(/\[\[cite:[^\]]+\]\]/)?.[0] ?? "";
    return { toolCalls: [{ name: "table_submitResult", arguments: { text:
      `**Priced on 3×DWF.** The D7 note gives 6.73 MLD as average dry weather flow, and the estimate sizes the SBR decanters and blowers at a peak factor of 3.0. ` +
      `The CPHEEO excerpt sizes biological reactors on average flow and checks only hydraulic elements at peak ${citation}.\n\n` +
      `So the ₹32.7 cr line likely carries up to 2× too much tankage. Keep it as money at risk and ask for the reactor volume calculation.` } }] };
  }
  return { text: "Answered." };
}

