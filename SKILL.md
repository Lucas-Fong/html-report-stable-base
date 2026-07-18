---
name: html-report-stable-base
description: "Use when supplied content or an existing HTML report needs a stable editable browser shell in either long-screen single-page mode or 16:9 PPT mode, including global and per-element styling, ECharts canvas support, standalone HTML delivery, or optional PPTX export in PPT mode."
---

# HTML Report Stable Base

## Purpose

Provide a content-neutral HTML report foundation. The calling skill, existing report, model, or user owns the topic, outline, copy, page count, colors, charts, images, and analysis. Template demo content is disposable and must never be treated as recommended report content or visual direction.

## Confirm The Mode First

Every new report must explicitly use one mode:

- `single-page`: one vertically scrolling, fluid HTML report. It supports editing, standalone HTML export, and click-triggered long PNG / one-page long PDF export through the local preview service.
- `ppt`: a slide deck with a fixed `1440 × 810` canvas, navigation, optional adaptive browsing, `html-pptx-data`, and click-triggered PDF/PPTX export through the local preview service.

If the calling skill or model already declares the mode, use it. Otherwise ask the calling skill or user before generating files. Do not infer or default the mode.

## Shared Editing Contract

Both modes must keep:

- a compact bottom-right gear and right-side drawer; drawer width is `320px` and the label column stays compact so inputs remain usable;
- drawer control groups as collapsed accordion sections by default, with one visible section open at a time;
- an explicit edit-mode toggle;
- global font family, L1/L2/L3/L4/metric/body/note sizes, body line-height, and table padding controls; L-levels map to HTML headings but avoid confusion with HTML tags. Use direct numeric inputs without `min`/`max`, not sliders;
- metric values such as `.metric .value`, `.metric strong`, or `[data-ppt-level="metric"]` follow `--metric-size`; labels and descriptions inside metric cards remain body text;
- direct text editing only while edit mode is enabled;
- per-element selection and independent inline styles;
- color controls pair the native color swatch with a HEX text field that accepts pasted `#RGB` or `#RRGGBB` values;
- a selected-element panel with a delete command, plus lightweight reset commands for global typography, dimensions, text styles, and box styles;
- recognizable icons for every drawer module;
- ECharts canvas rendering when supplied content includes charts.

Mark independently editable elements with exactly one type:

```html
<h2 class="editable" data-editable-element="text">Title</h2>
<div data-editable-element="shape">Card</div>
<div class="chart" data-editable-element="chart"></div>
<img data-editable-element="image" src="..." alt="...">
```

Supported independent controls:

| Type | Controls |
|---|---|
| `text` | width, height, font size, color, weight, alignment, line-height, background, border color/width, radius |
| `shape` | width, height, fill, border color/width, radius |
| `chart` | width and height; call the ECharts instance `resize()` after changes |
| `image` | width and height; preserve its source and existing object-fit/aspect behavior |

Only one element may be selected. Independent styles are written inline and override global variables only for that element. Width edits must work for inline text, flex children, and elements constrained by `max-width`; the editor may set `display:inline-block`, a matching flex basis, and `max-width:none` on the selected element. Do not add free dragging or absolute-position controls.

Read `references/drawer-contract.md` when creating or adapting a template.

## Model Contract

Use `scripts/build_html_report_from_model.py`. The top-level `mode` is required.

For `ppt`, keep the existing `slides` model and structured `objects`:

```json
{"mode":"ppt","title":"Deck","slides":[{"title":"Page 1","html":"...","objects":[]}]}
```

For `single-page`, use sections without PPTX objects:

```json
{"mode":"single-page","title":"Report","sections":[{"id":"overview","title":"Overview","html":"..."}]}
```

Each section may include optional `id`, `title`, and `class`; `html` is required. The builder must reject a missing or invalid mode rather than choosing one.

## Visual Examples

