// The note demo's script at a slower pace, so the loading scene can be
// cycled several times before the answer arrives.
import { respond as noteRespond } from "../note-sushi-loading/replies.mjs";
export { setup, attachPdf } from "../note-sushi-loading/replies.mjs";

export async function respond(request, helpers) {
  await helpers.rest(1700);
  return noteRespond(request, helpers);
}
