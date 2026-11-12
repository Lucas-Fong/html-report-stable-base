# Drawer And Element Contract

## Shared Markup

- `body[data-report-mode]` is exactly `single-page` or `ppt`.
- Drawer: `<aside class="style-drawer" id="styleDrawer">`.
- Gear: `<button class="drawer-toggle" id="drawerToggle">`.
- Edit toggle: `#editToggle`; standalone HTML button: `#downloadHtml`.
- Drawer uses a fixed header, scrollable body, and fixed footer.
- Each direct `.drawer-body > .control-group` and `.drawer-repair > .control-group` is converted into an accordion group by the shared editor. Groups are collapsed by default, use `.control-group-toggle` with `aria-expanded="false"`, wrap body controls in `.control-group-content`, and only one visible group may be open at a time.
- Common drawer groups are task-oriented and consistent across modes: `浏览与模式`, `全局样式`, `对象编辑`, and `图表数据`; PPT mode also includes `表格设置`. `修复识别` lives in a visually distinct fixed `.drawer-repair` area above the fixed `导出` footer.
- Each task group includes a `.drawer-group-help` sentence explaining when to use that group.
- Each drawer module toggle receives a compact icon. Use the shared mapping instead of adding one-off SVGs.
- Controls that mutate report content use `.edit-only` and stay disabled outside edit mode.
- `浏览与模式` includes the edit-only `#currentPageVisible` checkbox and `#restoreHiddenPages` command. The checkbox affects the page currently in view; do not permit the author to hide the final visible section/slide.
- `#editToggle` reads `编辑模式` before editing and `保存修改` during editing. Exiting edit mode persists PPT DOM changes to `html-pptx-data`.
- `#closeDrawer` must save active edits before closing: if edit mode is on, run the same exit path as `保存修改`, then close the drawer.
- Both modes include a `补充识别` drawer module with `#pickRecognitionElement` and `[data-recognition-type]` controls for marking missed page content as text, shape, chart, image, or table.
- The drawer width is `320px`; keep control spacing compact enough to preserve report canvas space.
- The drawer footer includes one low-contrast `.drawer-about` line with the GitHub project link, author `Lucas Fong`, `MIT License`, and `© 2026`; do not repeat the author in the copyright text.

## Global Controls

Bind global controls through `data-global-var="--variable"` and optional `data-unit`. Output labels use `data-global-out`. Both templates support:

- `--font-family`
- `--body-line-height`
- `--table-cell-padding-y`, `--table-cell-padding-x`

Neither mode renders global metric/body/note font-size controls. Text size is changed only through the selected element’s font-size control.

Drawer CSS must use fixed UI sizes and must not inherit report typography variables.

The `#fontFamily` control is a multiline textarea, not a single-line input, so long font fallback stacks can be edited comfortably.

Neither mode renders typography badges (`.typography-label`) or corner labels. Use unbounded `type="number"` fields for the available global layout controls; do not use range sliders. Before opening the drawer or entering edit mode, refresh body line-height from a visible body sample and table padding from the first visible table cell. Updating the inputs must not write CSS variables or change the page until the user edits a value. Global changes opt into `body.global-typography-active` so adapted reports preserve their source layout until a user adjusts a global control; the reset command removes those opt-in overrides and returns the input values to their initial computed defaults. Titles retain their source size unless the selected element’s font-size control changes it.

## Element Selection

Use `data-editable-element="text|shape|chart|image"`. A click in edit mode sets one `.selected-element`; clicking outside the element and drawer clears it. Show only control groups whose `data-element-types` includes the selected type.

Write independent values to the selected element's inline style. Do not rewrite global variables, siblings, or descendants unless the selected element itself owns that property. Width and height are CSS pixels. For width/height, make inline text measurable, bypass selected-element `max-width`, and use a matching flex basis when the selected element is a flex child. ECharts dimensions must call `echarts.getInstanceByDom(chartDom)?.resize()`.

Chart selection must expose a `图表数据` group with a JSON editor. The default JSON should be a compact editable shape:

