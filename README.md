# Omakase demo factory

Screenplay in, demo video out. The factory performs a screenplay in the real Omakase app, records it, places the camera from what happened on screen, applies your edits, and renders with HyperFrames.

```bash
node bin/demo.mjs draft "Navigating with find"   # plain-English narration -> screenplay
node bin/demo.mjs actions                        # what a screenplay can ask the app to do
node bin/demo.mjs check                          # every screenplay at full speed, no recording
node bin/demo.mjs rehearse navigating-with-find  # demo pace, no recording, a screenshot per jump
node bin/demo.mjs make navigating-with-find      # record, cut, render -> out/<name>/<name>.mp4
```

`make` is `record`, then `cut`, then `render`. After changing `edit.yaml` or the template, run only `cut` and `render`: the take is reused. `preview` opens the cut in HyperFrames Studio.

The app comes from `../omakase-v2` (override with `OMAKASE_ROOT`) and must already be built. The factory never rebuilds it, and it holds Omakase's check lock while it performs, so a check elsewhere cannot rebuild the app mid-take. Each run uses a throwaway profile seeded from the screenplay's vault. Linux only: it needs `Xvfb` and `ffmpeg`.

## Starting from narration

Write the demo in plain English, in Omakase or any Markdown file. The first line marks it as a narration:

```md
# Screenplay: Navigating with find

Cut to a blank note. Music starts, Mozart's Marriage of Figaro.

Type, camera on the caret: ...

Search the whole vault for tiramisu. Arrow down once through the matches and jump into the recipe.
```

```bash
node bin/demo.mjs draft                          # narration notes found in your vault
node bin/demo.mjs draft "Navigating with find"   # by title, by name, or by file path
```

`draft` hands the narration to Claude with the action vocabulary and the demo vault's notes, and writes `screenplays/<name>/screenplay.yaml`. It then validates the draft and performs it at full speed, and sends any failure back for a repair, up to three attempts. A draft it keeps is one that already works in the app.

- It needs the `claude` command (Claude Code) on the PATH. The narration and the demo vault's note names and headings are sent to Claude; your own vault is only read to find narrations.
- Anything the narration asks for that no action can do is listed after the draft and left out, not improvised.
- The narration is the source. To change the demo, change the narration and draft again: unchanged parts keep their scene names, so edits keep pointing at them. If `edit.yaml` names a span the new draft no longer has, `draft` says so.
- A screenplay written by hand is not overwritten without `--force`. Delete the first comment line of a drafted screenplay to take it over by hand.
- Vaults searched: `~/.config/Electron/vault` and `~/.config/omakase/vault`, or the folders in `OMAKASE_NOTES`, separated by colons.

## Writing a screenplay

A demo is a folder in `screenplays/` with a `screenplay.yaml`, an optional `edit.yaml`, and `narration.md` when it was drafted. You can also write the YAML directly.

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
| Edit | `src/edit.mjs` | Spans, cuts, speed, and camera overrides |
| Project | `src/project.mjs`, `template/index.html` | The HyperFrames composition: logo, camera, music, close |

`actions/omakase.mjs` is the part that breaks when the app changes. It is written to move into the Omakase repo beside a contract; until then, run the screenplays as a check from there:

```bash
cd ../omakase-v2 && npm run check -- ../omakase-demo-factory/checks/screenplays.mjs
```

## Not built yet

- A drawn mouse cursor. The recording has none, so scenes led by clicks need one added from logged click points.
- Overlays and effects in `edit.yaml`. Today they go into the template or the generated project by hand.
- Export presets other than 1920x1080.
- Recording the PDF and browser panes is untested. Sushi scenes need a stubbed response, because the demo profile has no credentials.
