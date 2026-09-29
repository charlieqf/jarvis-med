"""Step ③ helper: structural checks + coverage audit of case.json against raw/slides.json.

Coverage audit: every number that appears in the PPT text/tables must appear somewhere
in case.json (after normalizing superscripts/spaces). This is the mechanical guarantee
behind "the website contains all information in the PPT". Numbers that live only inside
images cannot be checked this way; they are listed in review.md for manual verification.

Usage: python pipeline/validate.py cases/case1
Exit code 1 if any check fails.
"""
import json
import re
import sys
from pathlib import Path

SUP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")
NUM = re.compile(r"\d+(?:\.\d+)?")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")  # full dates are compared as one token


def norm(s):
    s = s.translate(SUP)
    s = re.sub(r"\^\{([^}]*)\}", r"\1", s)
    s = s.replace("×10", "*10")
    s = re.sub(r"(\d{4})[./](\d{2})[./](\d{2})", r"\1-\2-\3", s)
    return re.sub(r"\s+", "", s)


def walk_ids(node, out):
    if isinstance(node, dict):
        if isinstance(node.get("id"), str):
            out.append(node["id"])
        for v in node.values():
            walk_ids(v, out)
    elif isinstance(node, list):
        for v in node:
            walk_ids(v, out)


def walk_src(node, out):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "src" and isinstance(v, list):
                out.extend(v)
            else:
                walk_src(v, out)
    elif isinstance(node, list):
        for v in node:
            walk_src(v, out)


def raw_texts(slide):
    for sh in slide["shapes"]:
        for p in sh.get("paragraphs", []):
            yield p["text"]
        for row in sh.get("rows", []):
            yield " | ".join(row)
        for se in sh.get("series", []):
            yield " ".join(str(v) for v in se["values"])


def main(case_dir):
    case_dir = Path(case_dir)
    case = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
    raw = json.loads((case_dir / "raw" / "slides.json").read_text(encoding="utf-8"))
    failed = False

    ids = []
    walk_ids(case, ids)
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    print(f"ids: {len(ids)} total, {len(dupes)} duplicated")
    for d in dupes:
        print("  DUP", d)
    failed |= bool(dupes)

    srcs = []
    walk_src(case, srcs)
    bad_src = sorted({s for s in srcs if not 1 <= s <= len(raw["slides"])})
    print(f"src refs: {len(srcs)}, out of range: {bad_src}")
    failed |= bool(bad_src)

    id_set = set(ids)
    dangling = sorted({a for s in case["slides"] for a in s["anchors"] if a not in id_set})
    print(f"slide anchors dangling: {dangling}")
    failed |= bool(dangling)

    covered_slides = {s["n"] for s in case["slides"] if s["anchors"] or s.get("kind")}
    missing_slides = [s["slide"] for s in raw["slides"] if s["slide"] not in covered_slides]
    print(f"slides without anchors: {missing_slides}")
    failed |= bool(missing_slides)

    blob = norm(json.dumps(case, ensure_ascii=False))
    blob_dates = set(DATE.findall(blob))
    blob_nums = set(NUM.findall(DATE.sub(" ", blob))) | blob_dates
    uncovered = []
    for s in raw["slides"]:
        for t in raw_texts(s):
            t = norm(t)
            for n in DATE.findall(t) + NUM.findall(DATE.sub(" ", t)):
                if n not in blob_nums and n.rstrip("0").rstrip(".") not in blob_nums:
                    uncovered.append((s["slide"], n, t[:60]))
    print(f"numeric coverage: {len(uncovered)} numbers in PPT text not found in case.json")
    for slide, n, t in uncovered:
        print(f"  slide {slide}: {n!r} in {t!r}")
    failed |= bool(uncovered)

    print("FAIL" if failed else "OK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "cases/case1"))
