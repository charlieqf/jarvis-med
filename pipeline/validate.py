"""Step ③: quality gates V1–V6 for facts.json + views.json (see docs/DESIGN.md §4.2).

  V1 structure        ids unique, schema fields, every reference resolves
  V2 omission         every non-excluded PPT unit is shown by some view
  V3 fact re-read     raw is found at loc, context unchanged, re-parse == parsed,
                      label near the value matches analyte/method/gene, dates agree
  V4 view consistency no literal numbers in views, series points compatible,
                      corroborating facts agree, event/fact dates agree, ordering
  V5 review gate      review records well-formed; --release fails on open items
  V6 version          tours bound to the current content_version

Usage: python pipeline/validate.py cases/case1 [--release]
Exit code 1 on any error (and, with --release, on any open review item).
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from factlib import (canonical, check_date, check_labels, compare_parsed, content_version,  # noqa: E402
                     effective, load_raw, parse_value, unit_index)

KINDS = {"exact", "bound", "not_detected", "qualitative", "missing", "statement", "date"}
STATUSES = {"unreviewed", "confirmed", "rejected", "excluded"}
REF_PREFIXES = ("u.", "d.", "f.")
VIEW_PREFIXES = ("b.", "ev.", "ph.", "sec.", "v.")
LABEL_KEYS = {"label", "rules", "reason", "schema"}
COMPAT_KEYS = ("analyte", "method", "specimen", "site", "tracer")


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, gate, msg):
        self.errors.append(f"[{gate}] {msg}")

    def warn(self, gate, msg):
        self.warnings.append(f"[{gate}] {msg}")


# ---------------------------------------------------------------- helpers

def walk(node, path=""):
    """Yield (path, key, value) for every scalar in a JSON tree."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}" if path else k) if isinstance(v, (dict, list)) else [(path, k, v)]
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]") if isinstance(v, (dict, list)) else [(path, None, v)]


def expand(ref, unit_ids):
    """u.S.SH.* -> all units with that prefix; plain ids -> [ref]."""
    if ref.endswith(".*"):
        prefix = ref[:-1]
        return [u for u in unit_ids if u.startswith(prefix)]
    return [ref]


def iso(d):
    parts = [int(x) for x in d.split("-")]
    return date(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1), len(parts)


def interval(d):
    """[first day, last day] covered by an ISO date of year/month/day precision."""
    start, prec = iso(d)
    if prec == 3:
        return start, start
    if prec == 2:
        nxt = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        return start, date.fromordinal(nxt.toordinal() - 1)
    return start, date(start.year, 12, 31)


def after(a, b):
    """True only if date a lies entirely after date b (precision-aware)."""
    return interval(a)[0] > interval(b)[1]


# a standalone number in an editorial label (digits glued to Latin letters, e.g. CXCR4 / IL-6, are names)
LABEL_NUMBER = re.compile(r"(?<![A-Za-z0-9\-])\d+(?:\.\d+)?(?![A-Za-z])")


def fact_date(fact, by_id):
    """Effective ISO date string of a value/date fact, or None."""
    if fact["type"] == "date":
        return effective(fact).get("date")
    d = fact.get("date")
    if isinstance(d, str):
        return fact_date(by_id[d], by_id) if d in by_id else None
    eff = effective(fact)
    return eff.get("date") if isinstance(d, dict) else None


def is_pending(fact, by_id):
    """Unreviewed with a proposal on the fact itself or on the date fact it points to."""
    if effective(fact)["pending"]:
        return True
    d = fact.get("date")
    return isinstance(d, str) and d in by_id and effective(by_id[d])["pending"]


def compat(fact):
    attrs = fact.get("attrs") or {}
    key = {k: attrs.get(k) for k in COMPAT_KEYS}
    if fact["kind"] in ("exact", "bound"):
        key["unit"] = effective(fact).get("unit")
    return key


# ---------------------------------------------------------------- gates

