Reference screenshots imported from the user-supplied `omakase-website-video-kit.zip` (November 2026).

`refs/screen`, `refs/note` and `refs/card` pair the same app state in Retro 82 and each target theme. `refs/meta.json` records the PDF split in the full-window screenshots. These references came from the kit; they have not been recaptured against this Linux build.

Run `node bin/demo.mjs luts` to generate app and PDF colour maps in `out/luts/`. The Node builder preserves the observed colour-cell averages and fills unseen cells from six nearest observed cells. Equal-distance neighbour ties may differ from the kit's Python/SciPy builder, so it does not promise byte-identical maps.

`node bin/demo.mjs themes website-tabs` applies these maps to one Retro 82 take and writes the website MP4s and posters. Refresh the paired screenshots together after theme changes; recolouring is an approximation for colours absent from the references.
