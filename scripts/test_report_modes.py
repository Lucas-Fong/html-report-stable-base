#!/usr/bin/env python3
"""Regression checks for HTML Report modes and editor contract."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from pptx import Presentation


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build_html_report_from_model.py"
CHECKER = ROOT / "scripts" / "check_html_report.py"
EXPORTER = ROOT / "scripts" / "export_html_report.py"
SINGLE_TEMPLATE = ROOT / "assets" / "template" / "html-report-single-base.html"
PPT_TEMPLATE = ROOT / "assets" / "template" / "html-report-ppt-base.html"
EDITOR_JS = ROOT / "assets" / "template" / "shared" / "report-editor.js"
EDITOR_CSS = ROOT / "assets" / "template" / "shared" / "report-editor.css"
PLUGIN_MANIFEST = ROOT / ".codex-plugin" / "plugin.json"
SINGLE_DEMO_FIXTURE = ROOT / "fixtures" / "single-page-demo.json"


def run_builder(model: dict, template: Path, output: Path) -> subprocess.CompletedProcess[str]:
    model_path = output.with_suffix(".json")
    model_path.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(BUILDER), str(model_path), "--template", str(template), "--out", str(output)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_mode_is_required() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        result = run_builder(
            {"title": "Missing mode", "slides": [{"title": "One", "html": "<p>One</p>", "objects": []}]},
            PPT_TEMPLATE,
            Path(tmp) / "index.html",
        )
        assert_true(result.returncode != 0, "builder must reject a model without mode")
        message = result.stdout + result.stderr
        assert_true("can't open file" not in message, "builder entrypoint must exist before mode validation can be tested")
        assert_true("model.mode" in message.lower(), "missing-mode error must mention model.mode confirmation")


def test_single_page_contract() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "index.html"
        result = run_builder(
            {
                "mode": "single-page",
                "title": "Long report",
                "sections": [
                    {"id": "intro", "title": "超过六个字的章节标题", "html": '<h1 data-editable-element="text">Intro</h1>'},
                    {"id": "data", "title": "数据", "html": '<p data-editable-element="text">Body</p>'},
                ],
            },
            SINGLE_TEMPLATE,
            output,
        )
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        html = output.read_text(encoding="utf-8")
        assert_true('data-report-mode="single-page"' in html, "single-page output must declare its mode")
        assert_true("html-pptx-data" not in html, "single-page output must not contain PPTX JSON")
        assert_true('id="exportPpt"' not in html and 'id="printPdf"' not in html, "single-page output must not expose PPT/PDF controls")
        assert_true('id="nav"' not in html, "single-page output must not contain PPT navigation")
        assert_true('id="sectionNav"' in html, "single-page output must expose section navigation")
        assert_true('id="sectionNavStyleControl"' in html, "single-page drawer must expose section navigation controls")
        for style in ("hidden", "left", "right"):
            assert_true(f'data-section-nav-style="{style}"' in html, f"single-page navigation must support {style}")
        assert_true('class="single-page-mode section-nav-right"' in html, "single-page navigation must default to right")
        assert_true('id="downloadHtml"' in html, "single-page output must keep standalone HTML export")
        assert_true('<script src="shared/report-editor.js"' not in html, "generated output must inline the shared editor")
        checked = subprocess.run([sys.executable, str(CHECKER), str(output)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        assert_true(checked.returncode == 0, checked.stderr or checked.stdout)
        rejected = subprocess.run([sys.executable, str(EXPORTER), str(output), "--formats", "pptx"], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        assert_true(rejected.returncode != 0 and "only supports" in (rejected.stdout + rejected.stderr), "single-page mode must reject PPTX export")


def test_single_page_nav_is_readable_and_theme_bound() -> None:
    html = SINGLE_TEMPLATE.read_text(encoding="utf-8")
    assert_true("--section-nav-width: 112px;" in html, "single-page nav must use a readable five-to-six-character side index width")
    assert_true("body.section-nav-right .report" in html, "single-page nav must reserve enough room to avoid covering the report")
    assert_true("body.drawer-open.section-nav-right .section-nav { right: calc(var(--drawer-width) + 16px); }" in html, "right nav must sit beside the drawer")
    assert_true("body.section-nav-right .section-nav { display: grid; gap: 6px; right: 16px; }" in html, "right nav must use normal side-card spacing")
    assert_true(".section-nav {\n      position: fixed;" in html and "background: color-mix(in srgb, var(--paper) 92%, transparent);" in html, "single-page nav container must use a normal theme-bound card background")
    assert_true(".section-nav a" in html and "border-radius: 6px;" in html and "font: 12px/1.35 Arial, sans-serif;" in html, "single-page nav items must use normal readable rows")
    assert_true(".section-nav a.active { background: color-mix(in srgb, var(--accent) 12%, var(--paper)); color: var(--accent);" in html, "active nav state must follow accent color")
    assert_true(".demo-chart { width: 100%; max-width: 100%;" in html and "overflow: hidden;" in html, "single-page charts must stay inside the report column")
    assert_true(".style-drawer { position: fixed;" in html and "background: color-mix(in srgb, var(--paper) 96%, var(--surface));" in html, "drawer must follow report theme")
    assert_true(".drawer-body { min-height: 0; overflow-y: auto; padding: 12px 16px;" in html, "drawer spacing must be compact")
    assert_true("<h3>HTML Builder</h3>" in html and 'aria-label="HTML Builder 设置"' in html, "drawer title must use HTML Builder naming")


def test_single_page_demo_fixture_builds() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "demo.html"
        result = subprocess.run(
            [sys.executable, str(BUILDER), str(SINGLE_DEMO_FIXTURE), "--template", str(SINGLE_TEMPLATE), "--out", str(output)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        html = output.read_text(encoding="utf-8")
        assert_true("HTML Builder Single Page Demo" in html, "demo fixture must keep the presentation title")
        assert_true("Aurora Air AI 可见度月报" in html, "demo fixture must include the demo report content")
        assert_true(html.count('data-editable-element="chart"') >= 2, "demo fixture must include editable charts")


def test_ppt_contract_remains_available() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "index.html"
        result = run_builder(
            {
                "mode": "ppt",
                "title": "Deck",
                "slides": [{"title": "One", "html": '<h1 data-pptx-name="title">One</h1>', "objects": []}],
            },
            PPT_TEMPLATE,
            output,
        )
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        html = output.read_text(encoding="utf-8")
        assert_true('data-report-mode="ppt"' in html, "PPT output must declare its mode")
        assert_true("html-pptx-data" in html, "PPT output must keep PPTX JSON")
        assert_true('id="nav"' in html and 'id="exportPpt"' in html, "PPT output must keep navigation and PPT export")
        checked = subprocess.run([sys.executable, str(CHECKER), str(output)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        assert_true(checked.returncode == 0, checked.stderr or checked.stdout)


def test_ppt_export_syncs_missing_named_dom_objects() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        output = tmp_path / "index.html"
        result = run_builder(
            {
                "mode": "ppt",
                "title": "Deck",
                "slides": [
                    {
                        "title": "One",
                        "html": """
