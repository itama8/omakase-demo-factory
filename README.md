# Omakase demo factory

Describe a feature or rough idea to your agent. Work out the story in conversation, then let the agent record the real Omakase app and give you an editable browser preview. Revise it in conversation or use the preview's controls. Export an MP4 when the cut is ready.

The agent workflow is in [the demo skill](.agents/skills/omakase-demo/SKILL.md), discoverable through `.agents/skills/` (Codex) and `.claude/skills/` (Claude). An agent starting here also reads `AGENTS.md`. For example:

> Make a short demo of turning a table into a chart. Start with a cache study, ask Sushi for a chart, merge it, and show that Undo reverses the entire change.

You do not need to prepare a screenplay file. The agent maintains a plain-language `story.md`, an executable `screenplay.yaml`, and persistent `edit.yaml` behind the scenes. Any capable coding agent can do this directly; the optional `draft` command still uses Claude Code for file-based narration.

```bash
cd /home/a2ajinkya/Projects/omakase-demo-factory
npm install
node bin/demo.mjs doctor
node bin/demo.mjs init cache-chart "Turn a cache study into a chart, then undo the merge"
# The agent discusses the story and writes the executable script.
node bin/demo.mjs produce cache-chart  # check → record → cut → editable preview URL
```

The preview is local to this machine. Keep its process running. No full video render is needed to review or revise the cut.

## Review and revise

`node bin/demo.mjs preview <name>` resumes an existing take in the factory's browser editor and prints its URL. Use `--port 4317` for a stable port; otherwise the OS picks a free port. The editor provides:

- Use the timeline inside the playback window: scenes on the top row, steps below. Click a block to jump, drag the playhead to scrub, or use the player's play button. Small markers open menus for brief or instantaneous steps. Both rows follow cuts and speed changes, including unsaved previews. Editing preserves the current recorded frame, and the caption field follows the visible caption until you edit it.
- Change the kept start/end time within that moment, remove it, or change its speed.
- Type a caption or change the zoom to see an instant, unsaved preview. Place the zoom by dragging the window on the grid, or clicking a new location. The window shows the visible crop and stays within the frame; arrow keys move it and Home centres it. No enabling checkboxes.
- Save changes to persist them, Discard to restore the saved cut, or Undo the last save in this browser session.
- Export an MP4 with progress/error output and download it when ready.

Save changes writes to `screenplays/<name>/edit.yaml`, the same file the agent edits. Previewing does not write that file. Existing settings load into the controls; editing them replaces their previous values. Saved edits are in a collapsed section. Every browser save preserves the previous file under `out/<name>/edit-history/`. Agent changes are picked up automatically when there is no unsaved preview; otherwise Reload resolves the conflict. Export uses saved changes; save or discard pending controls first.

For conversational revisions, the agent edits `edit.yaml` and runs `cut`. Reload the preview to see them. Only performance or content changes require a retake. Successful recordings are kept under `out/<name>/takes/`; failures leave the previous take usable. The cut and the export share the same film plan and GSAP composition. Preview playback uses browser media decoding, so final MP4 review remains the check for frame-accurate delivery.

`studio <name>` retains the separate HyperFrames Studio for deeper composition work.

## Pipeline commands

```bash
node bin/demo.mjs draft "Navigating with find"   # plain-English narration -> screenplay
node bin/demo.mjs actions                        # what a screenplay can ask the app to do
node bin/demo.mjs check                          # every screenplay at full speed, no recording
node bin/demo.mjs rehearse navigating-with-find  # demo pace, no recording, a screenshot per jump
node bin/demo.mjs produce navigating-with-find   # check, record, cut, editable local preview
node bin/demo.mjs make navigating-with-find      # record, cut, render -> out/<name>/<name>.mp4
```

`make` is `record`, then `cut`, then `render`. After changing `edit.yaml` or the template, run `cut` and reload the preview; render again only when needed. `validate` checks YAML without opening the app. `context` prints the vocabulary and local paths as JSON for agents.

The app comes from `../omakase-v2` (override with `OMAKASE_ROOT`) and must already be built. The factory never rebuilds it, and it holds Omakase's check lock while it performs, so a check elsewhere cannot rebuild the app mid-take. Each run uses a throwaway profile seeded from the screenplay's vault. Linux only: it needs `Xvfb` and `ffmpeg`.

