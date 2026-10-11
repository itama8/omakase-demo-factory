// Draft a screenplay from plain-English narration.
//
// The narration is a note: in the Omakase vault, or any Markdown file. Its
// first line is "# Screenplay: <title>". Claude reads it beside the action
// vocabulary and the demo vault's contents, and writes screenplay.yaml. The
// draft is then validated, and performed at full speed, and any failure goes
// back for a repair. So a draft that is kept is one that already works.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { editSpans } from "./edit.mjs";

const MARK = /^#\s*Screenplay:\s*(.+?)\s*$/i;
/** The first line of a drafted screenplay. Remove it to take the file over by hand. */
export const DRAFTED = "# Drafted from narration.md. Edit the narration and draft again; delete this line to edit by hand.";

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleOf = (text) => text.split("\n").find((line) => line.trim())?.match(MARK)?.[1] ?? null;

async function markdownUnder(dir, skip = (name) => name.startsWith(".") || name === "node_modules") {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (skip(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await markdownUnder(full, skip));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

/** Where narration notes are looked for: OMAKASE_NOTES, or the profiles Omakase uses on this machine. */
export function vaults() {
  if (process.env.OMAKASE_NOTES) return process.env.OMAKASE_NOTES.split(":");
  return [".config/Electron/vault", ".config/omakase/vault"].map((dir) => path.join(os.homedir(), dir)).filter((dir) => existsSync(dir));
}

/** Every narration note in the vaults, as { title, name, file }. */
export async function findNarrations() {
  const notes = [];
  for (const vault of vaults()) {
    for (const file of await markdownUnder(vault)) {
      const title = titleOf(await readFile(file, "utf8"));
      if (title) notes.push({ title, name: slug(title), file });
    }
  }
  return notes;
}

/** Resolve what the user typed: a file path, or the title or name of a narration note. */
export async function resolveNarration(wanted) {
  if (existsSync(wanted)) {
    const title = titleOf(await readFile(wanted, "utf8"));
    if (!title) throw new Error(`${wanted} is not a narration: its first line must be "# Screenplay: <title>"`);
    return { title, name: slug(title), file: path.resolve(wanted) };
  }
  const notes = await findNarrations();
  const match = notes.filter((note) => note.name === slug(wanted) || note.title.toLowerCase() === wanted.toLowerCase());
  if (match.length === 1) return match[0];
  if (match.length > 1) throw new Error(`more than one narration is called "${wanted}":\n${match.map((note) => `  ${note.file}`).join("\n")}`);
  throw new Error(`no narration called "${wanted}". Found: ${notes.map((note) => note.name).join(", ") || "none"}. A narration is a note whose first line is "# Screenplay: <title>".`);
}

// What the demo vault holds, so "the tiramisu recipe" can become a real note
// name and a query that really matches.
async function describeVault(vault) {
  const lines = [];
  for (const file of (await markdownUnder(vault)).sort()) {
    const text = await readFile(file, "utf8");
    const headings = text.split("\n").filter((line) => /^#{1,3} /.test(line)).slice(0, 14).map((line) => line.replace(/^#+ /, "")).join(" | ");
    lines.push(`- note name "${path.basename(file, ".md")}" (${path.relative(vault, file)}), ${text.split("\n").length} lines. Headings: ${headings || "none"}`);
  }
  return lines.join("\n");
}

function describeActions(actions) {
  return Object.entries(actions).map(([name, action]) => {
    const args = Object.entries(action.args).map(([arg, spec]) => {
      const kind = spec.type === "enum" ? spec.values.join(" | ") : spec.type;
      const need = spec.required ? "required" : spec.default !== undefined ? `default ${spec.default}` : "optional";
      return `    ${arg === "value" ? name : arg}: ${kind}, ${need}${spec.doc ? `. ${spec.doc}` : ""}`;
    });
    return `${name}${action.setupOnly ? " (setup only)" : ""}: ${action.summary}\n${args.join("\n")}`;
  }).join("\n");
}

const system = ({ actions, vault, vaultPath, tracks }) => `You turn a plain-English demo narration into a screenplay file for a pipeline that performs it in the real Omakase notes app, records it, and cuts the video.

Reply with one fenced yaml block and nothing before it. After the block, write one line starting "UNSUPPORTED: " for each thing the narration asks for that the actions below cannot do. Never invent an action or an argument to cover such a thing: leave it out and report it.

# Format

title: <the narration's title>
vault: ${vaultPath}
music: <a track path from the list below, only when the narration names music>
setup:            # steps before the camera rolls
  - keystroke-hud: on
  - sidebar: closed
  - pause: 4s
scenes:
  - name: <lowercase-words-with-dashes>
    steps:
      - <action>: <its value>
        <argument>: <value>

Use that setup unless the narration says otherwise. A step is a mapping with exactly one action. Group steps into a few scenes named for what happens in them.

# Actions

${describeActions(actions)}

# The pipeline already does these. Write no step for them.

- It opens on the logo in silence, then cuts to the app as the music starts.
- The camera follows the caret while typing, goes to the keys before a combination, frames a modal while results appear, frames the note after a jump, and pulls back to the whole window at the end.
- It fades out at the end.

# Rules

- Text the narration says to type goes in "type" exactly as written, including Markdown marks and blank lines. Use a YAML block scalar (|) for more than one line.
- "find" needs a query that appears word for word, ignoring case, in the note it must land in, and "lands" is that note's name from the list below. Prefer a query that is distinctive to that note. To move within the current note use "in: note"; then "lands" is the current note's name.
- When the narration says to arrow or step through matches, set "down" to how many.
- Pauses are rhythm only. Put about 1s before the first action, about 1.3s after each jump lands, and about 2.5s at the very end. Follow the narration where it asks for a different pace.
- Keep the narration's order. Do not add moves it does not describe.

# The demo vault

A new, empty note is open when the demo starts. These notes exist:

${vault}

# Music tracks

${tracks || "none"}`;

// Spans that edit.yaml names but the screenplay no longer has.
async function orphanedEdits(editFile, spans) {
  return (await editSpans(editFile)).filter((id) => !spans.includes(id));
}

function ask(systemPrompt, messages) {
  // The conversation so far is replayed as one prompt: the first draft, then each failure.
  const result = spawnSync("claude", ["-p", "--system-prompt", systemPrompt, "--tools", "", "--no-session-persistence"], { input: messages.join("\n\n---\n\n"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") throw new Error("drafting needs the `claude` command (Claude Code) on the PATH");
  if (result.status !== 0) throw new Error(`claude failed: ${(result.stderr || result.stdout).trim().slice(-600)}`);
  const block = result.stdout.match(/```ya?ml\n([\s\S]*?)```/);
  if (!block) throw new Error(`claude did not reply with a yaml block:\n${result.stdout.slice(0, 600)}`);
  const unsupported = [...result.stdout.slice(block.index + block[0].length).matchAll(/^UNSUPPORTED:\s*(.+)$/gm)].map((match) => match[1]);
  return { yaml: block[1], unsupported };
}

/**
 * Draft `screenplays/<name>/screenplay.yaml` from a narration.
 * `validate(file)` throws on a bad screenplay; `perform(name)` throws when it does not work in the app.
 */
export async function draft({ narration, root, omakaseRoot, actions, app, validate, perform, force = false, log = console.log }) {
  const dir = path.join(root, "screenplays", narration.name);
  const file = path.join(dir, "screenplay.yaml");
  if (existsSync(file) && !force && !(await readFile(file, "utf8")).startsWith(DRAFTED)) {
    throw new Error(`${file} was written by hand. Pass --force to replace it with a draft.`);
  }
  const text = await readFile(narration.file, "utf8");
  const vaultPath = app.defaultVault;
  const vaultDir = path.join(omakaseRoot, vaultPath);
  const tracks = (await readdir(path.join(vaultDir, "backing-tracks")).catch(() => [])).filter((name) => /\.(wav|mp3|m4a|flac|opus)$/.test(name)).map((name) => `- ${vaultPath}/backing-tracks/${name}`).join("\n");
  const prompt = system({ actions, vault: await describeVault(vaultDir), vaultPath, tracks });

  await mkdir(dir, { recursive: true });
  // The narration is kept beside its screenplay, so the pair can be read and diffed together.
  await writeFile(path.join(dir, "narration.md"), text);
  // Edits point at scene and step names. A new draft must not rename what
  // the narration did not change, or it would silently orphan them.
  const previous = existsSync(file) ? (await readFile(file, "utf8")).split("\n").filter((line) => !line.startsWith("# ")).join("\n") : null;
  const messages = [`Narration:\n\n${text}${previous ? `\n\n---\n\nThis narration already has a screenplay. Edits to the video refer to its scene names and step ids, so keep every scene name and step id whose part of the narration still says the same thing, and change only what the narration now says differently.\n\n\`\`\`yaml\n${previous}\n\`\`\`` : ""}`];
  let reply;
  for (let attempt = 1; ; attempt++) {
    log(attempt === 1 ? "drafting..." : `repairing (attempt ${attempt})...`);
    reply = ask(prompt, messages);
    await writeFile(file, `${DRAFTED}\n# Source: ${narration.file}\n${reply.yaml}`);
    let problem = null;
    try {
      await validate(file);
      log("the draft is valid; performing it at full speed...");
      await perform(narration.name);
    } catch (error) {
      problem = error.message.split("\n").filter((line) => !/^\s+at /.test(line)).join("\n").slice(0, 1500);
    }
    if (!problem) break;
    log(`  it failed: ${problem.split("\n")[0]}`);
    if (attempt === 3) throw new Error(`the draft still fails after 3 attempts. It is saved at ${file} for you to fix.\n${problem}`);
    messages.push(`Your screenplay was:\n\n\`\`\`yaml\n${reply.yaml}\`\`\``, `It failed with this error. Reply with the whole corrected screenplay.\n\n${problem}`);
  }
  return { file, unsupported: reply.unsupported, orphans: await orphanedEdits(path.join(dir, "edit.yaml"), (await validate(file)).spans) };
}