<h2 class="editable editable-box" data-editable-element="text" data-pptx-name="missing-title">Missing title should export</h2>
<div class="panel editable-box" data-editable-element="shape" data-pptx-name="missing-card">
  <h3 class="editable" data-editable-element="text" data-pptx-name="missing-heading">Missing heading should export</h3>
  <p class="editable" data-editable-element="text" data-pptx-name="missing-body">Missing body should export</p>
</div>
""",
                        "objects": [],
                    }
                ],
            },
            PPT_TEMPLATE,
            output,
        )
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        exported = subprocess.run(
            [
                sys.executable,
                str(EXPORTER),
                str(output),
                "--out-dir",
                str(tmp_path / "exports"),
                "--formats",
                "pptx",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        assert_true(exported.returncode == 0, exported.stderr or exported.stdout)
        pptx_path = tmp_path / "exports" / "index.pptx"
        prs = Presentation(pptx_path)
        exported_text = "\n".join(
            shape.text
            for slide in prs.slides
            for shape in slide.shapes
            if hasattr(shape, "text") and shape.text
        )
        assert_true("Missing title should export" in exported_text, "PPTX export must include missing named title text")
        assert_true("Missing heading should export" in exported_text, "PPTX export must include nested missing heading text")
        assert_true("Missing body should export" in exported_text, "PPTX export must include nested missing body text")


def test_ppt_export_syncs_unnamed_editable_dom_objects() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        output = tmp_path / "index.html"
        result = run_builder(
            {
                "mode": "ppt",
                "title": "Deck",
                "slides": [
                    {
                        "title": "One",
                        "html": """
