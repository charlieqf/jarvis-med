"""Mutation regression tests: every tampering must be caught by some quality gate.

Includes the three cases from the v0.1 review (value 10.6412 -> 999, negative -> positive,
source slide changed to another valid slide), which v0.1's coverage check let through.
"""
import copy
import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from factlib import effective  # noqa: E402
from validate import validate  # noqa: E402

CASE = ROOT / "cases" / "case1"


@pytest.fixture(scope="module")
def base():
    facts = json.loads((CASE / "facts.json").read_text(encoding="utf-8"))
    views = json.loads((CASE / "views.json").read_text(encoding="utf-8"))
    return facts, views


def fact(doc, fid):
    return next(f for f in doc["facts"] if f["id"] == fid)


def run(facts, views, **kw):
    rep, _ = validate(CASE, facts, views, **kw)
    return rep.errors


def test_baseline_is_clean(base):
    assert run(*base) == []


def mutate(base, fn):
    facts, views = copy.deepcopy(base[0]), copy.deepcopy(base[1])
    fn(facts, views)
    return run(facts, views)


def assert_caught(errors, gate):
    assert errors, "mutation was not detected"
    assert any(e.startswith(f"[{gate}]") for e in errors), errors


# ---- the three cases from the review ------------------------------------------------

def test_value_changed_in_parsed(base):
    def m(f, v):
        x = fact(f, "f.mprot.2024-05-08")
        x["parsed"]["value"] = 999
        x["parsed"]["canonical"]["value"] = 999
    assert_caught(mutate(base, m), "V3")


def test_value_changed_in_raw_and_parsed(base):
    def m(f, v):
        x = fact(f, "f.mprot.2024-05-08")
        x["raw"] = "999g/L"
        x["parsed"]["value"] = 999
        x["parsed"]["canonical"]["value"] = 999
    assert_caught(mutate(base, m), "V3")


def test_negative_to_positive(base):
    def m(f, v):
        x = fact(f, "f.ngs.2024-06-20.text")
        x["raw"] = "阳性"
    assert_caught(mutate(base, m), "V3")


def test_negative_kind_flipped(base):
    def m(f, v):
        fact(f, "f.mprot.2024-12-10")["kind"] = "qualitative"
    assert_caught(mutate(base, m), "V3")


def test_source_slide_changed_to_other_valid_slide(base):
    def m(f, v):
        fact(f, "f.mprot.2024-05-08")["loc"]["slide"] = 9
    assert_caught(mutate(base, m), "V3")


def test_source_unit_moved_consistently(base):
    def m(f, v):
        x = fact(f, "f.mprot.2024-05-08")
        x["loc"].update(slide=9, shape=18, para=1, unit="u.9.18.p1")
    assert_caught(mutate(base, m), "V3")


# ---- further tampering --------------------------------------------------------------

def test_comparator_dropped(base):
    def m(f, v):
        del fact(f, "f.flck.2023-06")["parsed"]["comparator"]
    assert_caught(mutate(base, m), "V3")


def test_unit_changed(base):
    def m(f, v):
        fact(f, "f.flcl.2023-06")["parsed"]["unit"] = "g/L"
    assert_caught(mutate(base, m), "V3")


def test_date_changed(base):
    def m(f, v):
        fact(f, "d.2023-12-19")["parsed"]["value"] = "2023-12-18"
    assert_caught(mutate(base, m), "V3")


def test_kappa_lambda_swapped(base):
    def m(f, v):
        fact(f, "f.flck.2024-05-08")["attrs"]["analyte"] = "游离轻链λ"
    assert_caught(mutate(base, m), "V3")


def test_ngf_ngs_method_swapped(base):
    def m(f, v):
        fact(f, "f.ngf.2023-10")["attrs"]["method"] = "NGS"
    assert_caught(mutate(base, m), "V3")


def test_literal_number_in_view_label(base):
    def m(f, v):
        v["blocks"][0]["label"] = "M蛋白 10.6"
    assert_caught(mutate(base, m), "V4")


def test_incompatible_point_in_series(base):
    def m(f, v):
        s = next(s for b in v["blocks"] for s in b.get("series", []) if s["id"] == "b.s.suv_scapula")
        s["points"].append({"fact": "f.suv.breast.2025-09"})  # CXCR4 vs glucose PET
    assert_caught(mutate(base, m), "V4")


def test_unit_view_removed_is_omission(base):
    def m(f, v):
        v["blocks"] = [b for b in v["blocks"] if b["id"] != "b.conclusion"]
    assert_caught(mutate(base, m), "V2")


def test_dangling_reference(base):
    def m(f, v):
        v["blocks"][0]["title"] = "u.99.1.p0"
    assert_caught(mutate(base, m), "V1")


def test_confirmed_without_reviewer(base):
    def m(f, v):
        fact(f, "f.gene.nars")["review"]["status"] = "confirmed"
    assert_caught(mutate(base, m), "V5")


def test_release_gate_blocks_open_reviews(base):
    assert_caught(run(copy.deepcopy(base[0]), copy.deepcopy(base[1]), release=True), "V5")


def test_stale_tour(tmp_path, base):
    case = tmp_path / "case"
    shutil.copytree(CASE, case, ignore=shutil.ignore_patterns("media", "slides", "source.pptx"))
    (case / "tours").mkdir(exist_ok=True)
    (case / "tours" / "t1.json").write_text(json.dumps({"content_version": "000000000000"}), encoding="utf-8")
    rep, _ = validate(case)
    assert_caught(rep.errors, "V6")


# ---- runtime rule: unreviewed proposals are never used as facts -----------------------

def test_unconfirmed_proposal_not_effective(base):
    x = copy.deepcopy(fact(base[0], "f.gene.nars"))
    assert effective(x)["text"] == "NARS" and effective(x)["pending"]
    x["review"].update(status="confirmed", by="reviewer", at="2026-09-29")
    assert effective(x)["text"] == "NRAS" and not effective(x)["pending"]


def test_unconfirmed_date_not_effective(base):
    d = copy.deepcopy(fact(base[0], "d.crs"))
    assert effective(d)["date"] == "2025-05-23"
    d["review"].update(status="confirmed", by="reviewer", at="2026-09-29")
    assert effective(d)["date"] == "2024-05-23"
