"""Answer-plan compiler rules (DESIGN §6.2): what the agent is NOT allowed to say."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from compile_tours import CompileError, Ctx, pretty_checked  # noqa: E402


@pytest.fixture(scope="module")
def ctx():
    return Ctx(ROOT / "cases" / "case1")


def claim(ctx, c):
    return ctx.claim(c, "test.c0")


def test_value_placeholder_renders_source_text(ctx):
    out = claim(ctx, {"type": "value", "template": "M蛋白 {{f.mprot.2024-05-08}}"})
    assert out["text"] == "M蛋白 10.6412g/L" and out["cite"] == ["f.mprot.2024-05-08"]


def test_change_is_computed_by_code(ctx):
    out = claim(ctx, {"type": "change", "template": "SUVmax {{change:f.suv.scapula.2024-05-08,f.suv.scapula.2024-06-20}}"})
    assert "9.39 → 2.1" in out["text"] and "下降 77.6%" in out["text"]


@pytest.mark.parametrize("tpl, why", [
    ("{{change:f.spep_pct.2026-01,f.spep_pct.2026-08-24}}", "bound value (<0.1%) cannot be used in a change"),
    ("{{change:f.suv.scapula.2024-05-08,f.suv.breast.2025-09}}", "CXCR4 vs glucose PET, different site"),
    ("{{change:f.ngs.img.1,f.ngs.pre_asct.text}}", "unconfirmed correction"),
    ("{{change:f.mut.igll5.2023-06,f.mut.igll5.2026-01}}", "different specimens"),
    ("{{change:f.mprot.2024-06-20,f.mprot.2024-12-10}}", "negative result is not a number"),
])
def test_forbidden_changes(ctx, tpl, why):
    with pytest.raises(CompileError):
        claim(ctx, {"type": "change", "template": tpl})


def test_number_outside_placeholder_rejected(ctx):
    with pytest.raises(CompileError, match="number"):
        claim(ctx, {"type": "value", "template": "M蛋白约 10 g/L：{{f.mprot.2024-05-08}}"})


def test_causal_word_rejected(ctx):
    with pytest.raises(CompileError, match="causal"):
        claim(ctx, {"type": "value", "template": "{{f.site.emd1}} 导致 M蛋白 {{f.mprot.2024-05-08}}"})


def test_entity_not_in_cited_facts_rejected(ctx):
    with pytest.raises(CompileError, match="entity"):
        claim(ctx, {"type": "value", "template": "PET 显示 M蛋白 {{f.mprot.2024-05-08}}"})


def test_quote_must_be_source_text(ctx):
    with pytest.raises(CompileError):
        claim(ctx, {"type": "quote", "fact": "f.mprot.2024-05-08"})
    assert claim(ctx, {"type": "quote", "fact": "u.21.7.p1"})["verbatim"]


def test_pending_correction_is_shown_as_unconfirmed(ctx):
    out = claim(ctx, {"type": "value", "template": "CRS {{date:f.crs.grade}}"})
    assert "2025.05.23" in out["text"] and "未确认" in out["text"] and "pending_review" in out["flags"]


def test_display_formatting_never_changes_digits():
    assert pretty_checked("约5*7cm") == "约5×7cm"
    assert pretty_checked("1.46E-01") == "1.46×10⁻¹"
    assert pretty_checked("30mg/m^{2} d1-3") == "30mg/m² d1-3"


def test_unknown_anchor_rejected(ctx):
    with pytest.raises(CompileError, match="unknown anchor"):
        ctx.action({"op": "spotlight", "targets": ["b.nope"]}, "test")


def test_point_pulse_needs_plotted_point(ctx):
    with pytest.raises(CompileError):
        ctx.action({"op": "pointPulse", "targets": ["f.pt.age"]}, "test")
