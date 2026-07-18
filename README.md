# html-report-stable-base

Codex skill for generating editable HTML reports in two modes:

- `single-page`: a long scrolling HTML report with section navigation and click-triggered HTML, PNG, and PDF export.
- `ppt`: a fixed 16:9 HTML deck with editable objects and click-triggered HTML, PDF, and PPTX export.

The skill keeps a stable editing shell with a right-side style drawer, global typography controls, per-element styling, section or slide navigation, and browser QA scripts.

## Structure

- `SKILL.md`: skill contract and workflow.
- `assets/template/`: single-page and PPT HTML templates plus shared editor assets.
- `scripts/`: builders, validators, QA checks, preview server, and export utilities.
- `fixtures/`: small contract fixtures for editor acceptance checks.
- `references/`: supporting implementation contracts.

## Common Commands

```bash
python scripts/check_html_report.py <output>/index.html
node scripts/qa_html_report.mjs <output>/index.html
node scripts/qa_editor_enhancements.mjs <output>/index.html
node scripts/qa_preview_export.mjs <output>/index.html
node scripts/start_html_report_preview.mjs <output> 5300
```

## Versioning Notes

Track source files, templates, fixtures, and lockfiles. Do not commit `node_modules/`, generated exports, or local report outputs.
