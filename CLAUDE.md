# Omakase demo factory

Read `README.md` first: it is the manual for screenplays, edits, and the pipeline.

When working on a demo with the user:

- The user writes narration in plain English; `node bin/demo.mjs draft <note>` converts it. When a demo has a `narration.md`, change the narration and draft again instead of editing the drafted YAML.
- Write the screenplay in `screenplays/<name>/screenplay.yaml` from the actions `node bin/demo.mjs actions` lists. Do not invent an action; add it to `actions/omakase.mjs` or use `custom`.
- Prove it with `node bin/demo.mjs check <name>` before recording. A screenplay that needs a pause to pass is wrong: fix the action's wait.
- Change pacing, cuts, and framing in `edit.yaml`, anchored to spans. Re-record only when the performance itself changes.
- Omakase demos show a workflow and never name a feature on screen. See `../omakase-v2/demo-notes/README.md`.
- Never edit files in `../omakase-v2` from here, and never rebuild it. Say so if the app's build looks stale.