```json
{"categories":["A","B"],"categoryAxis":"xAxis","series":[{"name":"指标","type":"bar","data":[10,20]}]}
```

It must also accept advanced `{ "option": {...} }` payloads. Applying valid JSON calls `chart.setOption()`, resizes the chart, stores the compact JSON in `data-chart-data`, stores the effective option in `data-chart-option`, and keeps those attributes in standalone HTML / PPT DOM sync so exports preserve edited charts.

Context-aware drawer behavior:

- Selecting text, shape, or image opens `对象编辑`.
- Selecting an image also exposes a `图片来源` subgroup with a `替换图片` command. It accepts a user-selected local image, then opens `#imageCropDialog` before changing the page. The crop frame uses the selected image's rendered width/height ratio; users can drag the source and adjust zoom. `应用裁剪` replaces only the selected real `<img>` with a cropped PNG data URL, keeps its inline dimensions and object-fit/object-position behavior, and clears `srcset` / `sizes`. `取消` leaves the original image unchanged. In PPT mode, synchronize the updated `src` into `html-pptx-data` immediately.
- Selecting a chart opens `图表数据`.
- Selecting a table cell in PPT mode opens `表格设置`.
- `表格设置` is unavailable until a table column/cell is selected; `图表数据` is unavailable until an ECharts chart is selected. Both stay unavailable while ordinary text, shape, or image content is selected.
- Successful manual recognition opens the next relevant group: `对象编辑` for text/shape/image, `图表数据` for chart, and `表格设置` for table when that group exists.

For every independent color control (text, background, and border), show a native color swatch and a paired HEX text field. The text field accepts `#RGB` and `#RRGGBB`, normalizes accepted values to uppercase six-digit HEX, and updates only the selected element.

The `元素独立样式` group must include `.element-empty-state`, `.element-selected-state`, `[data-selected-element-label]`, and `#deleteSelectedElement`. Delete only the selected editable element after confirmation; in PPT mode it must also remove the corresponding object from the synchronized JSON.

## Manual Recognition

The editor automatically recognizes report content at initialization and after DOM insertion: standard/semantic text, leaf text containers, card/panel-like shapes, real images, chart containers, and real table cells. Manual recognition is a fallback for important ambiguous content. It works in both `single-page` and `ppt` modes:

- `选择页面元素` enters a page-pick mode in edit mode; the next clicked report element becomes the recognition candidate.
- `文本` adds `.editable` and `data-editable-element="text"` and immediately enables `contenteditable` while edit mode is active.
- `矩形` adds `data-editable-element="shape"`.
- `图表` adds `data-editable-element="chart"` to the nearest containing `.chart`, otherwise to a descendant `.chart`, or finally to the candidate itself. This keeps canvas clicks attached to their ECharts container.
- `图片` only applies to a real `<img>` or a descendant `<img>`.
- `表格` only applies to a real `<table>` or containing table; it adds `.editable` to `th`/`td` cells. It does not create a `data-editable-element="table"` type.
- In PPT mode, every successful recognition calls `syncDeckJsonFromDom()` so new recognized content receives a `data-pptx-name` and is preserved for export.

## Text Editing

Only `.editable` content receives `contenteditable="true"` in edit mode. Remove it when edit mode closes and before standalone export. Paste plain text rather than rich clipboard styles.

When an editable `<label for="…">` is selected in edit mode, prevent its default forwarding to the associated form field so the label remains selected and opens `对象编辑`. Outside edit mode, preserve the label's native behavior of focusing its associated field.

In both modes, edit mode displays no typography labels or corner badges. Metric labels and metric descriptions remain body text; only `.metric .value`, `.metric strong`, or `[data-ppt-level="metric"]` use metric source styles.

PPT fixed furniture such as headers, footers, and page numbers must not use `.editable`, `data-editable-element`, or resize handles.

## Mode Differences

