#!/usr/bin/env python3
"""Regression checks for the explicit PPTX JSON v2 contract."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build_html_report_from_model.py"
TEMPLATE = ROOT / "assets" / "template" / "html-report-ppt-base.html"


def build(model: dict) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        source = tmp_path / "model.json"
        output = tmp_path / "index.html"
        source.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(BUILDER), str(source), "--template", str(TEMPLATE), "--out", str(output)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def v2_model(objects: list[dict]) -> dict:
    return {
        "mode": "ppt",
        "pptxContractVersion": 2,
        "slides": [{
            "title": "合同",
            "html": '<h1 data-pptx-name="title" data-editable-element="text">Title</h1>',
            "objects": objects,
        }],
    }


def test_v2_rejects_missing_named_object() -> None:
    result = build(v2_model([]))
    assert_true(result.returncode != 0, "v2 model without title object must fail")
    assert_true("missing PPTX objects: title" in (result.stdout + result.stderr), result.stdout + result.stderr)


def test_v2_rejects_unbound_object() -> None:
    result = build(v2_model([{"name": "title", "type": "text"}, {"name": "orphan", "type": "text"}]))
    assert_true(result.returncode != 0, "v2 model with unbound object must fail")
    assert_true("unbound PPTX objects: orphan" in (result.stdout + result.stderr), result.stdout + result.stderr)


def test_v2_requires_object_type_and_frame() -> None:
    result = build(v2_model([{"name": "title", "type": "text"}]))
    assert_true(result.returncode != 0, "v2 text object without frame must fail")
    assert_true("must include frame" in (result.stdout + result.stderr), result.stdout + result.stderr)


def test_v2_accepts_complete_named_object() -> None:
    result = build(v2_model([{
        "name": "title",
        "type": "text",
        "frame": {"x": 56, "y": 80, "w": 640, "h": 64},
        "text": "Title",
        "textStyle": {"fontSizePt": 32, "lineHeightPt": 38, "wrap": True},
    }]))
    assert_true(result.returncode == 0, result.stdout + result.stderr)


def main() -> int:
    for test in (
        test_v2_rejects_missing_named_object,
        test_v2_rejects_unbound_object,
        test_v2_requires_object_type_and_frame,
        test_v2_accepts_complete_named_object,
    ):
        test()
        print(f"[OK] {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
