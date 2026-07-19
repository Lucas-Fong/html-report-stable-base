#!/usr/bin/env python3
"""Regression checks for editable JSON-based PPTX export."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import zipfile
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "export_html_report.py"
TEMPLATE = ROOT / "assets" / "template" / "html-report-ppt-base.html"


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_template_has_json_contract() -> None:
    html = TEMPLATE.read_text(encoding="utf-8")
    for forbidden in ("#6f1022", "#4b0a17", "#9a2335", "rgba(111,16,34", "radial-gradient"):
        assert_true(forbidden not in html.lower(), f"PPT template must not retain the old red visual system: {forbidden}")
    assert_true("--wine: #2f6f68" in html, "PPT template must use the quiet teal accent")
    assert_true(".cover, .thanks" in html and "background: #ffffff;" in html, "cover and closing slides must use the simple light treatment")
    assert_true("html-pptx-data" in html, "template must embed html-pptx-data JSON")
    assert_true("syncDeckJsonFromDom" in html, "template must sync DOM edits into JSON")
    assert_true("downloadPptxJson" in html, "template must expose PPTX JSON download")
    assert_true('pptRole": "footer"' in html, "template must mark footers for PPTX export")
    assert_true('pptRole": "pageNumber"' in html, "template must mark page numbers for PPTX export")
    assert_true("data-pptx-name=\"overview-footer\"" in html, "visible footer must be mapped to PPTX JSON")
    assert_true("data-pptx-name=\"overview-page-number\"" in html, "visible page number must be mapped to PPTX JSON")
    assert_true("pptRole = 'header'" in html, "DOM sync must classify headers as fixed PPTX text")
    assert_true("pptRole = 'footer'" in html, "DOM sync must classify footers as fixed PPTX text")
    assert_true("pptRole = 'pageNumber'" in html, "DOM sync must classify page numbers as fixed PPTX text")
    assert_true('data-ppt-level="h1"' in html, "template must explicitly mark H1 editable boxes")
    assert_true("insertPlainText" in html, "editable paste must strip rich text styles")
    assert_true('[data-ppt-level=\"h1\"] *' in html, "H1 descendants must inherit H1 typography")
    assert_true('font-size: var(--h4-size)' in html, "subtitle text must use H4 typography")
    assert_true('else if (element.matches(\'h4, .subtitle\')) obj.pptLevel = \'h4\'' in html, "DOM sync must classify subtitles as H4")
    assert_true('"name": "overview-subtitle", "x": 56, "y": 140, "w": 1120, "h": 44, "text": "生成报告时优先复用这套底座，保证后续 HTML PPT 的导航、画布、抽屉、编辑体验和导出逻辑一致。", "fontSize": 16, "pptLevel": "h4"' in html, "embedded JSON must mark overview subtitle as H4")
    assert_true('data-pptx-name="metric-1-value" data-ppt-level="metric"' in html, "metric text must use the independent metric level")
    assert_true('data-pptx-name="metric-1-label" data-ppt-level="body"' in html, "metric labels must remain body typography")
    assert_true('data-pptx-name="metric-1-body" data-ppt-level="body"' in html, "metric descriptions must remain body typography")
    assert_true("document.querySelectorAll('.editable').forEach(element =>" in html, "typography labels must cover all editable content text")
    assert_true('class="kicker" data-pptx-name="overview-kicker"' in html, "page headers/kickers must not be editable")
    assert_true('class="editable editable-box kicker"' not in html, "page headers/kickers must not use editable boxes")
    assert_true("rightSideLeft = rect.right + 4" in html, "typography labels must prefer the right side of text boxes")
    assert_true("font-size: 10px" in html, "typography labels must use compact styling")
    assert_true("element.matches('[data-ppt-level=\"metric\"], .metric .value, .metric strong')" in html and "obj.pptLevel = 'metric'" in html, "DOM sync must classify only metric values as metric")
    assert_true('id="navStyleControl"' in html, "drawer must include navigation style controls")
    assert_true('data-nav-style="hidden"' in html, "navigation style controls must include hidden mode")
    assert_true('data-nav-style="dots"' in html, "navigation style controls must include dots mode")
    assert_true('data-nav-style="numbered"' in html, "navigation style controls must include numbered mode")
    assert_true("function setNavStyle(nextStyle)" in html, "navigation style controls must switch nav modes")
    assert_true("padding: 36px 56px 18px 56px;" in html, "slide left and right padding must be equal")
    assert_true('id="drawerToggle" type="button" aria-label="打开样式设置" title="样式设置">⚙</button>' in html, "drawer toggle must be a compact gear icon")
    assert_true("width: 36px;" in html and "height: 36px;" in html, "drawer toggle must be a small square icon button")
    assert_true(">样式设置</button>" not in html, "drawer toggle must not be a text pill button")
    assert_true('class="cover-stage"' in html, "cover page must use a vertically centered content group")
    assert_true("left: 56px;" in html and "transform: translateY(-50%);" in html, "cover title group must sit on the left content margin")
    assert_true('data-pptx-name="cover-title" data-ppt-level="h1" style="width:760px;text-align:left;"' in html, "cover title must be left-aligned inside the cover group")
    assert_true('data-pptx-name="cover-subtitle" style="color:#667085;width:760px;text-align:left;"' in html, "cover subtitle must be left-aligned inside the cover group")
    assert_true('"name": "cover-title", "x": 56, "y": 319, "w": 760, "h": 132' in html, "embedded JSON must place the cover title on the left margin")
    assert_true('"name": "cover-title", "x": 56, "y": 319, "w": 760, "h": 132, "text": "HTML Report\\n稳定底座", "fontSize": 60, "pptLevel": "h1", "align": "left"' in html, "cover title must export with left alignment")
    assert_true('"name": "cover-subtitle", "x": 56, "y": 465, "w": 760, "h": 58' in html and '"align": "left", "color": "#667085"' in html, "embedded JSON must left-align the cover subtitle")
    assert_true('class="center-stage"' in html, "thanks page must use a centered title group")
    assert_true('data-pptx-name="thanks-title" data-ppt-level="h1" style="width:720px;text-align:center;"' in html, "thanks title must be centered inside the centered group")
    assert_true('data-pptx-name="thanks-subtitle" style="color:#667085;width:520px;text-align:center;"' in html, "thanks subtitle must be centered inside the centered group")
    assert_true('"name": "thanks-title", "x": 360, "y": 341, "w": 720, "h": 84, "text": "THANK YOU.", "fontSize": 60, "pptLevel": "h1", "align": "center"' in html, "embedded JSON must center the thanks title group vertically")
    assert_true('"name": "thanks-subtitle", "x": 460, "y": 437, "w": 520, "h": 36, "text": "HTML Report", "fontSize": 16, "pptLevel": "h4", "align": "center"' in html, "embedded JSON must center the thanks subtitle under the title")
    assert_true("async function downloadStandaloneHtml(" in html, "standalone HTML download must be able to inline external scripts before saving")
    assert_true("inlineExternalScriptsForStandalone(clone)" in html, "standalone HTML download must inline ECharts and other local scripts")
    assert_true("await fetch(script.src)" in html, "standalone HTML download must fetch script sources for inlining")
    assert_true("navClone.innerHTML = ''" in html, "standalone HTML download must clear runtime-generated nav buttons before saving")
    assert_true("drawerClone.setAttribute('hidden', '')" in html, "standalone HTML download must hide the right-side drawer")
    assert_true("drawerToggleClone.setAttribute('hidden', '')" in html, "standalone HTML download must hide the drawer gear toggle")
    assert_true("bodyClone?.classList.add('standalone-export')" in html, "standalone HTML download must mark the file as a delivery version")
    assert_true('script data-inline-asset="assets/echarts.min.js"' in html, "template must embed ECharts for browser-side standalone HTML export")
    assert_true('<script src="assets/echarts.min.js"></script>' not in html, "template must not depend on an external ECharts script")
    assert_true("'<!doctype html>\\n' + clone.outerHTML" in html, "browser standalone HTML export must use a real newline after doctype")
    assert_true("'<!doctype html>\\\\n' + clone.outerHTML" not in html, "browser standalone HTML export must not write visible backslash-n text")


def test_pptx_requires_json_contract() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "plain.html"
        html.write_text("<body data-report-mode='ppt'><main id='deck'><section class='slide'>No JSON</section></main></body>", encoding="utf-8")
        result = run(str(html), "--formats", "pptx", "--out-dir", tmp)
        assert_true(result.returncode != 0, "PPTX export without JSON must fail")
        assert_true("html-pptx-data" in (result.stderr + result.stdout), "failure must mention missing JSON contract")


def test_json_exports_editable_table_and_chart() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "deck.html"
        html.write_text(
            """
