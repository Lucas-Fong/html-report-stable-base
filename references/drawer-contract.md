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
- `--h1-size`, `--h2-size`, `--h3-size`, `--h4-size`
- `--metric-size` for metric values only; labels and descriptions inside `.metric` cards use `--body-size`
- `--body-size`, `--note-size`
- `--body-line-height`
- `--table-cell-padding-y`, `--table-cell-padding-x`

Drawer CSS must use fixed UI sizes and must not inherit report typography variables.

The `#fontFamily` control is a multiline textarea, not a single-line input, so long font fallback stacks can be edited comfortably.

Edit-mode typography badges (`.typography-label`) sit just outside the target element's top-right corner. Keep them out of the content box whenever there is room; when constrained by the viewport or drawer, clamp them horizontally while keeping the vertical position above the element.

The displayed labels are L1/L2/L3/L4, not H1/H2/H3/H4. Use unbounded `type="number"` fields for global size, line-height, and table padding controls; do not use range sliders. Before opening the drawer or entering edit mode, refresh these inputs from the page's computed styles for the current report context: L1/L2/L3/L4/指标/正文/备注 use the first visible matching content element, body line-height uses the matching body sample's computed line-height, and table padding uses the first visible table cell. Updating the inputs must not write CSS variables or change the page until the user edits a value. Global changes opt into `body.global-typography-active` so adapted reports preserve their source layout until a user adjusts a global control; the reset command removes those opt-in overrides and returns the input values to their initial computed defaults.

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

Manual recognition is a fallback for important content missed during generation. It works in both `single-page` and `ppt` modes:

- `选择页面元素` enters a page-pick mode in edit mode; the next clicked report element becomes the recognition candidate.
- `文本` adds `.editable` and `data-editable-element="text"` and immediately enables `contenteditable` while edit mode is active.
- `矩形` adds `data-editable-element="shape"`.
- `图表` adds `data-editable-element="chart"` to the clicked `.chart`, a descendant `.chart`, or the candidate itself.
- `图片` only applies to a real `<img>` or a descendant `<img>`.
- `表格` only applies to a real `<table>` or containing table; it adds `.editable` to `th`/`td` cells. It does not create a `data-editable-element="table"` type.
- In PPT mode, every successful recognition calls `syncDeckJsonFromDom()` so new recognized content receives a `data-pptx-name` and is preserved for export.

## Text Editing

Only `.editable` content receives `contenteditable="true"` in edit mode. Remove it when edit mode closes and before standalone export. Paste plain text rather than rich clipboard styles.

In `single-page` mode, edit mode also displays typography labels for H1/H2/H3/H4/指标/正文/备注. Metric labels and metric descriptions must classify as 正文; only `.metric .value`, `.metric strong`, or `[data-ppt-level="metric"]` classify as 指标.

PPT fixed furniture such as headers, footers, and page numbers must not use `.editable`, `data-editable-element`, resize handles, or typography labels.

## Mode Differences

`single-page` uses `<main class="report" id="report">` and `.report-section[data-title]`. It has a section navigation component `#sectionNav` with drawer controls in `#sectionNavStyleControl`. The allowed styles are exactly `hidden`, `left`, and `right`, with `right` as the default. Each nav item uses the section title truncated to at most six Unicode characters and keeps the full title in the link `title` attribute. A hidden section has `data-page-hidden="true"`, is absent from `#sectionNav` and export snapshots, and can be restored through `#restoreHiddenPages`. It has no PPT slide navigation, mode toggle, PDF/PPTX controls, or PPTX JSON.

`ppt` uses `<main class="deck" id="deck">`, `.slide`, `#nav`, and `#modeToggle`. It retains table column controls, stage scaling, typography badges, `html-pptx-data`, and PPTX export. A hidden slide has `data-page-hidden="true"`; it is omitted from normal `#nav`, HTML/PNG/PDF/PPTX snapshot data, and cloned `html-pptx-data`. Recalculate visible `.page-number` footer text as `01`, `02`, … after every visibility change. Authors may reach a hidden active slide only in edit mode to restore it.

## Standalone Export

Clone the current DOM after edits, then:

- remove `contenteditable` and transient selection classes;
- close and hide the drawer and gear;
- remove `drawer-open` and `edit-mode`, then add `standalone-export`;
- inline local stylesheets, scripts, images, and data;
- preserve single-page section navigation items and the selected navigation style;
- preserve inline global variables and independent element styles;
- preserve user-replaced image data URLs without requiring any additional asset fetch;
- omit an open `#imageCropDialog` from the serialized delivery HTML;
- remove every `data-page-hidden="true"` section/slide before serialization; when slides are removed, remove matching entries from `html-pptx-data` as well;
- write a real newline after `<!doctype html>` and nothing after `</html>`.

Browser-downloaded HTML filenames use the first visible report/cover H1. Replace `\\ / : * ? " < > |` with `-`, normalize whitespace, cap the filename stem at 72 Unicode characters, and fall back to `document.title` then `html-report`.

## Click-Triggered Export

- Both modes use an HTML-export modal outside the drawer. `保留编辑` exports the editor entry point; `仅查看` removes it.
- PPT footer uses `HTML / PDF / PPTX`; PDF and PPTX use the local preview service. Single-page footer uses `HTML / 图片 / PDF`; 图片与 PDF use the local preview service and are created only after the user clicks a button.
- `scripts/start_html_report_preview.mjs <report-dir> <port>` exposes `POST /api/export`, accepting `{mode, format, html, title}`. It receives an edited DOM snapshot, creates the requested file in `exports/`, and returns a download URL.
- When opened with `file://`, HTML export remains available. PPT PDF uses browser print as a 16:9 fallback; other high-fidelity exports must explain that the report needs to be opened through the localhost preview URL.