<h2 class="editable editable-box" data-editable-element="text">Unnamed title should export</h2>
<div class="panel editable-box" data-editable-element="shape">
  <h3 class="editable" data-editable-element="text">Unnamed heading should export</h3>
  <ul>
    <li class="editable" data-editable-element="text">Unnamed bullet should export</li>
  </ul>
</div>
""",
                        "objects": [],
                    }
                ],
            },
            PPT_TEMPLATE,
            output,
        )
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        exported = subprocess.run(
            [
                sys.executable,
                str(EXPORTER),
                str(output),
                "--out-dir",
                str(tmp_path / "exports"),
                "--formats",
                "pptx",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        assert_true(exported.returncode == 0, exported.stderr or exported.stdout)
        pptx_path = tmp_path / "exports" / "index.pptx"
        prs = Presentation(pptx_path)
        exported_text = "\n".join(
            shape.text
            for slide in prs.slides
            for shape in slide.shapes
            if hasattr(shape, "text") and shape.text
        )
        assert_true("Unnamed title should export" in exported_text, "PPTX export must include unnamed title text")
        assert_true("Unnamed heading should export" in exported_text, "PPTX export must include unnamed heading text")
        assert_true("Unnamed bullet should export" in exported_text, "PPTX export must include unnamed bullet text")


def test_shared_editor_contract() -> None:
    source = EDITOR_JS.read_text(encoding="utf-8")
    for element_type in ("text", "shape", "chart", "image"):
        assert_true(element_type in source, f"shared editor must support {element_type}")
    for control in (
        "elementWidth",
        "elementHeight",
        "elementFontSize",
        "elementColor",
        "elementFontWeight",
        "elementTextAlign",
        "elementLineHeight",
        "elementBackground",
        "elementBorderColor",
        "elementBorderWidth",
        "elementBorderRadius",
    ):
        assert_true(control in source, f"shared editor must bind {control}")
    assert_true("selectedElement" in source, "editor must maintain exactly one current element selection")
    assert_true("getInstanceByDom" in source and ".resize()" in source, "chart size changes must resize ECharts")
    assert_true("currentStageScale" in source, "PPT element dimensions must convert through the current stage scale")
    for contract in ("setSectionNavStyle", "buildSectionNav", "shortSectionTitle", "typographyLevel", "refreshTypographyLabels"):
        assert_true(contract in source, f"shared editor must expose {contract}")
    assert_true("Array.from(String(title" in source and ".slice(0, 6)" in source, "single-page section nav labels must truncate by Unicode characters")
    for style in ("hidden", "left", "right"):
        assert_true(f"'{style}'" in source, f"single-page nav logic must support {style}")
    assert_true("window.syncDeckJsonFromDom?.();" in source, "instant PDF/PPTX export snapshots must sync PPT DOM changes first")
    assert_true("function prettyJsonForEditor(value)" in source, "chart JSON editor must format stored payloads")
    assert_true("if (stored) editor.value = prettyJsonForEditor(stored);" in source, "stored chart data must open as vertical JSON")
    assert_true("isSinglePageMode() && elementType(selectedElement) === 'chart'" in source, "single-page chart width edits must be clamped to the report column")


def test_preview_service_reuses_browser_for_exports() -> None:
    source = (ROOT / "scripts" / "start_html_report_preview.mjs").read_text(encoding="utf-8")
    assert_true("let browserPromise" in source, "preview service must keep a browser promise for repeated click exports")
    assert_true("chromium.launch" in source and "if (!browserPromise)" in source, "preview service must launch Chromium lazily and reuse it")
    assert_true("capturePptPdf" in source and "jpegImagesToPdf" in source, "preview service must export PPT PDFs without spawning the Python screenshot path")
    assert_true("captureSinglePage" in source, "preview service must export single-page PNG/PDF through the shared browser")
    assert_true("extractPptxData" in source and "--deck-json" in source, "preview service must reuse the submitted PPTX JSON instead of launching another browser sync")


def test_shared_accordion_contract() -> None:
    source = EDITOR_JS.read_text(encoding="utf-8")
    styles = EDITOR_CSS.read_text(encoding="utf-8")
    for contract in (
        "initAccordionGroups",
        "control-group-toggle",
        "control-group-content",
        "aria-expanded",
    ):
        assert_true(contract in source, f"shared editor must expose accordion contract: {contract}")
    assert_true("setAttribute('aria-expanded', 'false')" in source, "accordion groups must initialize collapsed")
    assert_true("content.hidden = true" in source, "accordion content must be hidden by default")
    assert_true("function accordionGroups()" in source, "accordion opening must use the shared group registry")
    assert_true(".drawer-repair > .control-group" in source, "accordion registry must include the fixed repair group")
    assert_true("setAccordionGroupOpen(otherGroup, false)" in source, "accordion opening must close other groups")
    assert_true("globalControlInitialized" in source, "global control listeners must be idempotent across editor initialization")
    assert_true("elementControlInitialized" in source and "documentClickBound" in source, "element and document listeners must be idempotent across editor initialization")
    assert_true("group.hidden" in source, "accordion must preserve element-control-group hidden state")
    assert_true(".control-group[hidden]" in styles, "hidden element control groups must remain hidden")
    assert_true(".control-group-content[hidden]" in styles, "collapsed accordion content must remain hidden")
    for template in (SINGLE_TEMPLATE, PPT_TEMPLATE):
        html = template.read_text(encoding="utf-8")
        assert_true('href="shared/report-editor.css"' in html, f"{template.name} must use shared editor CSS")
        assert_true('src="shared/report-editor.js"' in html, f"{template.name} must use shared editor JS")
        assert_true('class="drawer-body"' in html and 'class="control-group"' in html, f"{template.name} must expose drawer groups")


def test_ppt_drawer_accordion_groups_do_not_stretch() -> None:
    ppt = PPT_TEMPLATE.read_text(encoding="utf-8")
    assert_true("align-content: start" in ppt, "PPT drawer body must not stretch collapsed accordion groups")
    assert_true("grid-auto-rows: max-content" in ppt, "PPT drawer rows must size to content")
    assert_true("align-self: start" in ppt, "PPT drawer control groups must stay compact")


def test_metric_typography_is_a_seventh_global_level() -> None:
    single = SINGLE_TEMPLATE.read_text(encoding="utf-8")
    ppt = PPT_TEMPLATE.read_text(encoding="utf-8")
    for name, html in (("single-page", single), ("ppt", ppt)):
        assert_true("--metric-size:" in html, f"{name} template must define the metric typography level")
        assert_true('data-global-var="--metric-size"' in html, f"{name} drawer must expose metric size")
        assert_true("指标字号" in html, f"{name} drawer must name the metric size control")
        assert_true(".metric .value" in html and "font-size: var(--metric-size)" in html, f"{name} metric values must use metric size")
        assert_true(".metric .label" in html and "font-size: var(--body-size)" in html, f"{name} metric labels must remain body text")
    for level in ("'L1'", "'L2'", "'L3'", "'L4'", "'指标'", "'正文'", "'备注'"):
        assert_true(level in EDITOR_JS.read_text(encoding="utf-8"), f"single-page typography labels must include {level}")
    assert_true(".typography-label" in single, "single-page template must include visible typography labels")
    assert_true("element.matches('[data-ppt-level=\"metric\"], .metric .value, .metric strong')" in ppt, "PPT typography classification must only recognize metric values")
    assert_true("return '指标'" in ppt, "PPT edit labels must display the metric typography level")
    assert_true("obj.pptLevel = 'metric'" in ppt, "PPT DOM sync must export metric-card text as metric typography")


def test_plugin_bundles_chart_and_word_cloud_skills() -> None:
    manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
    assert_true(manifest["skills"] == "./skills/", "plugin manifest must expose the bundled skills directory")
    for skill_name in ("html-report-stable-base", "generate-word-clouds", "echarts-charts"):
        skill_dir = ROOT / "skills" / skill_name
        skill_file = skill_dir / "SKILL.md"
        assert_true(skill_file.exists(), f"plugin package must bundle {skill_name}/SKILL.md")
        source = skill_file.read_text(encoding="utf-8")
        assert_true(f"name: {skill_name}" in source, f"{skill_name} must keep its discoverable skill name")

    for relative_path in (
        "skills/generate-word-clouds/scripts/generate_word_clouds.mjs",
        "skills/generate-word-clouds/scripts/extract_xlsx.py",
        "skills/generate-word-clouds/references/confirmation.md",
        "skills/generate-word-clouds/references/brand_palettes.json",
        "skills/echarts-charts/scripts/render_echarts_html.mjs",
        "skills/echarts-charts/references/option-patterns.md",
        "skills/echarts-charts/references/official-links.md",
    ):
        assert_true((ROOT / relative_path).exists(), f"bundled helper is missing: {relative_path}")


def test_canonical_skill_and_plugin_names() -> None:
    root_skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
    wrapper = ROOT / "skills" / "html-report-stable-base" / "SKILL.md"
    assert_true("name: html-report-stable-base" in root_skill, "root skill must use the canonical name")
    assert_true(manifest["name"] == "html-report-stable-base", "plugin manifest must use the canonical name")
    assert_true(wrapper.exists(), "plugin must expose the canonical wrapper")
    assert_true("name: html-report-stable-base" in wrapper.read_text(encoding="utf-8"), "wrapper must use the canonical name")
    assert_true(not (ROOT / "skills" / "html-report").exists(), "legacy html-report wrapper must not remain")


def test_dependency_bootstrap_contract() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    dependencies = package.get("dependencies", {})
    assert_true("playwright" in dependencies, "Node Playwright must be a bundled dependency for browser QA and export")
    assert_true("sharp" in dependencies, "sharp must be a bundled dependency for word-cloud PNG generation")

    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    for requirement in ("playwright", "python-pptx", "pillow", "openpyxl"):
        assert_true(requirement in requirements.lower(), f"Python dependency must be listed: {requirement}")

    bootstrap = (ROOT / "scripts" / "bootstrap_html_report_deps.mjs").read_text(encoding="utf-8")
    for token in ("npm install", "pip install", "playwright install chromium"):
        assert_true(token in bootstrap, f"bootstrap script must cover {token}")


def main() -> int:
    tests = [
        test_mode_is_required,
        test_single_page_contract,
        test_single_page_nav_is_readable_and_theme_bound,
        test_single_page_demo_fixture_builds,
        test_ppt_contract_remains_available,
        test_ppt_export_syncs_missing_named_dom_objects,
        test_ppt_export_syncs_unnamed_editable_dom_objects,
        test_shared_editor_contract,
        test_preview_service_reuses_browser_for_exports,
        test_shared_accordion_contract,
        test_ppt_drawer_accordion_groups_do_not_stretch,
        test_metric_typography_is_a_seventh_global_level,
        test_plugin_bundles_chart_and_word_cloud_skills,
        test_canonical_skill_and_plugin_names,
        test_dependency_bootstrap_contract,
    ]
    for test in tests:
        test()
        print(f"[OK] {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
