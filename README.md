# Omakase demo factory

Describe a feature or rough idea to your agent. Work out the story in conversation, then let the agent record the real Omakase app and give you an editable browser preview. Revise it in conversation or with the preview's controls. Export when the cut is ready.

The agent workflow is in [the demo skill](.agents/skills/omakase-demo/SKILL.md), discoverable through `.agents/skills/` (Codex) and `.claude/skills/` (Claude). An agent starting here also reads `AGENTS.md`. For example:

> Make a short demo of turning a table into a chart. Start with a cache study, ask Sushi for a chart, merge it, and show that Undo reverses the entire change.

You do not need to prepare a screenplay file. The agent maintains a plain-language `story.md`, an executable `screenplay.yaml`, and a persistent `edit.yaml` behind the scenes.

```bash
npm install
node bin/demo.mjs doctor
node bin/demo.mjs init cache-chart "Turn a cache study into a chart, then undo the merge"
# The agent discusses the story and writes the executable script.
node bin/demo.mjs produce cache-chart  # check → record → cut → editable preview URL
```

The preview is local to this machine. Keep its process running.

## What a film has

- **The real app, at 60 fps.** Each take records the built app on a private display. Nothing is recreated.
- **An automatic camera** that follows the caret, the keys, and the panels that open.
- **A drawn pointer.** The recording has no cursor, so the film draws one. It glides to each click the performance made, presses, and leaves a ripple.
- **Overlays from `edit.yaml`:** captions, title and end cards, ring and spotlight highlights, key callouts, and dip transitions.
- **Sound:** optional music, loudness-normalised, and optional synthesised key and click sounds (`sfx: true`).
- **Exports** at 1080p, 720p, square, vertical, WebM, GIF, and a poster frame.

## Review and revise

`node bin/demo.mjs preview <name>` resumes an existing take in the browser editor and prints its URL. Use `--port 4317` for a stable port.

- The timeline sits inside the playback window: scenes on the top row, steps below. Click a block to jump, or drag the playhead to scrub.
- For the selected moment you can change the kept start and end, remove it, change its speed, set a caption, or place the camera. Drag the window on the grid to place it; arrow keys move it and Home centres it.
- Changes preview instantly. Save writes them; Discard restores the saved cut; Undo reverts the last save in this browser session.
- **Take** switches to any kept recording. A take whose spans no longer match the saved edits is refused, with the reason.
- **Format** and **Export** render in the background and offer a download when ready.

Save writes `screenplays/<name>/edit.yaml`, the same file the agent edits. Every browser save keeps the previous file under `out/<name>/edit-history/`. Agent changes are picked up automatically when there is no unsaved preview; otherwise Reload resolves the conflict. The preview and the export share one film plan, so the overlays match. Preview playback uses browser decoding, so check the final file for frame-accurate delivery.

For conversational revisions the agent edits `edit.yaml` and runs `cut`. Only performance or content changes need a new recording, and often only of one scene (see Retakes).

`studio <name>` opens the separate HyperFrames Studio for deeper composition work.

## Commands

```bash
node bin/demo.mjs doctor                         # prerequisites, and whether the screenplays were checked against this app build
node bin/demo.mjs actions                        # what a screenplay can ask the app to do
node bin/demo.mjs validate                       # YAML only, no app
node bin/demo.mjs check                          # every screenplay at full speed, no recording
node bin/demo.mjs rehearse <name>                # demo pace, no recording, a screenshot per jump
node bin/demo.mjs produce <name>                 # check, record, cut, editable local preview
node bin/demo.mjs record <name>                  # a whole take
node bin/demo.mjs retake <name> <scene>          # one scene again, spliced into the take in use
node bin/demo.mjs takes <name> [id]              # list kept takes, or switch to one
node bin/demo.mjs spans <name>                   # the take's spans and times, for writing edits
node bin/demo.mjs cut <name>                     # apply edit.yaml -> out/<name>/project/
node bin/demo.mjs render <name> [--preset p]     # -> out/<name>/<name>.mp4, or <name>-<preset>.<ext>
node bin/demo.mjs make <name>                    # record, cut, render
node bin/demo.mjs draft [note]                   # optional: narration file -> screenplay, using Claude Code
node bin/demo.mjs context                        # vocabulary and paths as JSON, for agents
```