def v1_structure(facts, views, raw, units, rep):
    by_id = {}
    for f in facts:
        if f["id"] in by_id:
            rep.err("V1", f"duplicate fact id {f['id']}")
        by_id[f["id"]] = f
        if f.get("kind") not in KINDS:
            rep.err("V1", f"{f['id']}: bad kind {f.get('kind')}")
        for k in ("raw", "origin", "parsed"):
            if k not in f and not (k == "parsed" and f["type"] == "unit"):
                rep.err("V1", f"{f['id']}: missing {k}")
        d = f.get("date")
        if isinstance(d, str) and (d not in by_id and not any(x["id"] == d for x in facts)):
            rep.err("V1", f"{f['id']}: date ref {d} does not exist")
        r = f.get("review")
        if r and r.get("status") not in STATUSES:
            rep.err("V1", f"{f['id']}: bad review status {r.get('status')}")

    view_ids = set()
    for p, k, v in walk(views):
        if k == "id":
            if v in view_ids:
                rep.err("V1", f"duplicate view id {v}")
            view_ids.add(v)
    unit_ids = list(units)
    pictures = {(s["slide"], sh["id"]): sh for s in raw["slides"] for sh in s["shapes"]}
    for p, k, v in walk(views):
        if not isinstance(v, str) or k == "id" or k in LABEL_KEYS:
            continue
        if k == "table":
            sh = pictures.get(tuple(int(x) for x in v[2:].split(".")))
            if not sh or sh.get("kind") != "table":
                rep.err("V1", f"{p}.table {v} is not a table shape")
        elif v.startswith(REF_PREFIXES):
            targets = expand(v, unit_ids)
            if not targets or any(t not in by_id for t in targets):
                rep.err("V1", f"{p}: unresolved reference {v}")
        elif v.startswith(VIEW_PREFIXES) and k != "section" and v not in view_ids:
            rep.err("V1", f"{p}: unresolved view reference {v}")
        elif k == "section" and v not in view_ids:
            rep.err("V1", f"{p}: unknown section {v}")
    for b in views["blocks"]:
        if b["type"] != "image":
            continue
        pic = pictures.get((b["slide"], b["shape"]))
        if not pic or pic.get("kind") != "picture":
            rep.err("V1", f"{b['id']}: slide {b['slide']} shape {b['shape']} is not a picture")
            continue
        for a in b.get("annotations", []):
            ann = pictures.get((b["slide"], a["shape"]))
            if not ann or (ann.get("annotates") or {}).get("picture_id") != b["shape"]:
                rep.err("V1", f"{a['id']}: shape {a['shape']} is not an annotation on picture {b['shape']}")
        for o in b.get("overlays", []):
            if (pictures.get((b["slide"], o["shape"])) or {}).get("kind") != "picture":
                rep.err("V1", f"{b['id']}: overlay shape {o['shape']} is not a picture")
        for sh in b.get("placements", []):
            pl = pictures.get((b["slide"], sh))
            if not pl or pl.get("file") != pic.get("file"):
                rep.err("V1", f"{b['id']}: placement {sh} is not the same picture as shape {b['shape']}")
    return by_id


def referenced_units(views, units):
    used = set()
    unit_ids = list(units)
    for p, k, v in walk(views):
        if not isinstance(v, str):
            continue
        if k == "table":
            used.update(u for u in unit_ids if u.startswith(v + ".r"))
        elif v.startswith(REF_PREFIXES):
            used.update(expand(v, unit_ids))
    return used


def v2_pictures(views, raw, rep):
    """Every picture file in the PPT must be shown by an image view; the slide deck view
    must cover every rendered slide."""
    shapes = {(s["slide"], sh["id"]): sh for s in raw["slides"] for sh in s["shapes"]}
    shown = set()
    for b in views["blocks"]:
        if b["type"] == "image":
            for sh in [b["shape"]] + b.get("placements", []) + [o["shape"] for o in b.get("overlays", [])]:
                if (b["slide"], sh) in shapes:
                    shown.add(shapes[(b["slide"], sh)].get("file"))
    all_files = {sh["file"] for sh in shapes.values() if sh.get("kind") == "picture"}
    missing = sorted(all_files - shown)
    for f in missing:
        where = [k for k, sh in shapes.items() if sh.get("file") == f]
        rep.err("V2", f"PPT picture not shown by any image view: {f} (slide/shape {where[:3]})")
    deck = [b for b in views["blocks"] if b["type"] == "slide_deck"]
    if not deck or deck[0].get("range") != "all":
        rep.err("V2", "no slide_deck view covering all original slides")
    return [f"picture:{f}" for f in missing]


def v2_omission(facts, views, units, raw, rep):
    used = referenced_units(views, units)
    by_id = {f["id"]: f for f in facts}
    # a referenced date fact is rendered as a date chip showing its whole source unit
    used |= {by_id[r]["loc"]["unit"] for r in list(used)
             if r in by_id and by_id[r]["type"] == "date" and by_id[r]["origin"] == "pptx"}
    missing = [f["id"] for f in facts if f["type"] == "unit" and not f.get("excluded") and f["id"] not in used]
    for m in missing:
        rep.err("V2", f"PPT unit not shown by any view: {m} {units[m][1][:40]!r}")
    missing += v2_pictures(views, raw, rep)
    unused_values = [f["id"] for f in facts if f["type"] == "value" and f["id"] not in used
                     and (f.get("loc") or {}).get("unit") not in used]
    for u in unused_values:
        rep.warn("V2", f"value fact not referenced by any view: {u}")
    return len(missing)


