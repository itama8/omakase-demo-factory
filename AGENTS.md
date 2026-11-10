# Omakase demo factory

For requests to make or edit an Omakase demo, read `.agents/skills/omakase-demo/SKILL.md`. The agent maintains the script from conversation; the user does not need to write a screenplay file.

Read `README.md` for pipeline commands and file formats. Run `node bin/demo.mjs doctor` for prerequisites, `validate` for script validation, and `check <name>` for the real-app check. Use `produce <name>` for check → record → editable preview, and `retake <name> <scene>` to re-record one scene. `preview <name>` resumes an existing take; `studio <name>` is the separate HyperFrames Studio.

Keep app-specific selectors and waits in `actions/`; recording in `src/recorder.mjs`; takes and splicing in `src/takes.mjs`; film planning and overlays in `src/film.mjs` and `src/overlays.mjs`; edit persistence and review HTTP in `src/review.mjs`. Browser edits and agent edits share `edit.yaml`; preserve current manual edits.

Never edit or rebuild `../omakase-v2` from here. Record the built app in a throwaway profile. Keep controlled/scripted model proof distinct from live-provider acceptance. Keep unrelated concurrent work intact.