The app comes from `../omakase-v2` (override with `OMAKASE_ROOT`) and must already be built. The factory never rebuilds it. It holds Omakase's check lock while it performs, so a check elsewhere cannot rebuild the app mid-take. Each run uses a throwaway profile seeded from the screenplay's vault. Linux only: it needs `Xvfb` and `ffmpeg`. Rendering uses a pinned HyperFrames (`hyperframes@0.9.30`) through `npx`.

After the app is rebuilt, run `check`. A full pass is recorded in `out/checked.json`, and `doctor` reports `STALE` until the screenplays pass against the new build.

### Retakes

`retake <name> <scene>` records one scene and splices it into the take in use. The scenes before it run first at check speed with the camera off, so the app starts the scene in the right state. Later scenes keep their earlier footage and move by however much longer or shorter the scene became. The film puts a 0.3 s dip over each join, because a live app never lands in exactly the same state twice. If the new scene leaves the app in a different state, for example different note content, record a whole take instead.

Every take is kept under `out/<name>/takes/`, and a failed recording leaves the take in use untouched. `takes <name>` lists them; `takes <name> <id>` switches back.

### Export presets

`render <name> --preset <p>`, or the Format menu in the preview:

| Preset | Output |
| --- | --- |
| `1080p` | 1920x1080 MP4, the master (default) |
| `720p` | 1280x720 MP4 |
| `square` | 1080x1080 MP4, the film letterboxed across the middle |
| `vertical` | 1080x1920 MP4, the film letterboxed across the middle |
| `webm` | 1920x1080 VP9 |
| `gif` | 960 wide, 15 fps, silent |
| `poster` | One PNG frame; `--at <seconds>` picks it, otherwise two fifths in |

The master renders once; other presets are made from it with ffmpeg and render it again only when the cut is newer.

## Writing a screenplay

A demo is a folder in `screenplays/` with a `screenplay.yaml`, an optional `edit.yaml`, and usually a `story.md`.

```yaml
title: Navigating with find
vault: demo-notes            # seeded into the profile; relative to the Omakase checkout
music: demo-notes/backing-tracks/Mozart-The Marriage of Figaro.wav
sfx: true                    # synthesised key and click sounds
capture: { fps: 60, scale: 2 }

setup:                       # before the camera rolls
  - keystroke-hud: on
  - sidebar: closed

scenes:
  - name: across-the-vault
    steps:
      - focus: "Find the recipe without leaving the keyboard"
        on: "#noteSearch .note-search-card"
        mark: ring
      - find: tiramisu       # an action and its value
        down: 1              # that action's other arguments
        lands: tiramisu
      - pause: 1.3s
```

- A step names one action. `node bin/demo.mjs actions` lists them with their arguments. An unknown action or argument is rejected before the app starts.
- **Pauses are rhythm, not logic.** Actions wait on the app's state and assert their result, so a screenplay runs unchanged at check speed. If a demo only works because of a pause, the action is missing a wait.
- A step's address is `scene/action`, numbered when a scene repeats an action (`hello/pause-2`), or `scene/<id>` when the step sets `id:`.
- **`capture`**: the window is always 1280x720. `scale: 2` records 2560x1440, which is sharp up to about a 1.33x zoom in a 1080p film; `scale: 3` records 3840x2160 and is sharp to 2x. `cut` warns when the camera zooms past what the take can hold. `fps` is 24, 25, 30, 50 or 60, and the recording warns if the capture fell behind.
- **`focus`** sets a caption and optional camera target. `mark: ring` or `mark: spotlight` also highlights the target until the next focus.
- **The escape hatch:** `- custom: steps.mjs#name` calls `export async function name(stage, step)` from a file beside the screenplay. Use `stage.click(selector)` for clicks the viewer should see, so the pointer is drawn. When the move earns its place, make it an action.
- Fixtures (notes, CSV, PDF) go beside the screenplay. `sushi: replies.mjs` scripts the model; `sushi: live` uses the profile in `OMAKASE_PROFILE`, and its output varies. `dictation: fixture` uses the app's voice fixture, not a microphone.

## Editing

`edit.yaml` lays changes over the take. An edit names a span of the screenplay, never a second, so it means the same thing after the demo is recorded again.

