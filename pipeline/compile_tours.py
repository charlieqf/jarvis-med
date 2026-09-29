"""Step ⑤: compile answer plans (cases/<case>/plans/*.yaml) into playable tours.

A plan is a list of steps; each step has a camera target, visual actions and claims.
Claims are the ONLY source of on-screen text (say / callout), and follow DESIGN §6.2:

  quote   {type: quote, fact: <unit or statement fact>}       verbatim source text
  value   {type: value, template: "... {{f.x}} ... {{date:f.x}} ..."}
  change  {type: change, template: "... {{change:f.a,f.b}} ..."}  computed by code;
          both facts must be exact, compatible and not pending review

Template free text may not contain numbers, causal/interpretive words, or medical
entities that do not appear in the cited facts' source text.

Usage: python pipeline/compile_tours.py cases/case1        (writes cases/case1/tours/*.json)
Exit 1 if any plan fails to compile.
"""
import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from factlib import content_version, effective, load_raw, unit_index  # noqa: E402

SUPER = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")
PLACEHOLDER = re.compile(r"\{\{\s*(?:(date|change):)?([^}]+?)\s*\}\}")
FREE_NUMBER = re.compile(r"(?<![A-Za-z0-9\-.])\d+(?:\.\d+)?(?![A-Za-z0-9.])")
CAUSAL = ["因为", "由于", "导致", "引起", "造成", "所以", "因此", "提示", "说明", "证明", "表明", "意味着", "归因"]
ENTITIES = ["M蛋白", "κ", "λ", "MRD", "NGS", "NGF", "SUVmax", "PET", "CXCR4", "CRS", "IL-6", "BCMA", "CAR-T", "VRD", "KD",
            "移植", "放疗", "CMV", "埃纳妥", "兆珂速", "达雷妥尤", "泊马度胺", "托珠单抗", "1q21", "FGFR3", "13q14", "Rb1", "P53",
            "FISH", "Ki-67", "C-myc", "sCR", "VGPR", "免疫固定电泳", "血清蛋白电泳", "乳腺", "髂骨", "腹股沟", "上臂", "腹壁",
            "肩胛", "Hb", "PLT", "CRP", "IgG", "ORR", "DOR", "PFS", "OS", "母细胞样", "浆细胞瘤", "NRAS", "IGLL5", "KRAS", "TET1"]
OPS = {"camera", "spotlight", "pulse", "chartDraw", "pointPulse", "timelineSweep", "phaseHighlight", "rowFlash",
       "cellZoom", "drawHotspot", "imageOpen", "compareRow", "showSource", "countUp", "bodyMap", "holoScene"}
COMPAT = ("analyte", "method", "specimen", "site", "tracer")


class CompileError(Exception):
    pass


def pretty(text):
    """Source notation -> display: 10^{-4} -> 10⁻⁴, 1.9*10-3 -> 1.9×10⁻³."""
    text = re.sub(r"^\s*[·\-]\s*", "", text)  # list bullets typed into the slide text
    text = re.sub(r"(\d(?:\.\d+)?)[eE]([-+]?\d+)", lambda m: f"{m.group(1)}×10{str(int(m.group(2))).translate(SUPER)}", text)
    text = re.sub(r"(\d)\s*\*\s*(?!10)(\d)", r"\1×\2", text)
    text = re.sub(r"\^\{([^}]*)\}", lambda m: m.group(1).translate(SUPER), text)
    text = re.sub(r"(\d)\s*\*\s*10", r"\1×10", text)
    text = re.sub(r"×10(-\d+)", lambda m: "×10" + m.group(1).translate(SUPER), text)
    return text


EXP = re.compile(r"[eE][-+]?\d+|(?:[*×]\s*10)(?:\^\{[^}]*\}|-\d+|[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)")


