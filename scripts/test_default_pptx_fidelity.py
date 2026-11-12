#!/usr/bin/env python3
"""Regression: a plain PPT model exports a stable editable deck without custom scripts."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from pptx import Presentation
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build_html_report_from_model.py"
EXPORTER = ROOT / "scripts" / "export_html_report.py"
TEMPLATE = ROOT / "assets" / "template" / "html-report-ppt-base.html"
FIXTURE = ROOT / "fixtures" / "default-pptx-fidelity.json"


def load_exporter():
    spec = importlib.util.spec_from_file_location("html_report_exporter", EXPORTER)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_plain_model_exports_native_fidelity_objects() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        html = tmp_path / "index.html"
        build = subprocess.run(
            [sys.executable, str(BUILDER), str(FIXTURE), "--template", str(TEMPLATE), "--out", str(html)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        assert_true(build.returncode == 0, build.stderr or build.stdout)

        deck = load_exporter().extract_deck_json(html)
        objects = {item["name"]: item for item in deck["slides"][0]["objects"]}
        title = objects["quality-title"]
        assert_true(title.get("textStyle", {}).get("fontSizePt", 0) > 0, "DOM text must receive explicit PPT point metrics")
        assert_true(title["textStyle"].get("wrap") is True, "DOM text must receive an explicit wrapping policy")
        footer = objects["quality-footer"]
        page_number = objects["quality-page"]
        assert_true(footer["frame"]["w"] >= 180 and footer["textStyle"].get("wrap") is False, "footer must export as a stable single line")
        assert_true(page_number["frame"]["w"] >= 40 and page_number["textStyle"].get("wrap") is False, "page number must export as a stable single line")
        chart = objects["quality-chart"]
        assert_true(chart.get("chartType") == "bar", "a single-series ECharts bar chart must map to a native bar chart")
        assert_true(chart.get("series", [{}])[0].get("values") == [18, 42, 31], "chart values must remain editable data")

        exported = subprocess.run(
            [sys.executable, str(EXPORTER), str(html), "--out-dir", str(tmp_path), "--formats", "pptx"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        assert_true(exported.returncode == 0, exported.stderr or exported.stdout)
        pptx = tmp_path / "index.pptx"
        with zipfile.ZipFile(pptx) as archive:
            names = archive.namelist()
            slide_xml = archive.read("ppt/slides/slide1.xml").decode("utf-8")
            assert_true("<a:tbl" in slide_xml, "HTML table must export as a native PowerPoint table")
            assert_true("图表未嵌入" not in slide_xml, "native chart mapping must not fall back to a placeholder")
            assert_true(any(name.startswith("ppt/charts/chart") for name in names), "PPTX must contain a native editable chart part")
            assert_true(any(name.startswith("ppt/media/") for name in names), "SVG data images must be rasterized into PPTX media")

        presentation = Presentation(pptx)
        table = next(shape.table for shape in presentation.slides[0].shapes if shape.name == "quality-table")
        for row in table.rows:
            for cell in row.cells:
                assert_true(cell.vertical_anchor == MSO_ANCHOR.MIDDLE, "table cells must default to vertical center")
                assert_true(cell.text_frame.paragraphs[0].alignment == PP_ALIGN.CENTER, "table cells must default to horizontal center")


def main() -> int:
    test_plain_model_exports_native_fidelity_objects()
    print("[OK] plain PPT model exports stable editable native objects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
