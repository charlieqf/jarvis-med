"""Step ④: anchor catalog for the model (DESIGN §5.1) — everything it may point at or cite.

Output: cases/<case>/catalog.txt (compact, line-oriented; embedded in the system prompt).

Usage: python pipeline/build_catalog.py cases/case1
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from factlib import content_version, effective, load_raw, unit_index  # noqa: E402


def main(case_dir):
    case_dir = Path(case_dir)
    facts = {f["id"]: f for f in json.loads((case_dir / "facts.json").read_text(encoding="utf-8"))["facts"]}
    views = json.loads((case_dir / "views.json").read_text(encoding="utf-8"))
    units = unit_index(load_raw(case_dir))
    L = []
    w = L.append

    def date_of(f):
        d = f.get("date")
        if isinstance(d, str):
            return effective(facts[d]).get("date"), facts[d].get("origin")
        if isinstance(d, dict):
            return d["value"], d["basis"]
        return (effective(f).get("date"), f.get("origin")) if f["type"] == "date" else (None, None)

    def flags(f):
        out = []
        if effective(f)["pending"]:
            out.append("PENDING-REVIEW")
        if f.get("origin") == "image":
            out.append("IMAGE-READING")
        d, basis = date_of(f)
        if basis == "inferred":
            out.append("DATE-INFERRED")
        if isinstance(f.get("date"), str) and effective(facts[f["date"]])["pending"]:
            out.append("DATE-PENDING-REVIEW")
        return ",".join(out)

    w(f"# content_version {content_version(case_dir / 'facts.json', case_dir / 'views.json')}")
    w("## SECTIONS")
    for s in views["sections"]:
        w(f"{s['id']} | {s['label']}")

    w("## BLOCKS (camera/spotlight targets)")
    for b in views["blocks"]:
        title = b.get("title")
        title = units[title][1] if isinstance(title, str) and title in units else ""
        w(f"{b['id']} | type={b['type']} | section={b['section']} | {b.get('label') or title}")
        if b["type"] == "table":
            s, sh = b["table"][2:].split(".")
            r = 0
            while f"u.{s}.{sh}.r{r}c0" in units or f"u.{s}.{sh}.r{r}c1" in units:
                cells = [units[f"u.{s}.{sh}.r{r}c{c}"][1].replace("\n", " ") for c in range(4) if f"u.{s}.{sh}.r{r}c{c}" in units]
                w(f"  row {b['id']}.r{r} | " + " || ".join(cells))
                r += 1
        for ph in b.get("phases", []):
            w(f"  phase {ph['id']} | {ph['label']} | {effective(facts[ph['start']]).get('date')} → "
              f"{effective(facts[ph['end']]).get('date') if ph['end'] else 'ongoing'}")
        for ev in b.get("events", []):
            d = facts[ev["date"]]
            w(f"  event {ev['id']} | {effective(d).get('date')} | {ev['label']} | kind={ev['kind']}{' | ' + flags(d) if flags(d) else ''}")
        for s in b.get("series", []):
            w(f"  series {s['id']} | {s['label']} | scale={s['scale']}")
            for pt in s["points"]:
                f = facts[pt["fact"]]
                w(f"    point {f['id']} | {date_of(f)[0]} | raw={f['raw']} | kind={f['kind']}{' | ' + flags(f) if flags(f) else ''}")
            for h in s.get("held", []):
                w(f"    held {h['fact']} | not plotted: {h['reason']}")
        for a in b.get("annotations", []):
            if a["facts"]:
                w(f"  hotspot {a['id']} | facts={','.join(a['facts'])}")
        for p in b.get("pins", []):
            w(f"  pin {p['id']} | region={p['region']} | facts={','.join(p['facts'])}")
        for r in b.get("rows", []) if b["type"] == "compare_matrix" else []:
            w(f"  compare_row {r['id']} | facts={','.join(r['facts'])}")
        for g in b.get("groups", []):
            w(f"  group {g['id']}")

    w("## VALUE AND DATE FACTS (use in {{...}} placeholders)")
    for f in facts.values():
        if f["type"] == "unit":
            continue
        attrs = ",".join(f"{k}={v}" for k, v in (f.get("attrs") or {}).items())
        d, _ = date_of(f)
        extra = f" | review: proposed {f['review']['proposed']}" if effective(f)["pending"] else ""
        w(f"{f['id']} | kind={f['kind']} | raw={f.get('raw')} | date={d} | {attrs}{' | ' + flags(f) if flags(f) else ''}{extra}")

    w("## SOURCE UNITS (quote verbatim with {type: quote, fact: <id>}; also cite them for wording)")
    for f in facts.values():
        if f["type"] == "unit" and not f.get("excluded"):
            w(f"{f['id']} | p{f['loc']['slide']} | {f['raw'].replace(chr(10), ' ')}")

    text = "\n".join(L)
    (case_dir / "catalog.txt").write_text(text, encoding="utf-8")
    print(f"catalog.txt: {len(L)} lines, {len(text)} chars")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cases/case1")
