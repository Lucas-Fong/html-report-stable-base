# Drawer And Element Contract

## Shared Markup

- `body[data-report-mode]` is exactly `single-page` or `ppt`.
- Drawer: `<aside class="style-drawer" id="styleDrawer">`.
- Gear: `<button class="drawer-toggle" id="drawerToggle">`.
- Edit toggle: `#editToggle`; standalone HTML button: `#downloadHtml`.
- Drawer uses a fixed header, scrollable body, and fixed footer.
- Each direct `.drawer-body > .control-group` is converted into an accordion group by the shared editor. Groups are collapsed by default, use `.control-group-toggle` with `aria-expanded="false"`, wrap body controls in `.control-group-content`, and only one visible group may be open at a time.
- Each drawer module toggle receives a compact icon. Use the shared mapping instead of adding one-off SVGs.
- Controls that mutate report content use `.edit-only` and stay disabled outside edit mode.
- `#editToggle` reads `编辑模式` before editing and `保存修改` during editing. Exiting edit mode persists PPT DOM changes to `html-pptx-data`.
- The drawer width is `320px`; keep control spacing compact enough to preserve report canvas space.

## Global Controls

Bind global controls through `data-global-var="--variable"` and optional `data-unit`. Output labels use `data-global-out`. Both templates support:

- `--font-family`
- `--h1-size`, `--h2-size`, `--h3-size`, `--h4-size`
- `--metric-size` for metric values only; labels and descriptions inside `.metric` cards use `--body-size`
- `--body-size`, `--note-size`
- `--body-line-height`
- `--table-cell-padding-y`, `--table-cell-padding-x`

Drawer CSS must use fixed UI sizes and must not inherit report typography variables.

The displayed labels are L1/L2/L3/L4, not H1/H2/H3/H4. Use unbounded `type="number"` fields for global size, line-height, and table padding controls; do not use range sliders. Global changes opt into `body.global-typography-active` so adapted reports preserve their source layout until a user adjusts a global control; the reset command removes those opt-in overrides and returns the input values to their initial defaults.

## Element Selection

Use `data-editable-element="text|shape|chart|image"`. A click in edit mode sets one `.selected-element`; clicking outside the element and drawer clears it. Show only control groups whose `data-element-types` includes the selected type.

Write independent values to the selected element's inline style. Do not rewrite global variables, siblings, or descendants unless the selected element itself owns that property. Width and height are CSS pixels. For width/height, make inline text measurable, bypass selected-element `max-width`, and use a matching flex basis when the selected element is a flex child. ECharts dimensions must call `echarts.getInstanceByDom(chartDom)?.resize()`.

For every independent color control (text, background, and border), show a native color swatch and a paired HEX text field. The text field accepts `#RGB` and `#RRGGBB`, normalizes accepted values to uppercase six-digit HEX, and updates only the selected element.

The `元素独立样式` group must include `.element-empty-state`, `.element-selected-state`, `[data-selected-element-label]`, and `#deleteSelectedElement`. Delete only the selected editable element after confirmation; in PPT mode it must also remove the corresponding object from the synchronized JSON.

## Text Editing

Only `.editable` content receives `contenteditable="true"` in edit mode. Remove it when edit mode closes and before standalone export. Paste plain text rather than rich clipboard styles.

In `single-page` mode, edit mode also displays typography labels for H1/H2/H3/H4/指标/正文/备注. Metric labels and metric descriptions must classify as 正文; only `.metric .value`, `.metric strong`, or `[data-ppt-level="metric"]` classify as 指标.

PPT fixed furniture such as headers, footers, and page numbers must not use `.editable`, `data-editable-element`, resize handles, or typography labels.

## Mode Differences

`single-page` uses `<main class="report" id="report">` and `.report-section[data-title]`. It has a section navigation component `#sectionNav` with drawer controls in `#sectionNavStyleControl`. The allowed styles are exactly `hidden`, `left`, and `right`, with `right` as the default. Each nav item uses the section title truncated to at most six Unicode characters and keeps the full title in the link `title` attribute. It has no PPT slide navigation, mode toggle, PDF/PPTX controls, or PPTX JSON.

`ppt` uses `<main class="deck" id="deck">`, `.slide`, `#nav`, and `#modeToggle`. It retains table column controls, stage scaling, typography badges, `html-pptx-data`, and PPTX export.

## Standalone Export

Clone the current DOM after edits, then:

- remove `contenteditable` and transient selection classes;
- close and hide the drawer and gear;
- remove `drawer-open` and `edit-mode`, then add `standalone-export`;
- inline local stylesheets, scripts, images, and data;
- preserve single-page section navigation items and the selected navigation style;
- preserve inline global variables and independent element styles;
- write a real newline after `<!doctype html>` and nothing after `</html>`.

## Click-Triggered Export

- Both modes use an HTML-export modal outside the drawer. `保留编辑` exports the editor entry point; `仅查看` removes it.
- PPT footer uses `HTML / PDF / PPTX`; PDF and PPTX use the local preview service. Single-page footer uses `HTML / 图片 / PDF`; 图片与 PDF use the local preview service and are created only after the user clicks a button.
- `scripts/start_html_report_preview.mjs <report-dir> <port>` exposes `POST /api/export`, accepting `{mode, format, html, title}`. It receives an edited DOM snapshot, creates the requested file in `exports/`, and returns a download URL.
- When opened with `file://`, HTML export remains available. PPT PDF uses browser print as a 16:9 fallback; other high-fidelity exports must explain that the report needs to be opened through the localhost preview URL.