`single-page` uses a full-width `<main class="report" id="report">` and `.report-section[data-title]`. Sections may carry optional `data-chapter`; the navigation renders one ordinary first-level link for each adjacent chapter, otherwise falling back to numbered chapters. It has a section navigation component `#sectionNav` with separate `#sectionNavStyleControl` and `#sectionNavSideControl` selectors in the drawer. The allowed modes are `hidden`, `top`, `embedded`, `floating`, and `dots`, each with a `left` or `right` position; default is top-left. Top mode is fixed to the page top and aligns its links to the chosen side. Embedded modes reserve a left/right report column, avoid the open right-side drawer, and expose `#sectionNavCollapse`; their default width is `156px` (`40px` collapsed). Floating modes may overlap report content but use a restrained `112px` width. Dots modes show no title text and use `18px` targets. Text nav items use the chapter title truncated to at most five Unicode characters and keep the full chapter title in the link `title` attribute. A hidden section has `data-page-hidden="true"`, is absent from `#sectionNav` and export snapshots, and can be restored through `#restoreHiddenPages`. It has no PPT slide navigation, mode toggle, PDF/PPTX controls, or PPTX JSON.

`ppt` uses `<main class="deck" id="deck">`, `.slide`, `#nav`, and `#modeToggle`. It retains table column controls, stage scaling, `html-pptx-data`, and PPTX export, but no typography badges. Adaptive mode must reflow narrow viewports, wrap long text, and reserve space for the right-side navigation; verify at `744 × 756` that no slide overflows horizontally or sits under the nav rail. A hidden slide has `data-page-hidden="true"`; it is omitted from normal `#nav`, HTML/PNG/PDF/PPTX snapshot data, and cloned `html-pptx-data`. Recalculate visible `.page-number` footer text as `01`, `02`, … after every visibility change. Authors may reach a hidden active slide only in edit mode to restore it.

## Standalone Export

Clone the current DOM after edits, then:

- remove `contenteditable` and transient selection classes;
- remove `drawer-open` and `edit-mode`;
- for editable HTML, close the drawer but preserve the gear, drawer, edit toggle, and PPT/adaptive mode control; do not add `standalone-export`;
- for view-only HTML, add `standalone-export`, hide the gear and drawer, and preserve `#nav` plus `#standaloneBrowseToggle` so recipients can switch between PPT and adaptive browsing;
- restore runtime accordion buttons/content wrappers to their original headings and child order before serialization; the standalone page must create fresh accordion handlers on load rather than retaining DOM state without its event listeners;
- inline local stylesheets, scripts, images, `srcset` fallbacks, SVG image references, CSS `url(...)` assets, and inline-style background assets;
- preserve single-page section navigation items and the selected navigation style;
- preserve inline global variables and independent element styles;
- preserve user-replaced image data URLs without requiring any additional asset fetch;
- omit an open `#imageCropDialog` from the serialized delivery HTML;
- remove every `data-page-hidden="true"` section/slide before serialization; when slides are removed, remove matching entries from `html-pptx-data` as well;
- write a real newline after `<!doctype html>` and nothing after `</html>`.

Browser-downloaded HTML filenames use the first visible report/cover H1. Replace `\\ / : * ? " < > |` with `-`, normalize whitespace, cap the filename stem at 72 Unicode characters, and fall back to `document.title` then `html-report`.

## Click-Triggered Export

- Both modes show a local-preview-service hint in the drawer. When the report is opened as `file://`, every export action opens an explanatory prompt and the HTML-export modal remains closed.
- Both modes use an HTML-export modal outside the drawer after the local-preview-service check. `保留编辑` retains the editor entry point; `仅查看` removes editor controls. PPT view-only output keeps a standalone PPT/adaptive browse toggle. PPT footer uses `HTML / PDF / PPTX`; single-page footer uses `HTML / 图片 / PDF`; every format is created only after the user clicks a button in the local preview service.
- `scripts/start_html_report_preview.mjs <report-dir> <port>` exposes `POST /api/export`, accepting `{mode, format, html, title}`. It receives an edited DOM snapshot, creates the requested file in `exports/`, and returns a download URL.
- When opened with `file://`, do not export or use browser print as a fallback. Explain that the report must be opened through the localhost preview URL before exporting any format.
