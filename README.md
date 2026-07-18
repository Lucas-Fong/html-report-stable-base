# html-report-stable-base

[中文说明](README.zh-CN.md)

Codex skill for building stable, editable HTML reports from supplied content or existing HTML. It supports long scrolling reports and fixed 16:9 HTML decks, with a shared style drawer, per-element editing, browser QA, and click-triggered exports.

## Visual Examples

### Single-Page Mode

![Single-page editable report shell](assets/examples/single-page-example.svg)

Use `single-page` when the report should read as a long, vertically scrolling page with section navigation, responsive width, auto height, and `HTML / 图片 / PDF` export.

### PPT Mode

![PPT editable report shell](assets/examples/ppt-example.svg)

Use `ppt` when the output should behave like a slide deck with a fixed `1440 × 810` canvas, page navigation, stable object geometry, and `HTML / PDF / PPTX` export.

## What This Skill Provides

- A right-side editable style drawer with global typography and per-element controls.
- Independent editing for text, shapes, charts, and images.
- HEX color text inputs paired with native color swatches.
- Single-page section navigation or PPT slide navigation.
- ECharts-friendly chart resizing.
- Standalone HTML export that can keep editing controls or export view-only output.
- Local preview service for high-fidelity image, PDF, and PPTX generation after user action.

## Quick Start

Create a model JSON with an explicit `mode`, then build with the matching template.

```bash
python scripts/build_html_report_from_model.py model.json \
  --template assets/template/html-report-single-base.html \
  --out output/index.html
```

Run the checks:

```bash
python scripts/check_html_report.py output/index.html
node scripts/qa_html_report.mjs output/index.html
node scripts/qa_editor_enhancements.mjs output/index.html
node scripts/qa_preview_export.mjs output/index.html
```

Start local preview and click export buttons in the browser:

```bash
node scripts/start_html_report_preview.mjs output 5300
```

## Install From GitHub

This repository is public, so other users can install it by giving Codex the GitHub URL:

```text
$skill-installer install from https://github.com/Lucas-Fong/html-report-stable-base
```

If the installer asks for a repo path, use the repository root because `SKILL.md` lives at the top level.

Public GitHub search can also find this repository through topics such as `codex`, `codex-skills`, `openai-codex`, `agent-skills`, `html-report`, and `report-generator`.

## Discovery In Codex

Public GitHub visibility does not automatically place a skill into Codex's curated skill list. For broad discoverability inside Codex, package the skill as a plugin and add that plugin to a marketplace source. A plugin can bundle this skill with templates, assets, scripts, MCP servers, or connectors, and users can browse/install plugins from supported Codex surfaces.

Short-term distribution:

- Share this GitHub URL and ask users to install it with `$skill-installer`.
- Keep the README, topics, and examples clear so GitHub search works.

Long-term distribution:

- Create a plugin wrapper with `.codex-plugin/plugin.json`.
- Place this skill under `skills/html-report-stable-base/`.
- Add the plugin to a marketplace source for team or public discovery.

## Minimal Models

### Single-Page

```json
{
  "mode": "single-page",
  "title": "Market Audit",
  "sections": [
    {
      "id": "summary",
      "title": "Executive Summary",
      "html": "<h1 class=\"editable\" data-editable-element=\"text\">Executive Summary</h1><p class=\"editable\" data-editable-element=\"text\">...</p>"
    }
  ]
}
```

### PPT

```json
{
  "mode": "ppt",
  "title": "Strategy Deck",
  "slides": [
    {
      "title": "Page 1",
      "html": "<h1 class=\"editable\" data-editable-element=\"text\">Page 1</h1>",
      "objects": []
    }
  ]
}
```

## Editable Element Markup

Every independently editable element must declare exactly one type.

```html
<h2 class="editable" data-editable-element="text">Title</h2>
<div data-editable-element="shape">Card</div>
<div class="chart" data-editable-element="chart"></div>
<img data-editable-element="image" src="..." alt="...">
```

## Repository Structure

- `SKILL.md`: full skill contract and workflow.
- `assets/examples/`: README and skill documentation visuals.
- `assets/template/`: single-page and PPT templates plus shared editor assets.
- `fixtures/`: acceptance fixtures for editor behavior.
- `references/`: supporting contracts, including drawer and element rules.
- `scripts/`: builder, validators, QA checks, preview server, and export utilities.

## Versioning Notes

Track source files, templates, fixtures, examples, scripts, references, and lockfiles. Do not commit `node_modules/`, generated exports, local report outputs, or temporary QA artifacts.
