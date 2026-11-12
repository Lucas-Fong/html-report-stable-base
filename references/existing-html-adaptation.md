# Existing HTML Adaptation Fast Path

Use this only when the source is already an HTML report and the request says to preserve the current style.

## Goal

Wrap the existing report in the stable shell without redesigning it. Preserve source CSS, visual hierarchy, copy, images, tables, and section order; add only the editor protocol and shell compatibility CSS.

## Fast Path

1. Detect mode from the source structure before asking the user:
   - `single-page`: sticky/top navigation, hero, normal `<main>` flow, repeated sections, no fixed `1440 × 810` slide canvas.
   - `ppt`: fixed 16:9 pages, slide navigation, deck-like sections, or existing PPTX JSON.
2. Output to a deliverable directory containing `index.html`, for example `<output>/report-name/index.html`. Keep any extra named copy only as a convenience; preview scripts require `index.html` in the directory.
3. Preserve source CSS as `customCss`, then add compatibility CSS after it. Keep the single-page base shell's full-width `.report` behavior; use section-local wrappers when a source needs a narrower reading measure, while preserving the chosen navigation mode and drawer avoidance behavior.
4. Split existing long HTML into model sections:
   - Put topbar/hero/chrome in an opening `.report-section`.
   - Convert each source content section into one `.report-section[data-title]`.
   - Preserve final summary and footer as their own sections when present.
5. Mark content systematically:
   - Text: `h1`-`h4`, `p`, `li`, `th`, `td`, captions, labels, section numbers.
   - Shapes: cards, callouts, quote bands, panels, metric containers.
   - Images: real `<img>` only.
   - Tables: keep real `<table>` markup and mark `th` / `td` as text.
6. Preserve source typography without adding global font controls or corner labels:
   - Add `.note` to source footnotes, case metadata, source notes, and low-contrast footer text when it helps source styling.
   - Only metric values get `.metric .value`, `.metric strong`, or `data-ppt-level="metric"`.
   - Do not add invisible typography probes, typography badges, or global metric/body/note size controls.
   - Metric labels and descriptions must remain body text; edit their size through selected-element controls when needed.
7. Keep drawer export controls reachable after edit-mode flows. If custom script closes all accordion groups after saving edits, reopen `浏览与模式` so standalone export QA can switch the full-width navigation modes: `hidden`, `top`, embedded left/right, floating left/right, and dots left/right.

## QA Efficiency

Run checks in this order so cheap failures surface first:

```bash
python <skill-root>/scripts/check_html_report.py <output>/index.html
node <skill-root>/scripts/qa_editor_enhancements.mjs <output>/index.html
node <skill-root>/scripts/qa_html_report.mjs <output>/index.html
node <skill-root>/scripts/qa_preview_export.mjs <output>/index.html
```

If `node` cannot resolve Playwright but the Codex desktop runtime is available, rerun the Node checks with the bundled `NODE_PATH` and bundled Node executable from `codex_app.load_workspace_dependencies`.

Start preview only after QA passes:

```bash
node <skill-root>/scripts/start_html_report_preview.mjs <output> 5300
```

If 5300 is occupied, retry with 5310, 5320, or another nearby free port.

## Common Rework Traps

| Symptom | Fix |
|---|---|
| Preview says `index.html not found` | Generate into a directory whose main file is exactly `index.html`. |
| Right section nav or drawer covers the report | Remove custom full-width `.report` overrides; let base shell reserve side space. |
| Single-page QA misses `指标` or `备注` labels | Add real mappings or an invisible probe for missing levels. |
| Metric text size needs adjustment | Select the specific text element and adjust its font size; do not add a global metric-size control. |
| Export QA times out clicking nav style buttons | Ensure `浏览与模式` is visible/reopened after edit mode exits. |
| Preview service port is busy | Retry another port and report the actual URL. |