def mantissa_digits(s):
    """All digits of a string, ignoring powers-of-ten notation (so 1.46E-01 == 1.46×10⁻¹)."""
    s = EXP.sub("", s).translate(str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789"))  # m² keeps its 2
    return re.sub(r"\D", "", s)


def pretty_checked(text):
    shown = pretty(text)
    if mantissa_digits(shown) != mantissa_digits(text):
        raise CompileError(f"display formatting changed digits: {text!r} -> {shown!r}")
    return shown


def sci(v):
    if v == 0 or 1e-3 <= abs(v) < 1e4:
        return f"{v:g}"
    m, e = f"{v:.3g}".split("e") if "e" in f"{v:.3g}" else (f"{v:.3g}", "0")
    return f"{m}×10{str(int(e)).translate(SUPER)}"


class Ctx:
    def __init__(self, case_dir):
        self.case_dir = Path(case_dir)
        self.facts = {f["id"]: f for f in json.loads((self.case_dir / "facts.json").read_text(encoding="utf-8"))["facts"]}
        self.views = json.loads((self.case_dir / "views.json").read_text(encoding="utf-8"))
        self.units = unit_index(load_raw(self.case_dir))
        self.anchors = self._anchors()
        self.series_facts = {pt["fact"] for b in self.views["blocks"] for s in b.get("series", []) for pt in s["points"]}

    def _anchors(self):
        reg = {fid: "fact" for fid in self.facts}

        def walk(node, kind):
            if isinstance(node, dict):
                if "id" in node:
                    reg[node["id"]] = node.get("type") or kind
                for k, v in node.items():
                    walk(v, {"events": "event", "phases": "phase", "series": "series", "annotations": "annotation",
                             "rows": "row", "groups": "group", "pins": "pin"}.get(k, kind))
            elif isinstance(node, list):
                for v in node:
                    walk(v, kind)
        walk(self.views["blocks"], "block")
        for s in self.views["sections"]:
            reg[s["id"]] = "section"
        for b in self.views["blocks"]:  # table row anchors: <block>.r<n>
            if b["type"] == "table":
                sl, sh = b["table"][2:].split(".")
                n = sum(1 for u in self.units if u.startswith(f"u.{sl}.{sh}.r") and u.endswith("c0"))
                for r in range(n + 1):
                    reg[f"{b['id']}.r{r}"] = "table_row"
        return reg

    # ------------------------------------------------------------ formatting

    def fmt_value(self, fid):
        f = self.facts[fid]
        eff, rev = effective(f), f.get("review") or {}
        if f["type"] == "date":
            return self.fmt_date(fid)
        if f["type"] == "unit" or f["kind"] in ("statement", "qualitative", "missing"):
            text = pretty_checked(eff["text"])
        elif f["kind"] == "not_detected":
            text = f["raw"] if not re.fullmatch(r"\d+", f["raw"]) else f"未检出（原文 {f['raw']}）"
        else:
            text = pretty_checked(f["raw"])
            if rev.get("status") == "confirmed" and (rev.get("proposed") or {}).get("value") is not None:
                text = sci(rev["proposed"]["value"])
            if not f["parsed"].get("unit"):
                unit = (f.get("implied_unit") or {}).get("unit")
                if not unit and rev.get("status") == "confirmed":
                    unit = (rev.get("proposed") or {}).get("unit")
                if unit and unit != "fraction":
                    text += f" {unit}"
        if eff["pending"]:
            prop = rev["proposed"]
            shown = prop.get("text") or prop.get("unit") or (sci(prop["value"]) if isinstance(prop.get("value"), float) else prop.get("value"))
            text += f"（原文如此；疑为 {shown}，未确认）" if shown else "（原文如此，待审核）"
        return text  # image readings are flagged on the claim (UI badge), not repeated inline

    def fmt_date(self, fid):
        f = self.facts[fid]
        if f["type"] != "date":
            d = f.get("date")
            if isinstance(d, str):
                return self.fmt_date(d)
            if isinstance(d, dict):
                s = d["value"].replace("-", ".")
                return ("约 " if d["basis"] == "inferred" else "") + s
            raise CompileError(f"{fid} has no date")
        eff, rev = effective(f), f.get("review") or {}
        s = eff["date"].replace("-", ".")
        if f.get("origin") == "inferred":
            return f"约 {s}（推断）"
        if eff["pending"]:
            return f"{s}（原文如此；疑为 {rev['proposed']['value'].replace('-', '.')}，未确认）"
        return s

    def change(self, a, b):
        fa, fb = self.facts[a], self.facts[b]
        for f in (fa, fb):
            if f.get("kind") != "exact":
                raise CompileError(f"change: {f['id']} is {f.get('kind')}, only exact values can be compared")
            if effective(f)["pending"]:
                raise CompileError(f"change: {f['id']} has an unconfirmed correction")
        ka = {k: (fa.get("attrs") or {}).get(k) for k in COMPAT}
        kb = {k: (fb.get("attrs") or {}).get(k) for k in COMPAT}
        ua, ub = effective(fa).get("unit"), effective(fb).get("unit")
        if ka != kb or ua != ub:
            raise CompileError(f"change: {a} and {b} are not comparable ({ka}/{ua} vs {kb}/{ub})")
        va, vb = effective(fa)["value"], effective(fb)["value"]
        pct = (vb - va) / va * 100
        word = f"下降 {abs(pct):.1f}%" if pct < 0 else f"上升 {pct:.1f}%"
        return f"{self.fmt_value(a)} → {self.fmt_value(b)}（{word}）"

    # ------------------------------------------------------------ claims

    def source_text(self, fid):
        f = self.facts[fid]
        parts = [f.get("raw") or "", " ".join(str(v) for v in (f.get("attrs") or {}).values())]
        uid = (f.get("loc") or {}).get("unit")
        if uid:
            parts.append(self.units[uid][1])
        return " ".join(parts)

    def claim(self, c, cid):
        t = c.get("type")
        if t == "quote":
            fid = c["fact"]
            f = self.facts.get(fid)
            if not f or not (f["type"] == "unit" or f.get("kind") == "statement"):
                raise CompileError(f"{cid}: quote must cite a source unit or statement fact, got {fid}")
            if f.get("excluded"):
                raise CompileError(f"{cid}: {fid} is excluded")
            return {"claim": cid, "type": t, "text": self.fmt_value(fid), "cite": [fid], "verbatim": True}
        if t not in ("value", "change"):
            raise CompileError(f"{cid}: unknown claim type {t}")
        tpl = c["template"]
        cite, flags = [], set()

        def sub(m):
            kind, arg = m.group(1), m.group(2)
            if kind == "change":
                if t != "change":
                    raise CompileError(f"{cid}: {{{{change:…}}}} only allowed in change claims")
                a, b = [x.strip() for x in arg.split(",")]
                for x in (a, b):
                    if x not in self.facts:
                        raise CompileError(f"{cid}: unknown fact {x}")
                cite.extend([a, b])
                return self.change(a, b)
            if arg not in self.facts:
                raise CompileError(f"{cid}: unknown fact {arg}")
            f = self.facts[arg]
            if f.get("excluded"):
                raise CompileError(f"{cid}: {arg} is excluded")
            cite.append(arg)
            date_ref = f.get("date") if isinstance(f.get("date"), str) else None
            if effective(f)["pending"] or (kind == "date" and date_ref and effective(self.facts[date_ref])["pending"]):
                flags.add("pending_review")
            if f.get("origin") == "image":
                flags.add("image_reading")
            return self.fmt_date(arg) if kind == "date" else self.fmt_value(arg)

        text = PLACEHOLDER.sub(sub, tpl)
        for extra in c.get("cite", []):  # sources for words in the template (not rendered as values)
            if extra not in self.facts:
                raise CompileError(f"{cid}: unknown cited fact {extra}")
            cite.append(extra)
        free = PLACEHOLDER.sub(" ", tpl)
        if FREE_NUMBER.search(free):
            raise CompileError(f"{cid}: template text contains a number outside placeholders: {free!r}")
        for w in CAUSAL:
            if w in free:
                raise CompileError(f"{cid}: causal/interpretive word {w!r} in template; use a quote claim")
        src = " ".join(self.source_text(x) for x in cite)
        for e in ENTITIES:
            if e in free and e not in src:
                raise CompileError(f"{cid}: entity {e!r} in template is not in the cited facts")
        return {"claim": cid, "type": t, "text": text, "cite": list(dict.fromkeys(cite)), "flags": sorted(flags)}

    # ------------------------------------------------------------ steps

    def check_target(self, where, target, allowed=None):
        kind = self.anchors.get(target)
        if kind is None and target in self.units:
            kind = "unit"
        if kind is None:
            raise CompileError(f"{where}: unknown anchor {target}")
        if allowed and kind not in allowed:
            raise CompileError(f"{where}: {target} is a {kind}, expected {allowed}")

    def action(self, a, where):
        op = a.get("op")
        if op not in OPS:
            raise CompileError(f"{where}: unknown op {op}")
        targets = a.get("targets") or ([a["target"]] if "target" in a else [])
        allowed = {"chartDraw": {"series", "stacked_bar"}, "pointPulse": {"fact"}, "phaseHighlight": {"phase"},
                   "drawHotspot": {"annotation"}, "imageOpen": {"image"}, "compareRow": {"row"},
                   "rowFlash": {"table_row"}, "cellZoom": {"fact"}, "showSource": {"fact"},
                   "countUp": {"fact"}, "timelineSweep": {"event"}, "bodyMap": {"pin"}, "holoScene": {"holo_scene"}}.get(op)
        for t in targets:
            self.check_target(where, t, allowed)
        if op == "pointPulse" and any(t not in self.series_facts for t in targets):
            raise CompileError(f"{where}: pointPulse target is not a plotted point")
        if op == "timelineSweep" and len(targets) != 2:
            raise CompileError(f"{where}: timelineSweep needs [from_event, to_event]")
        return {"op": op, "targets": targets}

    def compile_step(self, s, seq, plan_id):
        """Compile one plan step (used by batch compile and by the live plan worker)."""
        where = f"{plan_id}.{s.get('id', f's{seq + 1}')}"
        if not s.get("camera"):
            raise CompileError(f"{where}: step needs a camera target")
        self.check_target(where, s["camera"])
        if not s.get("claims"):
            raise CompileError(f"{where}: step has no claims")
        claims = [self.claim(c, f"{where}.c{j}") for j, c in enumerate(s["claims"])]
        ids = {c["claim"] for c in claims}
        callouts = []
        for co in s.get("callouts", []):
            cid = f"{where}.c{co['claim']}"
            if cid not in ids:
                raise CompileError(f"{where}: callout refers to missing claim {co['claim']}")
            self.check_target(where, co["target"])
            callouts.append({"target": co["target"], "claim": cid})
        step = {"id": where, "seq": seq, "camera": s["camera"], "title": s.get("title"),
                "actions": [self.action(a, where) for a in s.get("actions", [])],
                "say": claims, "callouts": callouts}
        checks = [{"claim": c["claim"], "type": c["type"], "cite": c["cite"], "flags": c.get("flags", []), "result": "pass"}
                  for c in claims]
        return step, checks

    def compile(self, plan, version):
        steps, checks = [], []
        for i, s in enumerate(plan["steps"]):
            step, ch = self.compile_step(s, i, plan["id"])
            steps.append(step)
            checks += ch
        return {"id": plan["id"], "question": plan["question"], "content_version": version,
                "reviewed_by": plan.get("reviewed_by"), "steps": steps, "checks": checks}


def main(case_dir):
    case_dir = Path(case_dir)
    ctx = Ctx(case_dir)
    version = content_version(case_dir / "facts.json", case_dir / "views.json")
    out_dir = case_dir / "tours"
    out_dir.mkdir(exist_ok=True)
    failed = False
    for p in sorted((case_dir / "plans").glob("*.yaml")):
        plan = yaml.safe_load(p.read_text(encoding="utf-8"))
        try:
            tour = ctx.compile(plan, version)
        except CompileError as e:
            print(f"FAIL {p.name}: {e}")
            failed = True
            continue
        (out_dir / f"{plan['id']}.json").write_text(json.dumps(tour, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"ok   {p.name}: {len(tour['steps'])} steps, {len(tour['checks'])} claims")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "cases/case1"))
