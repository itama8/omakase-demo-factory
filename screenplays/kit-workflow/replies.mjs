// Explicit controlled responses; the actual app still executes the workflow.
export function respond(request) {
  const content = (request.messages ?? []).findLast((message) => message.role === "user")?.content;
  const prompt = typeof content === "string" ? content : JSON.stringify(content);
  if (/finish the sentence/i.test(prompt)) return { text: " by using smaller tiles.", streamMs: 20 };
  return { text: "| Block size | L1 miss % |\n|---|---|\n| 16 | 2.1 |\n| 32 | 3.4 |\n| 64 | 6.8 |", streamMs: 20 };
}