```yaml
edits:
  - card: "Cache study"                               # a title card; holds the film at this point
    subtitle: "From question to chart"
    at: study@start
    for: 2s                                           # default 2.2s, at most 10s
  - speed: 1.8                                        # 0.1 to 10
    over: hello/type@start+2.5s .. hello/type@end
  - cut: across-the-vault/pause                       # drop a span or a range
  - camera: wide                                      # or { on: [0.5, 0.2], zoom: 1.4 }
    over: fin
  - caption: "Find the recipe without leaving the keyboard"
    position: bottom                                  # or top; empty text hides a caption
    over: across-the-vault
  - highlight: [0.3, 0.3, 0.4, 0.2]                   # x, y, width, height as fractions of the window
    style: spotlight                                  # or ring (default)
    over: table/pause
  - keys: "Ctrl+Shift+F"                              # a key callout, for when the app's HUD is off
    over: across-the-vault/find@start .. across-the-vault/find@start+2s
  - transition: dip                                   # a short fade through the canvas colour
    at: chart@start
    for: 0.5s                                         # at most 2s
```

A range is `point .. point`. A point is a span with `@start` or `@end` and an optional offset. A bare span means its start to its end. A card at a scene's `@end` comes after it; put an end card at the last scene's `@end`.

Anything `edit.yaml` cannot say can be done by hand in `out/<name>/project/`, a normal HyperFrames project. `cut` rebuilds that folder, so hand edits there are lost on the next cut.

## Starting from narration (optional)

The `draft` command turns a plain-English Markdown narration into a screenplay using Claude Code, checks it in the app, and repairs failures up to three times.

- Narrations are any Markdown file under `screenplays/` (a loose `screenplays/quick tiramisu lookup.md` becomes the demo `quick-tiramisu-lookup`; a file in a folder belongs to that folder's demo), or vault notes whose first line is `# Screenplay: <title>`.
- `draft` lists every narration and its state; `draft --all` drafts the new and changed ones; `draft "<name>"` drafts one.
- It needs `claude` on the PATH. The narration and the demo vault's note names and headings are sent to Claude.
- The narration is never copied or renamed. The screenplay's second line, `# Drafted from`, records its path and digest. A hand-written screenplay is not overwritten without `--force`; delete that line to take a drafted one over by hand.
- Vaults searched: `~/.config/Electron/vault` and `~/.config/omakase/vault`, or the folders in `OMAKASE_NOTES`, separated by colons.

## How it fits together

| Part | File | Knows about |
| --- | --- | --- |
| Action vocabulary | `actions/omakase.mjs`, `actions/kit.mjs` | Omakase's selectors, shortcuts, and waits. Nothing else does. |
| Screenplay | `src/screenplay.mjs` | Reading, validating, and compiling YAML into a performance |
| Recorder | `src/recorder.mjs` | The private display, capture, paced keys and clicks, the beat log |
| Takes | `src/takes.mjs` | Kept takes, switching, and splicing a retaken scene |
| Director | `src/director.mjs` | Turning beats into camera shots |
| Edit | `src/edit.mjs` | Spans, cuts, speed, cards, and every other edit kind |
| Film plan | `src/film.mjs`, `src/overlays.mjs` | Shared timing, pointer, overlays, and sounds for preview and export |
| Sound | `src/sound.mjs` | Synthesised key and click sounds |
| Project | `src/project.mjs`, `template/` | The HyperFrames composition |
| Export | `src/export.mjs` | Presets made from the master |
| Browser review | `src/review.mjs`, `review/` | Local playback, persistent edits, takes, export jobs |
| Drafting | `src/draft.mjs` | Narrations to screenplays with Claude |

`actions/` is the part that breaks when the app changes. It is written to move into the Omakase repo beside a contract; until then, run the screenplays as a check from there:

```bash
cd ../omakase-v2 && npm run check -- ../omakase-demo-factory/checks/screenplays.mjs
```

## Current limits

- Square and vertical presets letterbox the 16:9 film. A camera-following crop for phones is not built yet.
- Voiceover and microphone capture are not built. The macOS recording backend from the original kit is not ported.
- PDF and browser actions depend on the built app's selectors and on page availability. Check the relevant screenplay before filming. Live-provider runs are separate from scripted checks.

## Development

`npm test` covers edit timing, overlays, the pointer, sounds, the screenplay compiler, take splicing and switching, and the review server. CI runs it on every push. `node bin/demo.mjs check <name>` performs a screenplay in the actual built app, and `node checks/kit-surfaces.mjs` checks PDF selection and browser navigation using local fixtures.