Use these visuals as orientation for authors who are applying the skill to new content or adapting an existing report. They are examples of the shell and interaction pattern only; do not copy their dummy content into a report.

### Single-Page Report

![Single-page editable report shell](assets/examples/single-page-example.svg)

Use this pattern when the output should read as a long, vertically scrolling report: a hero or opening section, repeated content sections, optional side section navigation, and a right-side style drawer. Keep the report in normal document flow and let section height expand with the content.

Minimal model:

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

### PPT Report

![PPT editable report shell](assets/examples/ppt-example.svg)

Use this pattern when the output must behave like a slide deck: fixed `1440 × 810` pages, page navigation, stable object geometry, and editable PPTX export. Keep page furniture fixed and non-editable, while report objects are represented in both DOM and `html-pptx-data`.

Minimal model:

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

### Adding GIFs Or Screenshots

If a future update adds a workflow GIF or screenshot, store it in `assets/examples/` and reference it from this section with relative Markdown paths. Keep media small enough for GitHub review. Prefer short GIFs that show one interaction only, such as opening the drawer, selecting an element, changing a HEX color, or exporting HTML.

## Mode-Specific Rules

### Single-Page

- Use `assets/template/html-report-single-base.html`.
- Use normal document flow, responsive width, and auto height. Do not add slide snapping, PPT slide navigation, page numbers, or a fixed 16:9 canvas.
- Provide single-page section navigation from `.report-section[data-title]` with exactly three styles: `hidden`, `left`, and `right`; default to `right`.
- Navigation labels must contain at most six Unicode characters and keep the full section title in the link `title` attribute.
- Edit mode must show H1/H2/H3/H4/metric/body/note typography labels for report content. Metric labels and descriptions remain body text; only metric values use the metric level.
- Keep `HTML / 图片 / PDF` export buttons. HTML must use the same modal choice as PPT: `保留编辑` or `仅查看`. 图片与 PDF 必须由用户点击后通过本地预览服务即时生成，不得在生成阶段预产出。Do not include PPTX, `html-pptx-data`, `data-pptx-name`, or PPT geometry sync.
- The exported delivery HTML must retain all user edits, selected section navigation style, inline local CSS/JS/images/data, and hide the drawer and gear.
- Long PNG/PDF exports must be generated from Chromium's native `#report` screenshot path, not SVG `foreignObject`, so they match the browser rendering and avoid print truncation.

### PPT

- Use `assets/template/html-report-ppt-base.html`.
- Keep the fixed `1440 × 810` canvas, equal left/right margins, page navigation, PPT/adaptive browsing, table column controls, and geometry scaling.
- The PPT/adaptive toggle uses a compact presentation-canvas icon, not a Unicode box-character icon.
- Keep `html-pptx-data`, unique per-slide object names, DOM-to-JSON synchronization, and editable PPTX export.
- Keep `HTML / PDF / PPTX` export buttons. HTML must let the user choose `保留编辑` or `仅查看`; PDF and PPTX are generated only after the user clicks them in the local preview service.
- Page furniture such as kickers, footers, and page numbers remains fixed, non-editable, and `12px`/`12pt`.
- Browser standalone HTML export must preserve edits and charts while hiding the drawer and gear.

## Workflow

1. Require a supplied content source; do not invent report content.
2. Confirm `single-page` or `ppt` before generation.
3. Build from the matching template and model, or preserve an existing report while adding the matching shell.
4. Add `.editable` to text content and `data-editable-element` to independently styled elements.
5. In PPT mode, keep visible objects and `html-pptx-data` synchronized with `data-pptx-name`.
6. Run the mode-aware static checker:

   ```bash
   python <skill-root>/scripts/check_html_report.py <output>/index.html
   ```

7. Run browser QA when Playwright is available:

   ```bash
   node <skill-root>/scripts/qa_html_report.mjs <output>/index.html
   ```