<!doctype html><html><body data-report-mode="ppt">
<script id="html-pptx-data" type="application/json">
{
  "meta": {"width": 1440, "height": 810, "fontFamily": "\\"Microsoft YaHei\\", \\"微软雅黑\\", Arial, sans-serif"},
  "slides": [{
    "title": "Test",
    "objects": [
      {"type": "text", "name": "title", "x": 80, "y": 60, "w": 600, "h": 60, "text": "Editable title", "fontSize": 34, "pptLevel": "h2", "bold": true, "color": "#111827"},
      {"type": "text", "name": "metric", "x": 80, "y": 95, "w": 600, "h": 40, "text": "Metric", "fontSize": 34, "pptLevel": "metric", "bold": true, "color": "#111827"},
      {"type": "text", "name": "body", "x": 80, "y": 120, "w": 600, "h": 40, "text": "Body copy", "fontSize": 20, "pptLevel": "body", "color": "#111827"},
      {"type": "shape", "name": "box", "shape": "roundRect", "x": 80, "y": 140, "w": 180, "h": 90, "fill": "#2563eb", "line": "none", "radius": 8},
      {"type": "table", "name": "table", "x": 80, "y": 270, "w": 620, "h": 190, "columns": ["A", "B"], "rows": [["One", "Two"], ["Three", "Four"]]},
      {"type": "chart", "name": "chart", "chartType": "bar", "x": 780, "y": 220, "w": 480, "h": 300, "categories": ["P1", "P2"], "series": [{"name": "A", "type": "bar", "values": [12, 24], "color": "#6f1022"}, {"name": "B", "type": "line", "values": [18, 30], "color": "#c9a15b"}]}
    ]
  }]
}
</script>
</body></html>
{"leaked": "json"}
""",
            encoding="utf-8",
        )
        result = run(str(html), "--formats", "pptx", "--out-dir", tmp)
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        pptx = Path(tmp) / "deck.pptx"
        assert_true(pptx.exists(), "editable PPTX was not created")
        with zipfile.ZipFile(pptx) as archive:
            names = archive.namelist()
            assert_true(not any(name.startswith("ppt/media/") for name in names), "PPTX must not contain screenshot media")
            slide_xml = archive.read("ppt/slides/slide1.xml").decode("utf-8")
            assert_true("<a:tbl" in slide_xml, "PPTX must contain a native table")
            assert_true("<c:chart" in slide_xml, "PPTX must contain a native chart")
            assert_true("sans-serif" not in slide_xml, "PPTX must not write CSS font stacks as font names")
            assert_true("Microsoft YaHei" in slide_xml, "PPTX should use the first concrete CSS font family")
            assert_true('sz="2800"' in slide_xml, "H2 must export as 28pt in PPTX")
            assert_true('sz="3400"' in slide_xml, "metric typography must preserve its independent font size in PPTX")
            assert_true('sz="1400"' in slide_xml, "Body text must export as 14pt in PPTX")
            assert_true("Metric" in slide_xml, "metric-level text must be exported")
            chart_xml = "\n".join(
                archive.read(name).decode("utf-8")
                for name in names
                if name.startswith("ppt/charts/chart") and name.endswith(".xml")
            )
            assert_true("<c:barChart>" in chart_xml, "mixed chart must keep bar series as bar chart")
            assert_true("<c:lineChart>" in chart_xml, "mixed chart must keep line series as line chart")
            assert_true("6F1022" in chart_xml.upper(), "bar series color must be written to chart XML")
            assert_true("C9A15B" in chart_xml.upper(), "line series color must be written to chart XML")


def test_fixed_header_footer_page_number_fonts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "deck.html"
        html.write_text(
            """