def v3_reread(facts, units, rep, by_id):
    gene_of = {f["id"]: effective(f)["text"] for f in facts if f["id"].startswith("f.gene.")}
    image_facts = 0
    for f in facts:
        if f["origin"] != "pptx":
            image_facts += f["origin"] == "image"
            continue
        loc = f.get("loc") or {}
        uid = loc.get("unit")
        if uid not in units:
            rep.err("V3", f"{f['id']}: loc points to unknown unit {uid}")
            continue
        uloc, text = units[uid]
        if any(uloc.get(k) != loc.get(k) for k in uloc):
            rep.err("V3", f"{f['id']}: loc {loc} disagrees with unit {uid} {uloc}")
            continue
        s, e = loc["span"]
        if text[s:e] != f["raw"]:
            rep.err("V3", f"{f['id']}: raw {f['raw']!r} not at {uid}[{s}:{e}] (found {text[s:e]!r})")
            continue
        if "ctx" in f and text[max(0, s - len(f["ctx"])):s] != f["ctx"]:
            rep.err("V3", f"{f['id']}: context before value changed")
        if f["type"] == "unit":
            continue
        if f["type"] == "date":
            try:
                iso(f["parsed"]["value"])
            except (ValueError, KeyError):
                rep.err("V3", f"{f['id']}: bad ISO date {f['parsed'].get('value')}")
                continue
            for problem in check_date(f["parsed"]["value"], f["raw"]):
                rep.err("V3", f"{f['id']}: date {problem}")
            continue
        try:
            reparsed = parse_value(f["raw"], f["kind"])
        except ValueError as ex:
            rep.err("V3", f"{f['id']}: {ex}")
            continue
        for field, authored, fresh in compare_parsed(f["parsed"], reparsed):
            rep.err("V3", f"{f['id']}: parsed.{field}={authored!r} but raw says {fresh!r}")
        if f["parsed"].get("canonical") != canonical(f):
            rep.err("V3", f"{f['id']}: canonical value/unit inconsistent with raw")
        for problem in check_labels(f, units, gene_of):
            rep.err("V3", f"{f['id']}: {problem}")
    return image_facts


def v4_views(views, by_id, rep):
    for p, k, v in walk(views):
        if isinstance(v, str) and k in ("label",) and LABEL_NUMBER.search(v):
            rep.err("V4", f"{p}.label contains a digit (numbers must come from facts): {v!r}")
        if isinstance(v, (int, float)) and k not in ("slide", "shape") and not p.endswith(".placements"):
            rep.err("V4", f"{p}.{k}: literal number {v} in views")

    for b in views["blocks"]:
        for s in b.get("series", []):
            pts = [by_id[pt["fact"]] for pt in s["points"]]
            ref = None
            for f in pts:
                if f["kind"] not in ("exact", "bound", "not_detected"):
                    rep.err("V4", f"{s['id']}: {f['id']} kind {f['kind']} cannot be plotted")
                key = compat(f)
                if ref is None and f["kind"] != "not_detected":
                    ref = key
                elif ref is not None:
                    diffs = {k: (ref[k], key[k]) for k in key if k in ref and key[k] != ref[k]
                             and not (k == "unit" and f["kind"] == "not_detected")}
                    if diffs:
                        rep.err("V4", f"{s['id']}: {f['id']} incompatible with series {diffs}")
            dates = [fact_date(f, by_id) for f in pts]
            for a, b_, fa, fb in zip(dates, dates[1:], pts, pts[1:]):
                if a and b_ and after(a, b_):
                    msg = f"{s['id']}: points out of date order {fa['id']} ({a}) > {fb['id']} ({b_})"
                    (rep.warn if is_pending(fa, by_id) or is_pending(fb, by_id) else rep.err)("V4", msg)
            for h in s.get("held", []):
                f = by_id[h["fact"]]
                if ref and all(compat(f).get(k) == ref.get(k) for k in ref) and not is_pending(f, by_id):
                    rep.err("V4", f"{s['id']}: held point {f['id']} is compatible; put it in points")
            for pt in s["points"]:
                main = by_id[pt["fact"]]
                for cid in pt.get("corroborate", []):
                    c = by_id[cid]
                    em, ec = effective(main), effective(c)
                    same_kind = (main["kind"] == "not_detected") == (c["kind"] == "not_detected")
                    same_val = main["kind"] == "not_detected" or (
                        em.get("value") is not None and ec.get("value") is not None
                        and abs(em["value"] - ec["value"]) <= 1e-9 * max(1.0, abs(em["value"])))
                    if compat(main)["analyte"] != compat(c)["analyte"] or compat(main)["method"] != compat(c)["method"]:
                        rep.err("V4", f"{s['id']}: {cid} corroborates {main['id']} but measures something else")
                    elif not (same_kind and same_val):
                        msg = f"{s['id']}: {cid} ({c['raw']}) disagrees with {main['id']} ({main['raw']})"
                        (rep.warn if is_pending(c, by_id) or is_pending(main, by_id) else rep.err)("V4", msg)
                    elif fact_date(c, by_id) != fact_date(main, by_id):
                        rep.warn("V4", f"{s['id']}: {cid} dated {fact_date(c, by_id)} vs {main['id']} {fact_date(main, by_id)}")

        for ev_list in (b.get("events", []),):
            prev = None
            for ev in ev_list:
                ed = fact_date(by_id[ev["date"]], by_id)
                pend = is_pending(by_id[ev["date"]], by_id)
                if prev and ed and after(prev[1], ed):
                    msg = f"{ev['id']}: event dated {ed} comes after {prev[0]} ({prev[1]})"
                    (rep.warn if pend or prev[2] else rep.err)("V4", msg)
                prev = (ev["id"], ed, pend)
                for fid in ev.get("facts", []):
                    fd = fact_date(by_id[fid], by_id)
                    if not fd or not ed:
                        continue
                    (d1, p1), (d2, p2) = iso(ed), iso(fd)
                    close = abs((d2 - d1).days) <= 7 if min(p1, p2) == 3 else (d1.year, d1.month) == (d2.year, d2.month)
                    if not close:
                        rep.err("V4", f"{ev['id']}: fact {fid} dated {fd}, event dated {ed}")
        for ph in b.get("phases", []):
            s_, e_ = fact_date(by_id[ph["start"]], by_id), ph["end"] and fact_date(by_id[ph["end"]], by_id)
            if s_ and e_ and after(s_, e_):
                rep.err("V4", f"{ph['id']}: starts {s_} after it ends {e_}")