## Starting from narration

Write the demo in plain English, in a Markdown file with any name you like.

```md
Cut to a blank note. Music starts, Mozart's Marriage of Figaro.

Type, camera on the caret: ...

Search the whole vault for tiramisu. Arrow down once through the matches and jump into the recipe.
```

Narrations are picked up from two places:

- **Anywhere under `screenplays/`.** Every Markdown file there is a narration. A loose file such as `screenplays/quick tiramisu lookup.md` becomes the demo `quick-tiramisu-lookup`. A file inside a folder, such as `screenplays/moats/first idea.md`, belongs to the demo `moats`. Keep one narration per demo folder.
- **Your Omakase vault**, for notes whose first line is `# Screenplay: <title>`. The title names the demo.

A first line of `# Screenplay: <title>` is optional under `screenplays/`; when present, it titles the demo and names a loose file's demo.

```bash
node bin/demo.mjs draft                    # every narration: new, changed, current, or hand-written
node bin/demo.mjs draft --all              # draft the new and changed ones
node bin/demo.mjs draft "first idea"       # one, by demo name, title, file name, or path
```

`draft` hands the narration to Claude with the action vocabulary and the demo vault's notes, and writes `screenplays/<name>/screenplay.yaml`. It then validates the draft and performs it at full speed, and sends any failure back for a repair, up to three attempts. A draft it keeps is one that already works in the app.

- It needs the `claude` command (Claude Code) on the PATH. The narration and the demo vault's note names and headings are sent to Claude; your own vault is only read to find narrations.
- The narration stays where you put it and is never copied or renamed. The screenplay's second line records its path and a digest of its text, which is how `draft` knows a narration has changed. Renaming or moving a narration is fine; the next draft records the new path.
- Anything the narration asks for that no action can do is listed after the draft and left out, not improvised.
- The narration is the source. To change the demo, change the narration and draft again: unchanged parts keep their scene names, so edits keep pointing at them. If `edit.yaml` names a span the new draft no longer has, `draft` says so.
- A screenplay written by hand is not overwritten without `--force`. Delete the first comment line of a drafted screenplay to take it over by hand.
- Vaults searched: `~/.config/Electron/vault` and `~/.config/omakase/vault`, or the folders in `OMAKASE_NOTES`, separated by colons.

## Writing a screenplay

A demo is a folder in `screenplays/` with a `screenplay.yaml`, an optional `edit.yaml`, and usually the narration it was drafted from. You can also write the YAML directly.

```yaml
title: Navigating with find
vault: demo-notes            # seeded into the profile; relative to the Omakase checkout
music: demo-notes/backing-tracks/Mozart-The Marriage of Figaro.wav

setup:                       # before the camera rolls
  - keystroke-hud: on
  - sidebar: closed

scenes:
  - name: across-the-vault
    steps:
      - find: tiramisu       # an action and its value
        down: 1              # that action's other arguments
        lands: tiramisu
      - pause: 1.3s
```

- A step names one action. `node bin/demo.mjs actions` lists them with their arguments. An unknown action or argument is rejected before the app starts.
- **Pauses are rhythm, not logic.** Actions wait on the app's state and assert their result, so a screenplay runs unchanged at check speed. If a demo only works because of a pause, the action is missing a wait.
- A step's address is `scene/action`, numbered when a scene repeats an action (`hello/pause-2`), or `scene/<id>` when the step sets `id:`.
- **The escape hatch:** `- custom: steps.mjs#name` calls `export async function name(stage, step)` from a file beside the screenplay. Use it to try a move; when it earns its place, make it an action.

## Editing

`edit.yaml` lays changes over the take. An edit names a span of the screenplay, never a second, so it means the same thing after the demo is recorded again. `node bin/demo.mjs spans <name>` lists the spans of the last take with their times.

```yaml
edits:
  - speed: 1.8                                        # 0.1 to 10
    over: hello/type@start+2.5s .. hello/type@end
  - cut: across-the-vault/pause                       # drop a span or a range
  - camera: wide                                      # or { on: [0.5, 0.2], zoom: 1.4 }
    over: fin
  - caption: "Find the recipe without leaving the keyboard"
    position: bottom                                  # or top; empty text hides a caption
    over: across-the-vault
```

