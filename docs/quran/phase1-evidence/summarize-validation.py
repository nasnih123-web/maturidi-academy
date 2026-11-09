#!/usr/bin/env python3
"""Compact summary of validation-report.json -> phase1-evidence/validation-summary.txt"""
import json
from pathlib import Path

EVIDENCE = Path.home() / "workspace" / "quran-hifz-redesign" / "docs" / "quran" / "phase1-evidence"
r = json.loads((EVIDENCE / "validation-report.json").read_text(encoding="utf-8"))
lines = []
for name, e in sorted(r["files"].items()):
    lines.append(f"### {name} | zip {e['size']} B | md5_match={e.get('md5_match')} | zip_bad={e.get('zip_test_bad')} | members={len(e.get('members', []))}")
    for m in e.get("members", [])[:8]:
        lines.append(f"    member: {m['name']} ({m['size']} B)")
    if len(e.get("members", [])) > 8:
        lines.append(f"    ... +{len(e['members']) - 8} more members")
    for k, v in e.get("db", {}).items():
        lines.append(f"  DB {k}:")
        for t, d in v.get("tables", {}).items():
            lines.append(f"    table {t}: rows={d['rows']} cols={d['columns']}")
        if v.get("error"):
            lines.append(f"    DB ERROR: {v['error']}")
        for t, s in v.get("probes", {}).items():
            lines.append(f"    sample {t}: {s}")
    for k, v in e.get("json", {}).items():
        lines.append(f"  JSON {k}: type={v.get('type')} records={v.get('records')} distinct_ayahs={v.get('distinct_ayahs')} surahs={v.get('surahs')} err={v.get('error')}")
        lines.append(f"    sample: {str(v.get('sample_value'))[:300]}")
    fonts = e.get("fonts", {})
    if fonts:
        glyphs = [v.get("glyphs") for v in fonts.values() if isinstance(v.get("glyphs"), int)]
        fams = sorted({v.get("family") for v in fonts.values() if v.get("family")})
        total = sum(v.get("size", 0) for v in fonts.values())
        lines.append(f"  FONTS: count={len(fonts)} total_bytes={total} glyphs min={min(glyphs) if glyphs else '?'} max={max(glyphs) if glyphs else '?'} sum={sum(glyphs) if glyphs else '?'} families_sample={fams[:3]} families_last={fams[-3:]}")
        errs = {k: v.get("fonttools_error") for k, v in fonts.items() if v.get("fonttools_error")}
        if errs:
            lines.append(f"    fonttools errors: {len(errs)} e.g. {list(errs.items())[:2]}")
    for k, v in e.get("bz2", {}).items():
        if isinstance(v, dict):
            lines.append(f"  BZ2 {k}: decompressed={v.get('decompressed')} size={v.get('size')} sha256={str(v.get('sha256'))[:16]}... err={v.get('error')}")
    if "svg_count" in e:
        lines.append(f"  SVG: count={e['svg_count']} first={e['svg_names_sample']} last={e['svg_names_last']}")
    if e.get("zip_error"):
        lines.append(f"  ZIP ERROR: {e['zip_error']}")
    if e.get("extract_error"):
        lines.append(f"  EXTRACT ERROR: {e['extract_error']}")
lines.append("")
lines.append("### QUL downloads cross-check (~/workspace/qul-downloads)")
for f, v in r.get("qul_crosscheck", {}).items():
    lines.append(f"  {f}: {v['size']} B sha256={v['sha256']}")
(EVIDENCE / "validation-summary.txt").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines[:60]))
print("... total lines:", len(lines))
