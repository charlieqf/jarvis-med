"""Export a case for the web app: resolve views against facts/raw into one bundle.

Output (web/public/cases/<case>/):
  bundle.json   sections, blocks (references resolved), facts (with effective values)
  media/        embedded pictures        slides/  full-slide renders
  tours/        compiled tours (copied from cases/<case>/tours)

Usage: python pipeline/compile_web.py cases/case1
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from factlib import content_version, effective, load_raw, unit_index  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def expand(refs, unit_ids):
    out = []
    for r in refs or []:
        out += [u for u in unit_ids if u.startswith(r[:-1])] if r.endswith(".*") else [r]
    return out


def main(case_dir):
    case_dir = Path(case_dir)
    name = case_dir.name
    out_dir = ROOT / "web" / "public" / "cases" / name
    raw = load_raw(case_dir)
    units = unit_index(raw)
    unit_ids = list(units)
    facts = json.loads((case_dir / "facts.json").read_text(encoding="utf-8"))["facts"]
    views = json.loads((case_dir / "views.json").read_text(encoding="utf-8"))
    shapes = {(s["slide"], sh["id"]): sh for s in raw["slides"] for sh in s["shapes"]}
    emphasis = {}
    for s in raw["slides"]:
        for sh in s["shapes"]:
            for i, p in enumerate(sh.get("paragraphs", [])):
                if p.get("emphasis"):
                    emphasis[f"u.{s['slide']}.{sh['id']}.p{i}"] = p["emphasis"]

    by_id = {f["id"]: f for f in facts}
    out_facts = {}
    inner = {}  # unit id -> value/date facts located inside it
    for f in facts:
        eff = effective(f)
        date_basis, date_note, date_ref = None, None, None
        if isinstance(f.get("date"), str):
            d = by_id[f["date"]]
            date_ref, eff["date"] = d["id"], effective(d).get("date")
            date_basis = d.get("basis") or d["origin"]
            date_note = d.get("note")
            eff["date_pending"] = effective(d)["pending"]
        elif isinstance(f.get("date"), dict):
            date_basis, date_note = f["date"]["basis"], f["date"].get("note")
        elif f["type"] == "date":
            date_basis, date_note = f.get("basis") or f["origin"], f.get("note")
        rec = {k: f.get(k) for k in ("id", "type", "kind", "raw", "origin", "attrs", "excluded") if f.get(k) is not None}
        loc = f.get("loc") or {}
        rec["slide"] = loc.get("slide")
        if "unit" in loc and f["type"] != "unit":
            rec["unit"], rec["span"] = loc["unit"], loc["span"]
            inner.setdefault(loc["unit"], []).append(f["id"])
        if "image" in loc:
            rec["image"] = loc["image"]
        rec["eff"] = eff
        if date_basis:
            rec["date_basis"], rec["date_note"], rec["date_ref"] = date_basis, date_note, date_ref
        if f.get("review"):
            rec["review"] = {k: f["review"].get(k) for k in ("status", "proposed", "issue", "basis", "by", "at")}
        if f.get("implied_unit"):
            rec["implied_unit"] = f["implied_unit"]
        if f["id"] in emphasis:
            rec["emphasis"] = emphasis[f["id"]]
        out_facts[f["id"]] = rec
    for uid, ids in inner.items():
        out_facts[uid]["inner"] = sorted(ids, key=lambda i: out_facts[i]["span"][0])

    def picture(slide, shape_id):
        sh = shapes[(slide, shape_id)]
        return {"src": f"media/{sh['file']}", "bbox": sh["bbox"], "crop": sh["crop"], "px": sh["px"]}

    blocks = []
    for b in views["blocks"]:
        b = json.loads(json.dumps(b))
        for key in ("units", "notes", "footnotes", "citations", "label_units", "chapter", "total_labels"):
            if key in b:
                b[key] = expand(b[key], unit_ids)
        for key in ("title", "caption", "heading"):
            if isinstance(b.get(key), str) and b[key].endswith(".*"):
                b[key] = expand([b[key]], unit_ids)
            elif isinstance(b.get(key), str):
                b[key] = [b[key]]
        for g in b.get("groups", []):
            g["units"] = expand(g.get("units"), unit_ids)
            if g.get("title"):
                g["title"] = [g["title"]]
        for ev in b.get("events", []):
            ev["units"] = expand(ev.get("units"), unit_ids)
        for ph in b.get("phases", []):
            ph["chapter"] = expand(ph.get("chapter"), unit_ids)
        if b["type"] == "table":
            s, shp = (int(x) for x in b["table"][2:].split("."))
            rows = shapes[(s, shp)]["rows"]
            b["rows"] = [[f"u.{s}.{shp}.r{r}c{c}" if cell.strip() else None for c, cell in enumerate(row)]
                         for r, row in enumerate(rows)]
            b["slide"] = s
        if b["type"] == "image":
            pic = picture(b["slide"], b["shape"])
            b.update(pic)
            px, py, pw, ph = pic["bbox"]
            b["annotations"] = [dict(a, geom=shapes[(b["slide"], a["shape"])].get("geom"),
                                     rel_bbox=shapes[(b["slide"], a["shape"])]["annotates"]["rel_bbox"])
                                for a in b.get("annotations", [])]
            ovs = []
            for o in b.get("overlays", []):
                ob = shapes[(b["slide"], o["shape"])]
                x, y, w, h = ob["bbox"]
                ovs.append(dict(o, src=f"media/{ob['file']}", rel_bbox=[(x - px) / pw, (y - py) / ph, w / pw, h / ph]))
            b["overlays"] = ovs
            if b.get("placements"):
                b["placements"] = [dict(picture(b["slide"], p), shape=p) for p in b["placements"]]
        if b["type"] == "slide_deck":
            b["slides"] = [{"n": s["slide"], "src": f"slides/slide-{s['slide']:02d}.png"} for s in raw["slides"]]
        blocks.append(b)

    version = content_version(case_dir / "facts.json", case_dir / "views.json")
    bundle = {"case": name, "content_version": version, "aspect": raw["aspect"], "meta": views["meta"],
              "sections": views["sections"], "blocks": blocks, "facts": out_facts}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
    for sub in ("media", "slides"):
        if (out_dir / sub).exists():
            shutil.rmtree(out_dir / sub)
        shutil.copytree(case_dir / sub, out_dir / sub)
    if (out_dir / "tours").exists():
        shutil.rmtree(out_dir / "tours")
    if (case_dir / "tours").exists():
        shutil.copytree(case_dir / "tours", out_dir / "tours")
    print(f"bundle: {len(blocks)} blocks, {len(out_facts)} facts, version {version} -> {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cases/case1")