def v5_review(facts, rep, release):
    open_items = []
    for f in facts:
        r = f.get("review")
        if not r:
            continue
        if r["status"] == "unreviewed":
            open_items.append(f["id"])
        elif r["status"] == "confirmed":
            if not (r.get("by") and r.get("at")):
                rep.err("V5", f"{f['id']}: confirmed without reviewer/time")
            if r.get("proposed") and not r.get("basis"):
                rep.err("V5", f"{f['id']}: confirmed correction without basis")
        if f.get("type") == "date" and f.get("origin") != "pptx" and not f.get("note"):
            rep.err("V5", f"{f['id']}: {f['origin']} date without note")
    if release and open_items:
        rep.err("V5", f"{len(open_items)} review items still open (release gate)")
    return open_items


def v6_version(case_dir, rep):
    version = content_version(case_dir / "facts.json", case_dir / "views.json")
    tours_dir = case_dir / "tours"
    n = 0
    for t in sorted(tours_dir.glob("*.json")) if tours_dir.exists() else []:
        n += 1
        tour = json.loads(t.read_text(encoding="utf-8"))
        if tour.get("content_version") != version:
            rep.err("V6", f"{t.name}: bound to {tour.get('content_version')}, content is {version} (stale — re-review)")
    return version, n


# ---------------------------------------------------------------- entry points

def validate(case_dir, facts_doc=None, views=None, release=False):
    """Run all gates. facts_doc / views may be passed in-memory (used by mutation tests)."""
    case_dir = Path(case_dir)
    raw = load_raw(case_dir)
    units = unit_index(raw)
    facts_doc = facts_doc or json.loads((case_dir / "facts.json").read_text(encoding="utf-8"))
    views = views or json.loads((case_dir / "views.json").read_text(encoding="utf-8"))
    facts = facts_doc["facts"]
    rep = Report()
    by_id = v1_structure(facts, views, raw, units, rep)
    if rep.errors:  # later gates assume references resolve
        return rep, {}
    stats = {"missing_units": v2_omission(facts, views, units, raw, rep),
             "image_facts": v3_reread(facts, units, rep, by_id)}
    v4_views(views, by_id, rep)
    stats["open_reviews"] = len(v5_review(facts, rep, release))
    stats["content_version"], stats["tours"] = v6_version(case_dir, rep)
    return rep, stats


def main(argv):
    case_dir = Path(argv[1] if len(argv) > 1 and not argv[1].startswith("--") else "cases/case1")
    rep, stats = validate(case_dir, release="--release" in argv)
    for w in rep.warnings:
        print("  warn " + w)
    for e in rep.errors:
        print("  ERR  " + e)
    print(f"stats: {stats}")
    print(f"{len(rep.errors)} errors, {len(rep.warnings)} warnings -> {'FAIL' if rep.errors else 'OK'}")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
