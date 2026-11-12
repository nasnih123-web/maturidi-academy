/**
 * The Basmala line as rendered on mushaf pages.
 *
 * Tarteel-parity step 1a (agent-2 PR, 2026-11-12): the reader used
 * to render the Basmala as plain text in the generic KFGQPC Hafs
 * text font — defect 1 of the parity scope (the QPC V2 layout gives
 * the Basmala line no glyph segments, so no glyph rendering existed
 * for it). The mushaf pages now render it in KFGQPC's dedicated
 * Basmala calligraphy font, QCF_BSML (public/fonts/qcf-bsml/), the
 * same companion-font approach the Quran Foundation ecosystem uses
 * (Quran.com's image generator ships QCF_BSML.TTF as its Basmala
 * font; see the folder README and THIRD_PARTY_NOTICES.md).
 *
 * The string below is derived mechanically from the repo's own
 * Tanzil Uthmani text (ayah 1:1, its first four words — the
 * Basmala) with ONE documented difference: the dagger-alef mark
 * U+0670 is removed, because QCF_BSML's cmap contains no U+0670
 * glyph — shaping the full Tanzil string in this font produces
 * exactly one missing glyph (HarfBuzz-verified), while this
 * spelling shapes with zero missing glyphs. Everything else is
 * byte-identical to Tanzil, including its tatweel (U+0640) in
 * ٱلرَّحْمَـنِ. Do not re-add U+0670 unless the font is replaced.
 */
export const BASMALA_QCF_TEXT = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـنِ ٱلرَّحِيمِ';
