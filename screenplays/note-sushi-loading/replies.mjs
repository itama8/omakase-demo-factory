// The scripted model for the note demo. It reuses the table demo's vault and
// PDF, so it shares that module's setup and state.
import path from "node:path";
import { state } from "../table-sushi-loading/replies.mjs";
export { setup, attachPdf } from "../table-sushi-loading/replies.mjs";

const called = (request, name) => (request.messages ?? []).some((message) => (message.tool_calls ?? []).some((call) => call.function?.name === name));
const results = (request) => (request.messages ?? []).filter((message) => message.role === "tool").map((message) => String(message.content)).join("\n");

export async function respond(request, { rest }) {
  await rest(1500);
  if (!called(request, "workspace_searchNotes")) return { toolCalls: [{ name: "workspace_searchNotes", arguments: { query: "D7 flow basis" } }] };
  if (!called(request, "workspace_readNote")) return { toolCalls: [{ name: "workspace_readNote", arguments: { notePath: path.join(state.profile, "vault/estimates/D7 flow basis.md") } }] };
  if (!called(request, "pdf_readPage")) return { toolCalls: [{ name: "pdf_readPage", arguments: { assetId: state.assetId, page: 1 } }] };
  const citation = results(request).match(/\[\[cite:[^\]]+\]\]/)?.[0] ?? "";
  return { streamMs: 70, text:
    `D7 is priced on 3×DWF. The D7 note gives 6.73 MLD as average dry weather flow, but the SBR schedule sizes the decanters and blowers at a peak factor of 3.0. ` +
    `CPHEEO sizes biological reactors on average flow and checks only hydraulic elements at peak ${citation}. ` +
    `Treat up to half of the ₹32.7 cr STP line as money at risk until the consultant sends the reactor volume calculation.` };
}