<!doctype html><html><body data-report-mode="ppt">
<script id="html-pptx-data" type="application/json">
{
  "meta": {"width": 1440, "height": 810, "fontFamily": "Microsoft YaHei"},
  "slides": [{
    "title": "Fixed text",
    "objects": [
      {"type": "text", "name": "header", "x": 56, "y": 36, "w": 320, "h": 26, "text": "Header", "fontSize": 44, "pptLevel": "h1", "pptRole": "header", "bold": true, "color": "#6f1022"},
      {"type": "text", "name": "footer", "x": 56, "y": 760, "w": 220, "h": 18, "text": "Footer", "fontSize": 44, "pptLevel": "h1", "pptRole": "footer", "color": "#8b7e78"},
      {"type": "text", "name": "page-number", "x": 1260, "y": 760, "w": 80, "h": 18, "text": "01", "fontSize": 44, "pptLevel": "h1", "pptRole": "pageNumber", "bold": true, "color": "#8b7e78"}
    ]
  }]
}
</script>
</body></html>
""",
            encoding="utf-8",
        )
        result = run(str(html), "--formats", "pptx", "--out-dir", tmp)
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        with zipfile.ZipFile(Path(tmp) / "deck.pptx") as archive:
            slide_xml = archive.read("ppt/slides/slide1.xml").decode("utf-8")
            assert_true("Header" in slide_xml, "header must be exported")
            assert_true("Footer" in slide_xml, "footer must be exported")
            assert_true(">01<" in slide_xml, "page number must be exported")
            assert_true('sz="1200"' in slide_xml, "header/footer/page number roles must export as fixed 12pt")
            assert_true('sz="6000"' not in slide_xml, "fixed roles must not inherit H1 PPTX font size")


def test_standalone_html_export_inlines_scripts_and_cleans_runtime_state() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        assets = root / "assets"
        assets.mkdir()
        (assets / "echarts.min.js").write_text("window.echarts = { init() {} };", encoding="utf-8")
        html = root / "deck.html"
        html.write_text(
            """
