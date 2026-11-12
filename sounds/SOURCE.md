# Key and click sounds: sources and licences

Every file in this folder is cut from recordings that are in the public domain or released under CC0 1.0. No attribution is required; it is given here so the sounds can be traced and re-cut.

| Files | Source | Licence |
|---|---|---|
| `key-01..10.wav`, `space-*.wav`, `enter-*.wav`, `backspace-*.wav` | "Typing - Hunt and Peck" by teto_yasha (2007), via PDSounds; Wikimedia Commons: <https://commons.wikimedia.org/wiki/File:Typing_hunt_and_peck.ogg> | Public domain |
| `click-press-*.wav`, `click-release-*.wav` | "Computer mouse single click" and "Computer mouse double click" by Darklanlan (an NEC ECM-S5002 mouse with a Shinmei micro-switch); <https://commons.wikimedia.org/wiki/File:Computer_mouse_single_click.ogg>, <https://commons.wikimedia.org/wiki/File:Computer_mouse_double_click.ogg> | CC0 1.0 |

## How they were cut

`tools/extract.mjs` finds each stroke's onset in the source (48 kHz mono), keeps only strokes with quiet on both sides, and cuts about 110 ms from 1.5 ms before the onset, with a 60 Hz high-pass, a 1 ms fade-in and a 20 ms fade-out. Each file is peak-normalised to -3 dBFS; `src/sound.mjs` sets the levels in the film.

- **Keys:** ten strokes of middling brightness, chosen across the range so they vary like different keys.
- **Space and Enter:** the recording does not label its keys, so these are the darkest strokes with the longest body (the way a stabilised bar sounds), played 14% (space) and 8% (Enter) lower.
- **Backspace:** a darker stroke played 4% lower.
- **Mouse:** each click's press and its release (90–120 ms later) are separate files, three of each.

`tools/manifest.json` records where in the source each file was cut. To re-cut, convert the sources to raw 48 kHz mono float (`ffmpeg -i X.ogg -ac 1 -ar 48000 -f f32le X.f32`) and run `node sounds/tools/extract.mjs <dir with the .f32 files> <out dir>`.
