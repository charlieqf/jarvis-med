"""Live plan worker: compiles answer-plan steps one at a time for the streaming (slow) path.

Protocol: one JSON object per line on stdin, one JSON object per line on stdout.
  {"type": "hello"}                                   -> {"type": "ready", "content_version": ...}
  {"type": "step", "plan_id": "L1", "seq": 0, "step": {...}}
        -> {"type": "step_ok", "seq": 0, "step": {...compiled...}, "checks": [...]}
        |  {"type": "step_err", "seq": 0, "error": "..."}
  {"type": "not_in_source", "nearest": [anchor...]}   -> {"type": "nis_ok", "nearest": [...]} | {"type": "nis_err", ...}

The same rules as the offline compiler apply (DESIGN §6.2): numbers only from facts,
computed changes, no causal wording outside quotes, anchors must exist.

Usage: python pipeline/plan_worker.py cases/case1
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compile_tours import CompileError, Ctx  # noqa: E402
from factlib import content_version  # noqa: E402


def main(case_dir):
    case_dir = Path(case_dir)
    ctx = Ctx(case_dir)
    version = content_version(case_dir / "facts.json", case_dir / "views.json")
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            out.write(json.dumps({"type": "error", "error": f"bad json: {e}"}, ensure_ascii=False) + "\n")
            out.flush()
            continue
        t = msg.get("type")
        if t == "hello":
            res = {"type": "ready", "content_version": version}
        elif t == "step":
            try:
                step, checks = ctx.compile_step(msg["step"], msg["seq"], msg.get("plan_id", "L"))
                res = {"type": "step_ok", "seq": msg["seq"], "step": step, "checks": checks}
            except CompileError as e:
                res = {"type": "step_err", "seq": msg["seq"], "error": str(e)}
            except Exception as e:  # malformed step from the model
                res = {"type": "step_err", "seq": msg["seq"], "error": f"{type(e).__name__}: {e}"}
        elif t == "not_in_source":
            bad = [a for a in msg.get("nearest", []) if a not in ctx.anchors and a not in ctx.units]
            res = {"type": "nis_err", "error": f"unknown anchors {bad}"} if bad else {"type": "nis_ok", "nearest": msg.get("nearest", [])}
        else:
            res = {"type": "error", "error": f"unknown message type {t}"}
        out.write(json.dumps(res, ensure_ascii=False) + "\n")
        out.flush()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    main(sys.argv[1] if len(sys.argv) > 1 else "cases/case1")
