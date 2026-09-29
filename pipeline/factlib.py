"""Shared helpers for the fact layer: source units, value/date parsing, locating spans.

Source unit = the smallest addressable piece of PPT text in raw/slides.json:
  u.<slide>.<shape>.p<i>          i-th non-empty paragraph of a text shape
  u.<slide>.<shape>.r<r>c<c>      table cell
  u.<slide>.<shape>.s<s>v<v>      native chart data point
Every unit becomes a `unit` fact (kind=statement, raw = full text). Authored value facts
point into a unit with a character span.
"""
import hashlib
import json
import re
from pathlib import Path

SUP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")


def load_raw(case_dir):
    return json.loads((Path(case_dir) / "raw" / "slides.json").read_text(encoding="utf-8"))


def iter_units(raw):
    """Yield (unit_id, loc, text) for every text unit in the deck."""
    for s in raw["slides"]:
        n = s["slide"]
        for sh in s["shapes"]:
            sid = sh["id"]
            for i, p in enumerate(sh.get("paragraphs", [])):
                yield f"u.{n}.{sid}.p{i}", {"slide": n, "shape": sid, "para": i}, p["text"]
            for r, row in enumerate(sh.get("rows", [])):
                for c, cell in enumerate(row):
                    if cell.strip():
                        yield f"u.{n}.{sid}.r{r}c{c}", {"slide": n, "shape": sid, "row": r, "col": c}, cell
            for si, se in enumerate(sh.get("series", [])):
                for vi, v in enumerate(se["values"]):
                    yield f"u.{n}.{sid}.s{si}v{vi}", {"slide": n, "shape": sid, "series": si, "point": vi}, repr(v)


def unit_id(loc):
    base = f"u.{loc['slide']}.{loc['shape']}"
    if "para" in loc:
        return f"{base}.p{loc['para']}"
    if "row" in loc:
        return f"{base}.r{loc['row']}c{loc['col']}"
    if "series" in loc:
        return f"{base}.s{loc['series']}v{loc['point']}"
    raise ValueError(f"bad loc {loc}")


def unit_index(raw):
    return {uid: (loc, text) for uid, loc, text in iter_units(raw)}


def locate(text, needle, occ=0):
    """Return [start, end] of the occ-th occurrence of needle in text, or None."""
    start = -1
    for _ in range(occ + 1):
        start = text.find(needle, start + 1)
        if start < 0:
            return None
    return [start, start + len(needle)]


# ---------------------------------------------------------------- values

NUM_RE = re.compile(
    r"^(?P<cmp><=|>=|≤|≥|<|>)?\s*"
    r"(?P<mant>\d+(?:\.\d+)?)"
    r"(?:[eE](?P<exp0>[-+]?\d+))?"
    r"(?:\s*[*×xX]\s*10\s*(?:\^\{(?P<exp1>[-−]?\d+)\}|(?P<exp2>[-−]\d+)|(?P<exp3>[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)))?"
    r"\s*(?P<unit>.*)$"
)
NEGATIVE_WORDS = ("阴性", "未见", "未检出", "全阴性", "（-）", "(-)", "0")


def parse_value(raw, kind):
    """Deterministically parse a raw fragment according to its declared kind.

    Returns a dict that must equal the authored `parsed` subset (see compare_parsed)."""
    s = raw.strip()
    if kind in ("exact", "bound"):
        m = NUM_RE.match(s)
        if not m:
            raise ValueError(f"not a number: {raw!r}")
        mant = float(m["mant"])
        exp = m["exp0"] or m["exp1"] or m["exp2"] or (m["exp3"].translate(SUP) if m["exp3"] else None)
        value = mant * (10 ** int(exp.replace("−", "-"))) if exp else mant
        cmp_ = {"≤": "<=", "≥": ">="}.get(m["cmp"], m["cmp"])
        unit = m["unit"].strip() or None
        if kind == "exact" and cmp_:
            raise ValueError(f"exact value has comparator: {raw!r}")
        if kind == "bound" and not cmp_:
            raise ValueError(f"bound value lacks comparator: {raw!r}")
        out = {"kind": kind, "value": round(value, 12), "unit": unit}
        if cmp_:
            out["comparator"] = cmp_
        return out
    if kind == "not_detected":
        if not any(w in s for w in NEGATIVE_WORDS):
            raise ValueError(f"not a negative result: {raw!r}")
        return {"kind": kind}
    if kind in ("qualitative", "statement", "label", "missing"):
        return {"kind": kind}
    raise ValueError(f"unknown kind {kind}")


def compare_parsed(authored, reparsed):
    """List of mismatching fields between authored parsed dict and re-parse of raw."""
    diffs = []
    for k, v in reparsed.items():
        a = authored.get(k)
        if k == "value":
            if a is None or abs(float(a) - v) > 1e-9 * max(1.0, abs(v)):
                diffs.append((k, a, v))
        elif a != v:
            diffs.append((k, a, v))
    # authored may not add a comparator the raw text does not have
    if "comparator" in authored and "comparator" not in reparsed:
        diffs.append(("comparator", authored["comparator"], None))
    return diffs


# ---------------------------------------------------------------- dates

DATE_RE = re.compile(r"(?:(?P<y>\d{4})\s*[年./-]\s*)?(?P<m>\d{1,2})(?:\s*[月./-]\s*(?P<d>\d{1,2}))?")


def date_parts(raw):
    m = DATE_RE.search(raw)
    if not m:
        return None
    return {k: int(v) for k, v in m.groupdict().items() if v}


