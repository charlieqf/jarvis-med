#!/usr/bin/env bash
# Full pipeline for one case, in dependency order. Usage: scripts/build.sh [cases/case1]
set -euo pipefail
CASE=${1:-cases/case1}
export PYTHONIOENCODING=utf-8
cd "$(dirname "$0")/.."
python pipeline/build_facts.py "$CASE"      # facts.src.yaml + raw -> facts.json
python pipeline/compile_tours.py "$CASE"    # plans -> tours (bound to content_version)
python pipeline/validate.py "$CASE"         # quality gates V1-V6
python pipeline/review.py "$CASE"           # regenerate review.md
python pipeline/compile_web.py "$CASE"      # bundle for the web app
python -m pytest tests -q
(cd web && npm run build)
