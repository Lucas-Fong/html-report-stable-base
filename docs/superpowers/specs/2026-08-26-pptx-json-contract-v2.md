# PPTX JSON Contract v2 Design

## Goal

Export PPT-mode reports as native editable PPTX files from an explicit, complete JSON contract. Text, shapes, tables, and supported native charts remain editable. Complex ECharts and word clouds are embedded as rendered image objects to preserve visual fidelity.

## Problem

The current PPTX path synchronizes `html-pptx-data` from the live DOM immediately before export. It creates missing objects from elements carrying `data-pptx-name`, overwrites object geometry with `getBoundingClientRect()`, and copies CSS typography into an ambiguously named `fontSize` field. The Python exporter then treats that field as PowerPoint points. This mixes browser pixels, PowerPoint points, browser line boxes, and PowerPoint text-frame defaults, so native text overlaps despite remaining inside the slide canvas.

## Decisions

- JSON is the source of truth for editable PPTX content. PPTX export must not derive geometry, typography, or object type from live DOM/CSS.
- The v2 contract uses a 1440 × 810 logical canvas for frames and explicit PowerPoint points for native text typography.
- Every exportable DOM element has exactly one `data-pptx-name` that maps to exactly one object in the current slide JSON. Names are unique per slide.
- The browser editor updates the corresponding JSON object when the author changes text, image, dimensions, or page visibility. It does not scan the whole DOM before a PPTX export.
- Complex ECharts and word clouds use `image` objects with a high-resolution rendered source. Native `bar`, `column`, `line`, and `pie` chart objects remain supported when a structured chart object is supplied.
- New PPT reports use v2. Existing reports retain an explicit legacy compatibility export path only; it is not a fidelity guarantee.

## Contract

PPT reports retain the existing top-level `mode`, `title`, and `slides` fields. A v2 PPT payload declares `pptxContractVersion: 2` and every slide has complete `objects`.

```json
{
  "mode": "ppt",
  "pptxContractVersion": 2,
  "meta": { "width": 1440, "height": 810, "fontFamily": "Microsoft YaHei" },
  "slides": [
    {
      "title": "概览",
      "objects": [
        {
          "name": "metric-1-value",
          "type": "text",
          "frame": { "x": 70, "y": 230, "w": 260, "h": 36 },
          "text": "01",
          "textStyle": {
            "fontFamily": "Microsoft YaHei",
            "fontSizePt": 22.5,
            "lineHeightPt": 27,
            "bold": true,
            "color": "#2f6f68",
            "align": "left",
            "paddingPt": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
            "wrap": true
          }
        }
      ]
    }
  ]
}
```

`frame` always uses the logical 1440 × 810 canvas. `textStyle.fontSizePt`, `lineHeightPt`, and `paddingPt` are PowerPoint units. Browser rendering may derive CSS pixels from those values (`pt × 4 / 3`), but no PPTX export function may infer points from computed CSS.

### Object types

| Type | Required v2 data | PPTX result |
| --- | --- | --- |
| `text` | `frame`, `text`, `textStyle` | Native text box |
| `shape` | `frame`, shape/fill/line/radius | Native shape |
| `table` | `frame`, columns, rows, column widths, row heights, cell styles | Native PowerPoint table |
| `chart` | `frame`, native chart type, categories, series | Native PowerPoint chart |
| `image` | `frame`, image source, optional crop metadata | Native picture |

An ECharts chart or word cloud that cannot be represented as a native chart is materialized as an `image` object before the JSON is sent to the exporter.

## Data flow

1. The report builder receives complete v2 objects together with HTML markup whose `data-pptx-name` values bind to those objects.
2. The browser renders its PPT page from the report markup and CSS. Its editor mirrors author changes into the named v2 object at the moment of the edit.
3. Page hiding removes a slide from the exported v2 payload and renumbers the remaining footer objects in that payload.
4. The preview service submits the current v2 JSON to the exporter. No `getBoundingClientRect()` or `getComputedStyle()` pass runs during PPTX export.
5. The Python exporter consumes the v2 objects directly, applies explicit text-frame margins, line height, wrap behavior, cell formatting, and image crop data, then writes native PPTX objects.

## Compatibility

- A report that declares `pptxContractVersion: 2` must pass strict object/DOM validation before its PPTX action is enabled.
- A report without v2 uses the existing legacy path only after the user intentionally selects a compatibility export. The UI describes it as compatibility-only and does not present it as WYSIWYG native PPTX.
- The demo fixture and all new PPT models migrate to v2 as part of the first implementation release.

## Validation

The implementation must add these automated checks:

1. A v2 builder/contract test rejects missing, duplicate, mismatched, or unnamed exportable objects.
2. A text metric fixture proves a 30 CSS-pixel browser design maps to `22.5pt` in the v2 contract and does not overlap its label after PPTX render.
3. A table fixture confirms font size, padding, row height, column widths, and border styles survive native PPTX export.
4. An ECharts fixture confirms the exported PPTX contains an image object instead of an unsupported native chart placeholder.
5. Browser QA proves edits update the named v2 object without invoking a full DOM-to-JSON geometry scan.
6. Export QA renders the resulting PPTX and compares it with a browser baseline for the demo fixtures, with overlap detection for unrelated native text frames.

## Non-goals

- Pixel-perfect conversion of arbitrary CSS, unsupported effects, or free-form third-party HTML into editable PowerPoint objects.
- Converting complex ECharts, word clouds, or arbitrary SVG graphics to native editable PowerPoint shapes in this release.
- Changing single-page report export behavior.

## Acceptance criteria

- The shipped demo PPTX keeps each card's numbers, labels, and body text in their intended separate positions with no collisions.
- The report title, text, shapes, table cells, and supported native charts are editable in PowerPoint.
- Complex ECharts and word clouds appear visually intact as images.
- v2 PPTX export does not launch a browser to read DOM geometry or computed styles.
- The default PPTX action for v2 reports is deterministic from the submitted JSON payload.
