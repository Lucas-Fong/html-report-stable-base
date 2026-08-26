# PPT Safe Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce normal PPT-mode report delivery latency without changing page editing, standalone HTML behavior, or native editable PPTX behavior.

**Architecture:** Keep the current PPT DOM, `data-pptx-name` bindings, legacy JSON synchronization, and local preview service. Add only two zero-behavior-change improvements: omit ECharts when a model explicitly declares itself chart-free, and make static-only validation the documented normal generation gate.

**Tech Stack:** Python builder/checker, static HTML templates, Node.js Playwright acceptance checks.

**Spec:** `docs/superpowers/specs/2026-08-26-pptx-json-contract-v2.md` (compatibility decision only) and this task's approved safe-performance scope.

## Global Constraints

- Preserve all existing PPT HTML editing controls, slide DOM, and `data-pptx-name` behavior.
- Preserve existing reports without requiring a model update.
- Do not rasterize PPTX output, virtualize slides, externalize default delivery assets, or remove legacy DOM-to-JSON synchronization.
- A chart-enabled report must retain the inline ECharts runtime.
- Keep the existing pre-existing uncommitted `scripts/qa_html_report.mjs` change untouched.

---

### Task 1: Omit ECharts only for an explicitly chart-free PPT model

**Files:** Modify `scripts/build_html_report_from_model.py:84-128`; modify and test `scripts/test_report_modes.py`.

**Interfaces:** Consumes a valid PPT model and optional `requiresEcharts: false`. Produces a chart-free HTML file without the inline ECharts script; reports with `requiresEcharts` omitted, true, or chart markup keep the current runtime.

- [ ] **Step 1: Write the failing test**

```python
def test_ppt_builder_omits_echarts_only_for_explicit_chart_free_model() -> None:
    chart_free = {"mode": "ppt", "requiresEcharts": False, "slides": [{"title": "One", "html": "<h1>One</h1>", "objects": []}]}
    chart_report = {"mode": "ppt", "requiresEcharts": False, "slides": [{"title": "Chart", "html": '<div class="chart" data-editable-element="chart"></div>', "objects": []}]}
    assert "Apache Software Foundation" not in build(chart_free)
    assert "Apache Software Foundation" in build(chart_report)
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `python scripts/test_report_modes.py`

Expected: the chart-free assertion fails because the current builder always preserves the inline ECharts runtime.

- [ ] **Step 3: Write the minimal implementation**

```python
def model_requires_echarts(model: dict) -> bool:
    if model.get("requiresEcharts") is not False:
        return True
    values = [slide.get("html", "") for slide in model.get("slides", [])]
    values.append(model.get("customScript", ""))
    return any(re.search(r"(?:data-editable-element=[\"']chart|class=[\"'][^\"']*\\bchart\\b|\\becharts\\b)", value, re.I) for value in values)
```

When this function returns false, remove only the `<script data-inline-asset="assets/echarts.min.js">…</script>` block. Do not alter the template, shared editor, or report body.

- [ ] **Step 4: Run the focused test and complete mode regression**

Run: `python scripts/test_report_modes.py`

Expected: chart-free output omits ECharts; chart output and existing contracts pass.

- [ ] **Step 5: Commit the isolated task**

```bash
git add scripts/build_html_report_from_model.py scripts/test_report_modes.py
git commit -m "perf: omit echarts for chart-free ppt reports"
```

### Task 2: Document static-only validation as the normal content-generation path

**Files:** Modify `SKILL.md:217-251`; modify and test `scripts/test_report_modes.py`.

**Interfaces:** Consumes an ordinary content-only report request versus a template/editor/export implementation change. Produces a documented default that runs `check_html_report.py` for ordinary delivery and reserves browser QA for editor, template, export, and visual-contract changes.

- [ ] **Step 1: Write the failing test**

```python
def test_skill_documents_static_checker_as_normal_generation_gate() -> None:
    skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert "普通内容生成默认只运行静态检查" in skill
    assert "仅在模板、编辑器、导出或视觉合同变更时运行浏览器验收" in skill
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `python scripts/test_report_modes.py`

Expected: the exact lightweight-gate wording is absent.

- [ ] **Step 3: Add the two sentences to Performance Notes**

Keep release and export verification requirements unchanged.

- [ ] **Step 4: Run regression tests**

Run: `python scripts/test_report_modes.py`

Expected: the documentation assertion and all existing mode checks pass.

- [ ] **Step 5: Commit the isolated task**

```bash
git add SKILL.md scripts/test_report_modes.py
git commit -m "docs: clarify lightweight report validation"
```

### Task 3: Verify preserved chart editing and export behavior

**Files:** Modify none unless a test finds a regression. Test `scripts/qa_html_report.mjs`, `scripts/qa_editor_enhancements.mjs`, `scripts/qa_preview_export.mjs`, and `scripts/test_report_modes.py`.

**Interfaces:** Consumes the existing chart-enabled PPT fixture and a temporary explicit chart-free model. Produces evidence that image crop, page visibility, ECharts editing, and PPT HTML/PDF/PNG/PPTX export remain available.

- [ ] **Step 1: Build chart-enabled and chart-free temporary PPT files**

```bash
python scripts/build_html_report_from_model.py fixtures/editor-contract-ppt.json --template assets/template/html-report-ppt-base.html --out /tmp/ppt-with-chart.html
```

Build the chart-free file with `"requiresEcharts": false` and no chart markers.

- [ ] **Step 2: Run browser acceptance checks for the chart-enabled file**

```bash
node scripts/qa_html_report.mjs /tmp/ppt-with-chart.html
node scripts/qa_editor_enhancements.mjs /tmp/ppt-with-chart.html
```

Expected: chart controls, image crop, page visibility, and standalone HTML behavior remain green.

- [ ] **Step 3: Run preview-export, static, and whitespace checks**

```bash
node scripts/qa_preview_export.mjs /tmp/ppt-with-chart.html
python scripts/test_report_modes.py
git diff --check
```

Expected: all checks pass; only explicit chart-free reports omit ECharts.

- [ ] **Step 4: Commit the verification-only task if it introduces files**

```bash
git add -A
git commit -m "test: verify safe ppt performance path"
```

## Self-Review

- Task 1 reduces output payload only after an explicit opt-in and keeps legacy models unchanged.
- Task 2 removes unnecessary browser startup from ordinary content delivery without changing the generated artifact.
- Task 3 verifies retained editor/export behavior.
- JSON v2, resource-ID storage, and object-level JSON patches are excluded because they require compatibility migration rather than zero-behavior-change optimization.

## Execution Handoff

The user explicitly requested execution in this session. Execute Tasks 1–3 inline, without touching the pre-existing `scripts/qa_html_report.mjs` diff.
