"""Step ③': human review of the fact layer.

  python pipeline/review.py cases/case1                      regenerate review.md from facts.json
  python pipeline/review.py cases/case1 --set ID=STATUS --by NAME [--note TEXT]
        STATUS: confirmed | rejected | excluded   (writes the decision into facts.src.yaml
        so it survives rebuilds, then rebuilds facts.json and review.md)

review.md is generated — do not edit it by hand.
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from factlib import load_raw, unit_index  # noqa: E402
from validate import validate  # noqa: E402

GROUPS = [
    ("A", "修正建议（确认后才会生效）", lambda f: (f.get("review") or {}).get("proposed")),
    ("B", "待补充或待澄清（原文缺值、缺单位、表述存疑）", lambda f: f["origin"] == "pptx" and not f["review"].get("proposed")),
    ("C", "从图片读出的数据（机器无法回读原文，必须人工核对）", lambda f: f["origin"] == "image"),
    ("D", "推断的日期（用于排序和绘图；回答中会注明“推断”）", lambda f: f["origin"] == "inferred"),
]


def fmt_proposed(p):
    if not p:
        return ""
    if p.get("exclude"):
        return "删除此项"
    return "；".join(f"{k} → {v}" for k, v in p.items())


def where(f, units):
    loc = f.get("loc") or {}
    if "unit" in loc:
        return f"第{loc['slide']}页 · “{units[loc['unit']][1][:30]}…”" if len(units[loc["unit"]][1]) > 30 \
            else f"第{loc['slide']}页 · “{units[loc['unit']][1]}”"
    if "image" in loc:
        return f"第{loc['slide']}页 · 图片 {loc['image']}"
    return "—"


def generate(case_dir):
    case_dir = Path(case_dir)
    facts = json.loads((case_dir / "facts.json").read_text(encoding="utf-8"))["facts"]
    units = unit_index(load_raw(case_dir))
    rep, stats = validate(case_dir)
    reviewed = [f for f in facts if f.get("review")]
    open_ = [f for f in reviewed if f["review"]["status"] == "unreviewed"]
    implied = [f for f in facts if f.get("implied_unit")]

    out = ["# 案例1 数据校对清单", "",
           "> 本文件由 `pipeline/review.py` 根据 `facts.json` 自动生成，**请不要手工编辑**。",
           "> 审核方式：`python pipeline/review.py cases/case1 --set <事实id>=confirmed|rejected|excluded --by <审核人> [--note 说明]`",
           "",
           f"- 数据版本 `content_version`：`{stats.get('content_version')}`",
           f"- 质量门：{len(rep.errors)} 个错误，{len(rep.warnings)} 个警告；"
           f"原文单元遗漏 {stats.get('missing_units')} 个",
           f"- 审核项：共 {len(reviewed)} 项，**待审 {len(open_)} 项**",
           "",
           "运行规则：未确认的修正只会显示为“原文为 X，疑为 Y（未确认）”；图片读数显示“图读·未核对”标记；推断日期显示“约/推断”。",
           ""]
    for key, title, pred in GROUPS:
        rows = [f for f in reviewed if pred(f)]
        if not rows:
            continue
        out += [f"## {key}. {title}", "", "| 事实 id | 位置 | 原文 / 读数 | 问题 | 建议 | 依据 | 状态 |", "|---|---|---|---|---|---|---|"]
        for f in rows:
            r = f["review"]
            raw = f.get("raw") if f.get("raw") is not None else (f.get("parsed") or {}).get("value", "")
            status = r["status"] + (f"（{r['by']} {r['at']}）" if r.get("by") else "")
            cells = [f"`{f['id']}`", where(f, units), str(raw), r.get("issue") or "", fmt_proposed(r.get("proposed")),
                     r.get("basis") or f.get("note") or "", status]
            out.append("| " + " | ".join(c.replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
        out.append("")

    out += ["## E. 单位推定（原文同一处已写明，直接采用；列出供抽查）", "",
            "| 事实 id | 原文 | 推定单位 | 依据 |", "|---|---|---|---|"]
    out += [f"| `{f['id']}` | {f['raw']} | {f['implied_unit']['unit']} | {f['implied_unit']['basis']} |" for f in implied]
    out += ["", "## F. 质量门警告（多为上述待审项引起的冲突）", ""]
    out += [f"- {w}" for w in rep.warnings] or ["- 无"]
    out += ["", "## G. 已排除的疑点（无需处理）", "",
            "- NGF-MRD 与 NGS-MRD 同时出现：两种不同的检测方法（二代流式 / 二代测序），分成两条序列展示，不互相计算。",
            "- 2025.09 的 SUVmax 来自 CXCR4 显像，与糖代谢 PET 的兼容键不同，系统禁止两者比较。",
            "- 分子结果（FISH、突变 VAF、BCMA）来自不同样本（初诊样本 / 右肩胛区组织 / 左上臂组织），只并列展示，不计算变化。",
            ""]
    (case_dir / "review.md").write_text("\n".join(out), encoding="utf-8")
    print(f"review.md: {len(reviewed)} items, {len(open_)} open")


def set_status(case_dir, assignment, by, note):
    fid, status = assignment.split("=", 1)
    if status not in ("confirmed", "rejected", "excluded"):
        sys.exit(f"bad status {status}")
    src_path = Path(case_dir) / "facts.src.yaml"
    src = yaml.safe_load(src_path.read_text(encoding="utf-8"))
    decisions = src.setdefault("decisions", {})
    decisions[fid] = {"status": status, "by": by, "at": dt.date.today().isoformat(), "note": note}
    # keep the authored file readable: rewrite only the decisions block at the end
    text = src_path.read_text(encoding="utf-8").split("\ndecisions:")[0].rstrip() + "\n\n"
    text += yaml.safe_dump({"decisions": decisions}, allow_unicode=True, sort_keys=True)
    src_path.write_text(text, encoding="utf-8")
    subprocess.run([sys.executable, str(Path(__file__).parent / "build_facts.py"), str(case_dir)], check=True)
    generate(case_dir)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?", default="cases/case1")
    ap.add_argument("--set")
    ap.add_argument("--by")
    ap.add_argument("--note", default="")
    a = ap.parse_args()
    if a.set:
        if not a.by:
            sys.exit("--by is required")
        set_status(a.case_dir, a.set, a.by, a.note)
    else:
        generate(a.case_dir)
