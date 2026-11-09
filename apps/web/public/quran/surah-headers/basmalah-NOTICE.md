# Basmalah SVG — provenance notice

`basmalah.svg` is the dedicated Basmalah asset for the hifz study
page's surah-header Basmalah line (Wave 1, 2026-11-09).

## Source — original composition, no Tarteel asset

The SVG is composed from the outlines of the 4 Basmalah word glyphs
of page 1 (U+FC41–U+FC44) of OUR OWN bundled QPC V4 Tajweed font
(`public/fonts/qcf-v4-tajweed/p1.woff2`), extracted with fontTools
and composed by `~/workspace/quran-hifz-mushaf-font/scratch/build-basmalah-svg.py`.

- NEVER copied from Tarteel: Tarteel's `bismallah.ttf` is proprietary
  and was never opened, extracted, or used here (clean-room boundary).
- The 4 glyphs are the printed Fatiha Basmalah words with their COLR
  tajweed layers; the composition applies a uniform horizontal
  scaleX of 1.9 so the form matches the stretched surah-header
  Basmalah of the printed mushaf / Tarteel reference shot
  (measured: reference 528x62px, aspect 8.5:1; natural glyph
  composition 4.3:1). Letterforms are otherwise undistorted.
- Fills use the Wave-1 Tarteel-approx palette override (the same
  hexes as `V4_TARTEEL_PALETTE_OVERRIDES` in
  `lib/quran-mushaf-v4.ts`), so the SVG matches the re-paletted glyphs.

## Licence note

The outlines derive from the QPC V4 Tajweed font, whose licence is
UNCLEAR (QUL: "We don't have copyright information for this
resource" — recorded in `public/fonts/qcf-v4-tajweed/README.md`).
This SVG inherits that unclear status; it is not a separately
licensed asset. The Fatiha Basmalah (1:1:1-4, real ayah words) is
NOT rendered from this SVG — it stays glyphs/text as before; only
the surah-header Basmalah line uses it.