A range is `point .. point`. A point is a span with `@start` or `@end` and an optional offset. A bare span means its start to its end.

Anything `edit.yaml` cannot say can be done by hand in `out/<name>/project/`, a normal HyperFrames project. That folder is rebuilt by `cut`, so hand edits there are lost on the next cut.

## How it fits together

| Part | File | Knows about |
| --- | --- | --- |
| Action vocabulary | `actions/omakase.mjs` | Omakase's selectors, shortcuts, and waits. Nothing else does. |
| Draft | `src/draft.mjs` | Finding narrations and turning them into screenplays with Claude |
| Screenplay | `src/screenplay.mjs` | Reading, validating, and compiling YAML into a performance |
| Recorder | `src/recorder.mjs` | The private display, capture, paced keys, and the beat log |
| Director | `src/director.mjs` | Turning beats into camera shots |
| Film plan | `src/film.mjs` | Shared cuts, camera timing, and captions for review/export |
| Edit | `src/edit.mjs` | Spans, cuts, speed, and camera overrides |
| Browser review | `src/review.mjs`, `review/` | Local playback, persistent edits, export jobs |
| Project | `src/project.mjs`, `template/index.html` | The HyperFrames composition: logo, camera, music, close |

`actions/omakase.mjs` is the part that breaks when the app changes. It is written to move into the Omakase repo beside a contract; until then, run the screenplays as a check from there:

```bash
cd ../omakase-v2 && npm run check -- ../omakase-demo-factory/checks/screenplays.mjs
```

## Additions from the demo kit

The kit's interactions are reusable actions in `actions/kit.mjs`, using the factory's existing private Linux recorder and HyperFrames export:

- `focus`: caption and optional CSS camera target; `on: wide` pulls back. A caption lasts until the next focus. Later automatic camera beats can move the framing; use a camera edit to hold it over a span.
- `rename`, `project-tag`, `caret`, and `click`: composable app operations; click can assert a visible result or expected note text.
- `inline-sushi`, `ask-sushi`, `card-action`: inline completions and card answers/merge. Use `reads` or `answer` to verify the result.
- `csv-chart`, `open-pdf`, `pdf-passage`, `browser`: fixtures resolve relative to the screenplay folder. Browser navigation waits for the page load.
- `dictation: fixture`: exercise recording/review/insertion with the app's voice fixture. This is a scripted transcript; it does not record a microphone.
- `appearance: { theme: lumon, font: sf-new-york }`: optional top-level profile styling.
- `sushi: live`: opt into the saved provider in `OMAKASE_PROFILE`, copied into the disposable profile. Output and latency may vary. `sushi: replies.mjs` retains the repeatable local model workflow.

The imported interactions use state waits; unlike the original kit, errors are not converted into success notes. `node bin/demo.mjs actions` documents every argument. See `screenplays/kit-workflow/` for an example combining new interactions, a scripted answer, CSV chart, and fixture dictation.

The kit's macOS screen recorder, machine-specific sync offset, and Swift editor are not needed in the Linux pipeline. Microphone capture, automatic audio-window editing, and the Mac recording backend remain unimplemented. The kit's supplied raw take is not copied into this repository.

## Current limits

- A drawn mouse cursor. The recording has none, so scenes led by clicks need one added from logged click points.
- Effects and overlays beyond caption pills in `edit.yaml`. Today they go into the template or the generated project by hand.
- Export presets other than 1920x1080.
- PDF/browser actions depend on the built app's selectors and browser/page availability. Check the relevant screenplay before filming. Live-provider and native microphone acceptance are separate from scripted checks.

## Development checks

`npm test` exercises edit timing, caption/camera behavior, and review persistence/conflict handling. `node bin/demo.mjs check <name>` performs a specific screenplay in the actual built app. `node checks/kit-surfaces.mjs` checks PDF selection and browser navigation using local fixtures. The factory never rebuilds the sibling app.

The agent-first story workflow also draws on the local `brag` reference: concrete opening, real product workflow, readable pacing, and a short creative discussion before implementation. It does not recreate the app UI as animation.
