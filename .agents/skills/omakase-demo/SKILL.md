---
name: omakase-demo
description: Use when asked to make an Omakase demo from a feature or rough idea, record a product walkthrough, or revise an existing demo video or preview.
---

# Omakase demo

The conversation is the authoring interface. You own the runnable script; the user owns the story and creative decisions. Work in this repository. Read its README for the commands and screenplay/edit formats.

## From idea to story

Start with the feature, rough idea, or existing demo the user gives you. Read `node bin/demo.mjs context` and inspect the relevant app behavior, existing screenplays, and demo notes. Show a short proposed script in ordinary language: what happens on screen, the result worth seeing, and any caption. Discuss and refine it with the user. Do not ask them to write YAML or a narration file.

Infer reasonable pacing and style from the request. Ask only about choices that change the story. For a short feature demo, a useful shape is a concrete opening → action → visible result. Do not force a duration, scene count, marketing tone, or music onto every demo. Show an actual workflow; use the app's own visual language. Let a short label settle for about a second, and a sentence for about 0.3 seconds per word.

Use `node bin/demo.mjs init <name> "<idea>"` for a new demo. Keep the agreed script and creative direction in `screenplays/<name>/story.md`, editing it yourself as the conversation evolves. Names use lowercase letters, digits and dashes. Reuse an existing demo when revising it; choose a new name for a distinct concept.

## From story to recording

After the script is agreed, write `screenplay.yaml` behind the scenes. Do not mark it `# Drafted from`; that marker belongs to the optional Claude drafting command. The user's conversation is sufficient input. The current agent can write YAML directly without starting a separate model CLI.

- Run `node bin/demo.mjs doctor` once to check the environment.
- Use the actual action vocabulary (`actions` for readable help, `context` for JSON). New interactions can use a small `custom: steps.mjs#name` adapter beside the screenplay. Promote useful repeated interactions into actions.
- Put fictional demo notes/CSV/PDF fixtures beside the screenplay. Vault paths are relative to Omakase; `../../omakase-demo-factory/screenplays/<name>/vault` points back here. File actions resolve paths relative to the screenplay folder.
- Use scripted Sushi replies for repeatable demos (`sushi: replies.mjs`; see existing loading demos). `sushi: live` explicitly uses the profile in `OMAKASE_PROFILE`; state that model output varies. Never silently substitute a scripted response for a requested live model.
- `dictation: fixture` demonstrates the real dictation UI with a fixture transcript. This is not microphone recording. Live microphone capture is not built into this Linux pipeline.
- `focus` supplies a caption and optional CSS camera target; `mark: ring` or `mark: spotlight` highlights the target. Use `focus: ""` to clear a caption.
- Clicks in custom steps go through `stage.click(selector)` so the film draws the pointer. Set `sfx: true` for key and click sounds. If the story needs close-ups past about 1.3x zoom, set `capture: { scale: 3 }`; `cut` warns when the take is not sharp enough. Automatic camera movement still follows later actions; use an edit camera override to hold a framing over a span.
- Each action must wait for its outcome. Pauses are rhythm, not synchronization. A check failure means fix the action, selector, or fixture and retry the focused demo. Do not hide failed assertions.
- Never edit or rebuild the sibling Omakase checkout from this repository. If the build is stale, explain the prerequisite. Work on the already-built app here.

Run `node bin/demo.mjs produce <name>` as a long-running process. It checks the script at full speed, records a paced take, cuts it, and prints a local editable preview URL. Retain the process/session so the link stays alive. Open the URL with the available browser tools, watch representative moments, and give the user the actual link. This stage needs no MP4 render. A local link works on this machine; do not describe it as a public hosted link.

## Revision loop

The preview lets the user play/scrub, choose scenes or steps, trim, remove a moment, change speed, add top/bottom captions, change camera centre/zoom, remove saved edits, undo a save, and export an MP4.

Manual controls and the agent share `screenplays/<name>/edit.yaml`. Read its latest contents before editing. Preserve the user's manual edits unless their request changes them. Edits name stable spans (`scene/step` or ranges), so a retake can reuse them. If a script change removes a span referenced by an edit, resolve that reference before recording/cutting.

- Caption, framing, speed, trim, cut, title/end card, highlight, key callout, or transition request: edit `edit.yaml`, run `node bin/demo.mjs cut <name>`, and ask the user to reload the existing preview. No new recording or render needed.
- Performance/content request confined to one scene: update the story and script, check, then `node bin/demo.mjs retake <name> <scene>`. Joins get a short automatic dip. If the change alters the app state later scenes start from, record a whole take instead.
- Other performance/content requests: update the story and script, check, and record again. Takes are kept under `out/<name>/takes/`; `takes <name> <id>` or the preview's Take menu goes back to one. A failed recording leaves the take in use in place.
- To resume an existing take: `node bin/demo.mjs preview <name>`.
- For final delivery: use Export in the preview, or `node bin/demo.mjs render <name> [--preset 720p|square|vertical|webm|gif|poster]`. Render only after the edit is ready, unless asked for an early MP4. Report the file and actual validation boundaries. Do not label a preview as an exported video.

When handing back, lead with the preview or video, explain any meaningful limitation, and keep implementation details out of the creative conversation.
