"""Step ②: build facts.json from raw/slides.json + facts.src.yaml.

- every source unit becomes a `unit` fact (kind=statement, raw = full text)
- authored date/value facts are located inside their unit (span + preceding context)
- parsed values are derived from `raw` by the deterministic parser (factlib.parse_value)

Usage: python pipeline/build_facts.py cases/case1
"""
import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from factlib import canonical, load_raw, locate, parse_value, unit_index  # noqa: E402

CTX_LEN = 12


def excluded_reason(uid, rules):
    for r in rules:
        pattern = r["match"].replace(".", r"\.")
        if re.match(pattern, uid):
            return r["reason"]
    return None


def place(fact, units, errors):
    """Resolve `in` + `raw` (+ occ) into loc/span/ctx."""
    uid = fact.pop("in")
    if uid not in units:
        errors.append(f"{fact['id']}: unknown unit {uid}")
        return
    loc, text = units[uid]
    span = locate(text, fact["raw"], fact.pop("occ", 0))
    if span is None:
        errors.append(f"{fact['id']}: raw {fact['raw']!r} not found in {uid} {text!r}")
        return
    fact["origin"] = "pptx"
    fact["loc"] = dict(loc, unit=uid, span=span)
    fact["ctx"] = text[max(0, span[0] - CTX_LEN):span[0]]


def with_review(fact):
    r = fact.get("review")
    if r is not None:
        fact["review"] = {"status": "unreviewed", "proposed": r.get("proposed"), "issue": r.get("issue"),
                          "basis": r.get("basis"), "by": None, "at": None}
    return fact


def main(case_dir):
    case_dir = Path(case_dir)
    raw = load_raw(case_dir)
    units = unit_index(raw)
    src = yaml.safe_load((case_dir / "facts.src.yaml").read_text(encoding="utf-8"))
    errors, facts = [], []

    for uid, (loc, text) in units.items():
        f = {"id": uid, "type": "unit", "kind": "statement", "origin": "pptx",
             "loc": dict(loc, unit=uid, span=[0, len(text)]), "raw": text}
        reason = excluded_reason(uid, src.get("excluded_units", []))
        if reason:
            f["excluded"] = reason
        facts.append(f)

    for d in src.get("dates", []):
        f = with_review(dict(d, type="date", kind="date"))
        if "in" in f:
            place(f, units, errors)
            f["basis"] = "stated"
        else:
            f["origin"] = "image" if f.get("basis") == "from_image" else "inferred"
            f.setdefault("raw", None)  # no source text: value comes from an image or an inference
            if not f.get("note"):
                errors.append(f"{f['id']}: {f['origin']} date needs a note")
            if "img" in f:
                f["loc"] = {"slide": f["img"]["slide"], "shape": f["img"]["shape"], "image": f["img"]["file"]}
                del f["img"]
            if "review" not in f:
                f["review"] = {"status": "unreviewed", "proposed": None, "basis": f["note"], "by": None, "at": None,
                               "issue": "日期取自图片，需要人工核对" if f["origin"] == "image" else "推断日期，需要人工核对"}
        f["parsed"] = {"kind": "date", "value": str(f.pop("value"))}
        facts.append(f)

    for v in src.get("facts", []):
        f = with_review(dict(v, type="value"))
        if "in" in f:
            place(f, units, errors)
        elif "img" in f:
            f["origin"] = "image"
            f["loc"] = {"slide": f["img"]["slide"], "shape": f["img"]["shape"], "image": f["img"]["file"]}
            del f["img"]
        else:
            f["origin"] = "inferred"
        try:
            f["parsed"] = parse_value(f["raw"], f["kind"])
        except ValueError as e:
            errors.append(f"{f['id']}: {e}")
            continue
        if f["origin"] != "pptx" and "review" not in f:
            # machine cannot re-read image transcriptions or inferences: always needs a human
            f["review"] = {"status": "unreviewed", "proposed": None, "basis": None, "by": None, "at": None,
                           "issue": "图片读数，需要人工核对" if f["origin"] == "image" else "推断值，需要人工核对"}
        if isinstance(f.get("date"), dict):
            f["date"] = {"value": str(f["date"]["value"]), "basis": f["date"]["basis"], "note": f["date"].get("note")}
        canon = canonical(f)
        if canon:
            f["parsed"]["canonical"] = canon
        facts.append(f)

    by_id = {f["id"]: f for f in facts}
    for fid, d in (src.get("decisions") or {}).items():
        if fid not in by_id or "review" not in by_id[fid]:
            errors.append(f"decision for {fid}: no such fact with a review item")
            continue
        by_id[fid]["review"].update(status=d["status"], by=d["by"], at=str(d["at"]), decision_note=d.get("note"))

    ids = [f["id"] for f in facts]
    dupes = {i for i in ids if ids.count(i) > 1}
    errors += [f"duplicate id {d}" for d in sorted(dupes)]

    if errors:
        print("BUILD FAILED")
        for e in errors:
            print("  " + e)
        return 1
    out = {"schema": "facts/0.2", "source": raw["source"], "facts": facts}
    (case_dir / "facts.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    n = {t: sum(1 for f in facts if f["type"] == t) for t in ("unit", "date", "value")}
    print(f"facts.json: {n['unit']} units, {n['date']} dates, {n['value']} values")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "cases/case1"))