def check_date(value, raw):
    """Every component present in raw must agree with ISO value (YYYY[-MM[-DD]])."""
    parts = date_parts(raw)
    if not parts:
        return [f"no date in {raw!r}"]
    iso = [int(x) for x in value.split("-")]
    names = ["y", "m", "d"]
    errs = []
    for i, name in enumerate(names):
        if name in parts and (i >= len(iso) or iso[i] != parts[name]):
            errs.append(f"{name}: raw {parts[name]} vs value {value}")
    return errs


# ---------------------------------------------------------------- canonical units / effective values

def canonical(fact):
    """{value, unit} in a comparable unit for numeric facts, else None."""
    p = fact.get("parsed", {})
    if p.get("kind") not in ("exact", "bound"):
        return None
    unit = p.get("unit") or (fact.get("implied_unit") or {}).get("unit")
    value = p["value"]
    if unit:
        unit = unit.replace(" ", "")
    if unit == "%":
        return {"value": round(value / 100, 12), "unit": "fraction"}
    return {"value": value, "unit": unit}


def effective(fact):
    """Value as the runtime may use it: confirmed proposals applied, everything else raw.

    Returns dict with keys: value/unit/date/text (as applicable), status, excluded, pending."""
    review = fact.get("review") or {}
    status = review.get("status", "none")
    out = {"status": status, "pending": status == "unreviewed" and bool(review.get("proposed")),
           "excluded": bool(fact.get("excluded"))}
    canon = (fact.get("parsed") or {}).get("canonical")
    if canon:
        out.update(value=canon["value"], unit=canon["unit"])
    if fact.get("type") == "date":
        out["date"] = fact["parsed"]["value"]
    elif isinstance(fact.get("date"), dict):
        out["date"] = fact["date"]["value"]
    out["text"] = fact.get("raw")
    proposed = review.get("proposed") or {}
    if status == "confirmed" and proposed:
        if proposed.get("exclude"):
            out["excluded"] = True
        if "value" in proposed:
            key = "date" if fact.get("type") == "date" else "value"
            out[key] = proposed["value"]
        for k in ("unit", "date", "text"):
            if k in proposed:
                out[k] = proposed[k]
    return out


# ---------------------------------------------------------------- label binding (V3b)

ANALYTE_KEYWORDS = {
    "M蛋白": ["M蛋白", "血清蛋白电泳", "SPEP"],
    "游离轻链κ": ["κ"],
    "游离轻链λ": ["λ"],
    "κ/λ比值": ["κ/λ"],
    "Hb": ["Hb"],
    "WBC": ["WBC"],
    "PLT": ["PLT", "血小板"],
    "CRP": ["CRP"],
    "IgG": ["IgG"],
    "SUVmax": ["SUVmax"],
    "13q14缺失": ["13q14"],
    "1q21扩增": ["1q21"],
    "Rb1缺失": ["Rb1"],
    "FGFR3/IgH重排": ["FGFR3/IgH"],
    "P53缺失": ["P53"],
    "Ki-67阳性率": ["Ki-67"],
    "C-myc阳性率": ["C-myc"],
    "BCMA阳性率": ["BCMA"],
}
METHOD_KEYWORDS = {"NGF": ["NGF", "免疫分型"], "NGS": ["NGS"]}
GENE_KEYWORDS = {"KRAS": ["KRAS"], "IGLL5": ["IGLL5"], "TET1": ["TET1"], "NRAS": ["NRAS", "NARS"]}


def nearest_label(context, table):
    """Which key of `table` has the keyword occurrence ending closest to the end of context."""
    best = None  # (end, length, key)
    for key, words in table.items():
        for w in words:
            for m in re.finditer(re.escape(w), context):
                cand = (m.end(), len(w), key)
                if best is None or cand > best:
                    best = cand
    return best[2] if best else None


def label_context(fact, units):
    """Text a reader sees before the value: row label (for table cells) + unit text up to the span."""
    loc = fact["loc"]
    _, text = units[loc["unit"]]
    prefix = ""
    if "row" in loc and loc.get("col", 0) > 0:
        label_uid = f"u.{loc['slide']}.{loc['shape']}.r{loc['row']}c0"
        if label_uid in units:
            prefix = units[label_uid][1] + " "
    # a `missing` fact's raw text IS the label (e.g. "WBC" with no value after it)
    end = loc["span"][1] if fact.get("kind") == "missing" else loc["span"][0]
    return prefix + text[:end]


def check_labels(fact, units, gene_of=None):
    """Return list of label-binding errors (analyte / method / gene keywords near the value)."""
    errs = []
    if fact.get("origin") != "pptx" or fact.get("type") != "value":
        return errs
    ctx = label_context(fact, units)
    attrs = fact.get("attrs") or {}
    checks = [("analyte", ANALYTE_KEYWORDS, attrs.get("analyte")),
              ("method", METHOD_KEYWORDS, attrs.get("method")),
              ("gene", GENE_KEYWORDS, attrs.get("gene") or (gene_of or {}).get(attrs.get("gene_fact")))]
    for name, table, want in checks:
        if want in table:
            got = nearest_label(ctx, table)
            if got != want:
                errs.append(f"{name} label near value is {got!r}, fact says {want!r}")
    return errs


def content_version(*paths):
    h = hashlib.sha256()
    for p in paths:
        h.update(Path(p).read_bytes())
    return h.hexdigest()[:12]
