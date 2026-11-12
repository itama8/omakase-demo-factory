# Editorial review

Run this review before you hand back a first cut and after any substantial revision. It is separate from the technical check: `check` proves the app did what the script says; this review asks whether a first-time viewer would follow it. Read `editorial.md` first; this file is the procedure.

## 1. Look at the actual cut

Judge what the viewer gets, not the screenplay. You need motion as well as frames. Still frames cannot show whether a zoom glides or jerks, or whether a hold is long enough.

```bash
node bin/demo.mjs spans <name>                 # span → time, to map findings back to edit.yaml
node bin/demo.mjs render <name>                 # out/<name>/<name>.mp4, the 1080p master
```

Then, in your scratchpad:

```bash
F=out/<name>/<name>.mp4
# Overview: one frame per second, as a contact sheet.
ffmpeg -v error -i "$F" -vf "fps=1,scale=320:-1,tile=6x10" -frames:v 1 sheet.png   # 6x10 covers 60s
# Around one moment (here 12s): 3 seconds at 4 fps, as a strip, to judge motion and holds.
ffmpeg -v error -ss 10.5 -t 3 -i "$F" -vf "fps=4,scale=360:-1,tile=12x1" -frames:v 1 strip-12s.png
# A full-resolution frame to judge legibility at the intended size.
ffmpeg -v error -ss 12 -i "$F" -frames:v 1 frame-12s.png
```

Look at the contact sheet, then a strip around every cut, zoom change, caption entrance and the payoff, plus a full frame at every place the viewer must read something. If browser preview tools are available, playing the preview at full speed is better still for pacing.

## 2. Ask five questions

1. **Story:** Does the opening make clear what the engineer is trying to do, and does the ending hold on a result the viewer recognises as useful?
2. **Continuity:** Can the viewer see how each action leads to the next state? Does any result appear from nowhere?
3. **Readability:** At 1080p, can the input, the citation, the number and the result be read while they are on screen? Is any caption on screen for less than its reading time, or covering the thing it describes?
4. **Pacing:** Is there dead time left (idle cursor, waiting, repetition)? Is any beat too short to understand? Does the payoff get more time than the setup?
5. **Restraint:** For each zoom, caption and highlight: what would the viewer miss without it? Is anything changing during another change? Do frame changes come less than about 2s apart?

## 3. Write findings, then fix them

Write each finding with a time range, the problem, and a concrete change in terms of `edit.yaml` spans or the screenplay:

> `00:12–00:15` Caption covers the cited clause → move it to `box: [0.05, 0.06, 0.4, 0.08]`; keep the 2.8s hold.
> `00:21–00:23` Zoom moves while the merge card is still rendering → start the zoom at `merge/card-action@end`.
> `00:30–00:38` Sushi wait shows 8s of spinner → cut `ask/ask-sushi@start+1s .. ask/ask-sushi@end-1s`.
> `00:04–00:07` Typing the 14-word prompt at reading speed slows the open → speed 2x over the first half; keep the last words readable.

Rank them: anything that breaks understanding first, then pacing, then polish. Fix them through `edit.yaml` (or a scene retake when the performance is wrong). Render again and re-inspect **only the changed moments and their neighbours**.

Two rounds are usually enough. Keep the final findings list, including the things you chose not to fix and why, in the demo's `story.md` under `## Review`, so the next agent or the user can see what was judged.