8. Run the editable-base acceptance check. It covers drawer icons, edit/save labels, L-level controls, reset, delete, constrained element dimensions, and PPT export layout:

   ```bash
   node <skill-root>/scripts/qa_editor_enhancements.mjs <output>/index.html
   ```

9. To enable high-fidelity click-triggered exports, start the local preview service and return its URL:

   ```bash
   node <skill-root>/scripts/start_html_report_preview.mjs <output> 5300
   ```

   The service binds only to `127.0.0.1`. It writes PDF/PNG/PPTX outputs after user action into `<output>/exports/`; it never pre-generates exports or rewrites `<output>/index.html`.

10. Run the preview export acceptance check:

   ```bash
   node <skill-root>/scripts/qa_preview_export.mjs <output>/index.html
   ```

11. Return `<output>/index.html` by default. Export standalone HTML only when requested:

   ```bash
   python <skill-root>/scripts/export_html_report.py <output>/index.html --out-dir <output>/exports --formats html
   ```

   PPT mode may additionally request `pdf,pptx`.

12. For scripted, non-interactive single-page long image/PDF exports only, use Chromium screenshot export:

   ```bash
   node <skill-root>/scripts/export_single_page_long.mjs <output>/index.html <output>/exports
   ```

   This produces `<output>/exports/index-long.png` and `<output>/exports/index-long.pdf`; it is not the default UI flow.

## Quality Gate

Block delivery when any applicable check fails:

- mode is missing or conflicts with the template;
- the drawer, edit toggle, global controls, or four element protocols are unavailable;
- drawer control groups are not collapsed by default or allow multiple visible sections to remain open;
- independent edits affect unselected elements;
- chart dimensions change without an ECharts resize;
- single-page output lacks section navigation controls, uses nav labels longer than six Unicode characters, or contains PPT navigation, PPTX controls, or PPTX JSON;
- single-page edit mode lacks any of the seven typography labels (L1/L2/L3/L4/指标/正文/备注), or metric labels/descriptions follow metric sizing instead of body sizing;
- a drawer module lacks its icon, reset/delete behavior is unavailable, edit mode does not use `编辑模式` / `保存修改`, or constrained inline/flex/max-width element dimensions cannot be changed;
- the drawer is wider than `320px`, global controls use a slider or bounded numeric input, the PPT/adaptive toggle lacks its presentation icon, export buttons do not match their mode, either mode's HTML export lacks its modal editability choice, or preview-service exports do not reflect the submitted page snapshot;
- color controls lack a pasted HEX path, or a valid HEX value fails to update only the selected element;
- PPT output loses its canvas, navigation, JSON contract, or object uniqueness;
- standalone HTML loses edits/assets/section navigation state, displays the drawer/gear, writes visible `\n`, or keeps content after `</html>`.

## Resource Map

- `assets/template/html-report-single-base.html`: long-screen report shell.
- `assets/template/html-report-ppt-base.html`: editable 16:9 PPT shell.
- `assets/template/shared/report-editor.css` and `report-editor.js`: shared global and per-element editor.
- `scripts/build_html_report_from_model.py`: explicit-mode model builder.
- `scripts/check_html_report.py`: mode-aware static checks.
- `scripts/qa_html_report.mjs`: mode-aware browser QA.
- `scripts/qa_editor_enhancements.mjs`: editable-base browser acceptance QA.
- `fixtures/editor-contract-ppt.json` and `fixtures/editor-contract-single.json`: clean generation fixtures for editor acceptance.
- `scripts/export_html_report.py`: standalone HTML and PPT-mode PDF/PPTX export.
- `scripts/export_single_page_long.mjs`: single-page Chromium-rendered long PNG and one-page long PDF export.
- `scripts/start_html_report_preview.mjs`: localhost-only preview and click-triggered PNG/PDF/PPTX export service.
- `scripts/qa_preview_export.mjs`: local preview export and HTML export-choice acceptance QA.
- `references/drawer-contract.md`: shared drawer and selection protocol.