<!doctype html><html><head></head>
<body data-report-mode="ppt" class="ppt-mode nav-hidden drawer-open edit-mode">
<nav class="nav" id="nav"><button>01</button><button>02</button></nav>
<button class="drawer-toggle" id="drawerToggle">⚙</button>
<aside class="style-drawer open" id="styleDrawer"><div class="drawer-body">Drawer</div></aside>
<div class="typography-label-layer" id="typographyLabelLayer"><span>H1</span></div>
<main class="deck" id="deck"><section class="slide active-slide"><h1 class="editable selected-box" style="font-family:CustomFont;font-size:42px" contenteditable="true" data-typography-label="H1">Title</h1></section></main>
<script src="assets/echarts.min.js"></script>
<script>setNavStyle('numbered');</script>
</body></html>
""",
            encoding="utf-8",
        )
        result = run(str(html), "--formats", "html", "--out-dir", str(root / "exports"))
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        exported = (root / "exports" / "deck_single.html").read_text(encoding="utf-8")
        assert_true(exported.rstrip().endswith("</html>"), "standalone HTML must not keep text after </html>")
        assert_true('{"leaked": "json"}' not in exported, "standalone HTML must strip leaked text after </html>")
        assert_true("<script src=" not in exported, "standalone HTML must not keep external local script tags")
        assert_true("window.echarts = { init() {} };" in exported, "standalone HTML must inline local scripts")
        assert_true(re.search(r'<nav[^>]+id=["\']nav["\'][^>]*>\s*</nav>', exported) is not None, "standalone HTML must clear serialized runtime nav buttons")
        assert_true("standalone-export" in exported, "standalone HTML must be marked as a delivery version")
        assert_true("nav-hidden" in exported, "standalone HTML must preserve the user's current navigation visibility setting")
        assert_true("setNavStyle('hidden');" in exported, "standalone HTML must initialize with the user's current navigation setting")
        assert_true("setNavStyle('numbered');" not in exported, "standalone HTML must not reset hidden navigation to numbered")
        assert_true("CustomFont" in exported and "font-size:42px" in exported, "standalone HTML must preserve user-edited typography state")
        assert_true("style-drawer" in exported and "id=\"styleDrawer\"" in exported, "standalone HTML may keep drawer markup for script safety")
        assert_true("drawer-toggle" in exported and "id=\"drawerToggle\"" in exported, "standalone HTML may keep drawer toggle markup for script safety")
        assert_true(re.search(r'<button[^>]+id=["\']drawerToggle["\'][^>]*\bhidden\b', exported) is not None, "standalone HTML must hide the drawer gear toggle")
        assert_true(re.search(r'<aside[^>]+id=["\']styleDrawer["\'][^>]*\bhidden\b', exported) is not None, "standalone HTML must hide the right-side drawer")
        assert_true("body.standalone-export .drawer-toggle" in exported, "standalone HTML must include CSS that hides the drawer gear toggle")
        assert_true("body.standalone-export .style-drawer" in exported, "standalone HTML must include CSS that hides the right-side drawer")
        assert_true(not re.search(r'<body[^>]*\bdrawer-open\b', exported), "standalone HTML must not persist drawer-open body state")
        assert_true(not re.search(r'<body[^>]*\bedit-mode\b', exported), "standalone HTML must not persist edit-mode body state")
        assert_true(not re.search(r'<aside[^>]*\bopen\b', exported), "standalone HTML must not persist open drawer state")
        assert_true("contenteditable" not in exported, "standalone HTML must remove contenteditable state")
        assert_true("selected-box" not in exported, "standalone HTML must remove selected box state")
        assert_true("data-typography-label" not in exported, "standalone HTML must remove typography label state")


def main() -> int:
    tests = [
        test_template_has_json_contract,
        test_pptx_requires_json_contract,
        test_json_exports_editable_table_and_chart,
        test_fixed_header_footer_page_number_fonts,
        test_standalone_html_export_inlines_scripts_and_cleans_runtime_state,
    ]
    for test in tests:
        test()
        print(f"[OK] {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
