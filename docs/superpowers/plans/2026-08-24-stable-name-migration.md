# HTML Report Stable Name Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `html-report` with `html-report-stable-base` as the active skill and plugin identifier everywhere it denotes this specific component.

**Architecture:** The root skill and plugin manifest use the canonical identifier. The plugin-facing wrapper is renamed and remains a thin pointer to the root contract. Direct dependent workflow references are updated; generic prose and file-format names are left untouched.

**Tech Stack:** Markdown/YAML, JSON, Python unittest, Node.js, Codex plugin validator.

**Spec:** `docs/superpowers/specs/2026-08-24-stable-name-migration.md`

## Global Constraints

- The machine identifier is `html-report-stable-base`; “HTML Report” remains an allowed display label.
- No `html-report` compatibility alias is retained.
- Do not rename the GitHub repository or data/CSS/file-format identifiers.
- Do not publish or push in this task.

---

### Task 1: Canonical skill and plugin metadata

**Files:**
- Modify: `SKILL.md:1-4`
- Modify: `.codex-plugin/plugin.json:1-4`
- Modify: `agents/openai.yaml`
- Test: `scripts/test_report_modes.py`

- [ ] **Step 1: Add a failing metadata test.**

```python
def test_canonical_skill_and_plugin_names():
    assert root_skill_name() == "html-report-stable-base"
    assert plugin_manifest()["name"] == "html-report-stable-base"
```

- [ ] **Step 2: Run it and confirm the root metadata still reports `html-report`.**

```bash
python -m unittest scripts.test_report_modes.HtmlReportModeTests.test_canonical_skill_and_plugin_names -v
```

- [ ] **Step 3: Set the root skill and plugin manifest names to the canonical identifier; keep the display name as “HTML Report”.**

- [ ] **Step 4: Run the focused test.**

### Task 2: Enabled plugin wrapper rename

**Files:**
- Rename: `skills/html-report/SKILL.disabled.md` → `skills/html-report-stable-base/SKILL.md`
- Test: `scripts/test_report_modes.py`

- [ ] **Step 1: Add a failing test that requires exactly one active wrapper at `skills/html-report-stable-base/SKILL.md` and rejects an active/disabled legacy wrapper.**

- [ ] **Step 2: Run the focused test and confirm it fails with the old wrapper path.**

- [ ] **Step 3: Move the wrapper, change its frontmatter name, and retain its `../../SKILL.md` pointer contract.**

- [ ] **Step 4: Run the focused test and plugin validator.**

```bash
python -m unittest scripts.test_report_modes -v
python /Users/lucasfong/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

### Task 3: Dependent workflows and migration scan

**Files:**
- Modify: `../build-geo-analysis-report-html-ppt/agents/openai.yaml`
- Modify: `../build-geo-analysis-report-html-ppt/SKILL.md`
- Modify: `../ppt-visual-pipeline/SKILL.md`
- Test: `../build-geo-analysis-report-html-ppt/tests/test_html_report_dependency.py`

- [ ] **Step 1: Add failing scan assertions for direct skill references in the GEO and PPT pipeline instructions.**

- [ ] **Step 2: Run the focused tests and confirm they find `$html-report` or direct legacy skill labels.**

- [ ] **Step 3: Replace only references to the specific skill/plugin with `html-report-stable-base`; leave generic “HTML report” prose and file-format identifiers unchanged.**

- [ ] **Step 4: Run complete target and GEO test suites plus sample render/QA.**

```bash
python -m unittest discover -s scripts -p 'test_*.py' -v
python -m unittest discover -s ../build-geo-analysis-report-html-ppt/tests -v
python ../build-geo-analysis-report-html-ppt/scripts/render_geo_html_ppt.py --report <sample-report> --output-dir <output-dir>
node ../build-geo-analysis-report-html-ppt/scripts/qa_geo_html_ppt.mjs <output-dir>/index.html <output-dir>/qa-screenshots
```

