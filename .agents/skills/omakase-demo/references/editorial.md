# Editorial guide

Read this at every stage of the demo workflow: when you plan, when you write the screenplay, when you make the first edit, and when you revise. Each stage has its own section below. Before you hand back a cut, follow `review.md`.

## The standard

**The viewer sees the film once, at full speed, without knowing the app.** You wrote the script, so you always know what is about to happen. They don't. A good demo gives them time to understand the current change before it asks them to follow the next one. Every action, cut, zoom, caption and highlight should help with that, or it should not be there.

We are showing a real tool doing real work. The film should feel calm, confident and legible, like watching a skilled colleague over their shoulder. It should never feel like a trailer. A plain interaction that reads clearly is the best shot available. Effects are there to fix a problem the viewer would otherwise have: something too small, something hard to find, or context they would miss.

Signs that a cut is going wrong:
- two or more things change at once (the camera moves, a panel opens and a caption appears together);
- a result is visible for less time than it takes to read;
- the zoom changes on every beat;
- every beat has a caption;
- every beat runs at the same speed, so setup and payoff get the same weight;
- a highlight points at something the viewer is already looking at;
- a long wait was compressed with no hint of what was happening, so the result seems to appear from nowhere.

## 1. Plan in beats

Before anything else, break the story into **beats**. A beat is one change the viewer must understand. Write each one in `story.md` in plain words:

> **Notice:** the answer cites page 3-21.
> **Do:** click the citation.
> **See:** the PDF jumps to Table 3.9.
> **Edit:** hold wide enough to show the answer and the page; no caption needed.

- One beat, one idea. "Open the PDF, select a clause, ask Sushi, merge" is four beats, even though automation can do all of it in two seconds.
- Each demo should have one payoff, the moment it exists for. Know which beat it is, and give it the most time.
- 30–50 seconds holds about 5–8 beats. If you have more, cut beats rather than speeding them up.
- Show one concrete task from start to finish rather than a tour of features. A sequence of features only becomes a story when each one feeds the next ("the table becomes the question, the answer becomes the note").
- Plan the caption text now. A caption should say what the viewer cannot see: why the step matters, or the domain context. Never narrate the click ("Clicking merge"). Most beats need no caption. A 40-second demo with more than 3–4 captions is probably over-explained.
- The opening must show the starting state long enough to read it: what note this is, what the engineer is trying to do. The ending must hold on the finished artifact.

## 2. Perform with room

Editing can remove time but cannot create it. If the app moves on before the viewer understands, no edit can recover that. **Record generously; cut tight later.**

- **Settle before each beat** (about 0.6–1.0s) so the viewer's eye arrives before the change.
- **Hold after each visible result.** About 1.5s for a small change; 2.5–4s for a payoff that has to be read (an answer, a table, a cited page). Holds are `pause` steps after the action that waits for the outcome. Pauses are rhythm, never synchronisation.
- Record extra hold wherever a caption or highlight might be needed later. A caption needs reading time: about 1s for a short label, plus about 0.3s per word for a sentence.
- Type at a human pace. Long text the viewer does not need to read can be typed in full and sped up in the edit, or pasted. Text they must read should be typed at reading speed.
- Avoid stacking changes: don't open a pane and type at the same moment. Let the pane land, settle, then act.
- Never jump the view: an instant scroll reads as a hard cut. Custom steps should use `stage.reveal(selector)` (an eased glide, only when the target is off screen) and `stage.click`, which already does this; never `scrollIntoView`. Stage a merge so the answer card and its buttons are already on screen when the answer lands, and the merge reads as one continuous move.
- Navigation the viewer must follow (jumping to a page, switching panes) should move from a visibly different place, so the change can be seen (the `cpheeo-ask` citation beat first moves the PDF away for this reason).
- Before you record, write the **film setup** so the first frame is already readable: the right note open, the panes sized, the sidebar the way you want it.

## 3. First edit

Work in this order; each step changes what the next one needs.

1. **Remove dead time.** Cut waiting, repeated typing, idle cursor and navigation the viewer doesn't need. Speed up (1.5–3x) what they need to see happen but not read. Keep the connection between cause and effect: if Sushi takes 8 seconds, cut it to about 1s either side, not to zero.
2. **Check the rhythm.** Setup can move fast; the payoff gets time. Pace should vary with meaning. A flat, even pace is as tiring as constant motion.
3. **Set the framing.** Default to wide enough to see where things are. Zoom in only when a detail must be read (a number, a citation, a table cell) and stay as wide as legibility allows (usually 1.15–1.4x). Hold one framing for the whole beat; move between beats, not during them. Go back wider when the relation between note and PDF matters. Frame changes less than about 2 seconds apart feel like twitching; merge them.
4. **Add captions** only where the plan said the viewer needs context. Put them where they don't cover the action or the result; `box` placement beats a default that hides the answer. Bring a caption in after the camera has settled, not during a move.
5. **Add highlights** only to find something small in a busy screen. Never ring something the camera has already zoomed in on.
6. **Title and end cards:** at most one each. The end card should say the outcome in the viewer's terms ("Every value has a page"), not the feature name.

Budget: about **one effect per beat**: a zoom, a caption or a highlight. Two at once need a reason you could write down. When in doubt, take an effect out and watch again.

## 4. Revising

- Change the smallest thing that fixes the problem. Retake a scene only when the performance itself is wrong (too fast to read, the wrong state, an awkward move); everything else is an `edit.yaml` change.
- Re-watch the changed moment and the beat on either side; a fix often moves the problem to the next cut.
- Keep the user's manual edits. A user edit is a deliberate choice, not a default to optimise.
- Stop when the review finds nothing that would confuse or tire a first-time viewer. Polishing past that point usually adds motion.

## Borrowed, deliberately not borrowed

This method adapts the editorial-review idea in HyperFrames (separate "does it work" from "does it communicate"; write findings with timestamps and a concrete fix). We do **not** borrow cinematic transitions, kinetic text or animated layouts: in a product demo they compete with the real UI. A cut, or a short dip when the scene changes, is enough.
