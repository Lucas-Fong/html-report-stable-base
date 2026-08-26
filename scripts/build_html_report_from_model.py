#!/usr/bin/env python3
"""Build a single-page HTML report or HTML PPT from an explicit-mode model."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from pathlib import Path


VALID_MODES = {"single-page", "ppt"}
PPTX_OBJECT_TYPES = {"text", "shape", "table", "chart", "image"}
ECHARTS_INLINE_SCRIPT = r'\s*<script\s+data-inline-asset=["\']assets/echarts\.min\.js["\']>[\s\S]*?</script>'
ECHARTS_USAGE = re.compile(
    r'(?:data-editable-element=["\']chart|class=["\'][^"\']*\bchart\b|\becharts\b)',
    flags=re.I,
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def pptx_names_in_html(html: str) -> set[str]:
    return set(re.findall(r'data-pptx-name=["\']([^"\']+)["\']', html))


def validate_pptx_v2_slide(slide: dict, index: int) -> None:
    objects = slide.get("objects", [])
    object_names = {obj.get("name") for obj in objects if obj.get("name")}
    dom_names = pptx_names_in_html(slide["html"])
    missing = sorted(dom_names - object_names)
    unbound = sorted(object_names - dom_names)
    if missing:
        raise SystemExit(f"slide {index} missing PPTX objects: {', '.join(missing)}")
    if unbound:
        raise SystemExit(f"slide {index} has unbound PPTX objects: {', '.join(unbound)}")
    for obj in objects:
        name = obj.get("name", "<unnamed>")
        if obj.get("type") not in PPTX_OBJECT_TYPES:
            raise SystemExit(f"slide {index} object {name} has invalid PPTX type")
        frame = obj.get("frame")
        if not isinstance(frame, dict) or not all(key in frame for key in ("x", "y", "w", "h")):
            raise SystemExit(f"slide {index} object {name} must include frame with x/y/w/h")


def validate_model(model: dict) -> str:
    mode = model.get("mode")
    if mode not in VALID_MODES:
        raise SystemExit("model.mode must be confirmed as 'single-page' or 'ppt' before generation")

    items_key = "slides" if mode == "ppt" else "sections"
    items = model.get(items_key)
    if not isinstance(items, list) or not items:
        raise SystemExit(f"model.{items_key} must be a non-empty list for {mode} mode")

    for index, item in enumerate(items, start=1):
        if not item.get("html"):
            raise SystemExit(f"{items_key[:-1]} {index} is missing html")
        if mode == "ppt":
            objects = item.get("objects", [])
            names = [obj.get("name") for obj in objects if obj.get("name")]
            duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
            if duplicates:
                raise SystemExit(f"slide {index} has duplicate object names: {', '.join(duplicates)}")
            if model.get("pptxContractVersion") == 2:
                validate_pptx_v2_slide(item, index)
    return mode


def build_ppt_main(model: dict) -> str:
    rendered = []
    for slide in model["slides"]:
        title = slide.get("title", "未命名")
        classes = slide.get("class", "slide")
        if "slide" not in classes.split():
            classes = f"slide {classes}".strip()
        rendered.append(
            f'    <section class="{classes}" data-title="{title}">\n{slide["html"].strip()}\n    </section>'
        )
    return '  <main class="deck" id="deck">\n' + "\n\n".join(rendered) + "\n  </main>"


def build_single_page_main(model: dict) -> str:
    rendered = []
    for index, section in enumerate(model["sections"], start=1):
        title = section.get("title", f"Section {index}")
        section_id = section.get("id", f"section-{index}")
        classes = section.get("class", "report-section")
        if "report-section" not in classes.split():
            classes = f"report-section {classes}".strip()
        rendered.append(
            f'    <section class="{classes}" id="{section_id}" data-title="{title}">\n{section["html"].strip()}\n    </section>'
        )
    return '  <main class="report" id="report">\n' + "\n\n".join(rendered) + "\n  </main>"


def build_pptx_data(model: dict) -> dict:
    deck = {
        "meta": model.get("meta", {"width": 1440, "height": 810, "fontFamily": "Microsoft YaHei"}),
        "slides": [
            {
                "title": slide.get("title", "未命名"),
                "background": slide.get("background", "#ffffff"),
                "objects": slide.get("objects", []),
            }
            for slide in model["slides"]
        ],
    }
    if model.get("pptxContractVersion") == 2:
        deck["pptxContractVersion"] = 2
    return deck


def replace_once(pattern: str, replacement: str, text: str, label: str) -> str:
    next_text, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"could not replace {label} in template")
    return next_text


def insert_before_last(marker: str, insertion: str, text: str, label: str) -> str:
    head, found, tail = text.rpartition(marker)
    if not found:
        raise SystemExit(f"could not find {label} in template")
    return head + insertion + marker + tail


def inline_shared_editor(html: str, template: Path) -> str:
    source = template.parent / "shared"
    if not source.exists():
        raise SystemExit(f"template shared editor is missing: {source}")
    css = read_text(source / "report-editor.css")
    js = read_text(source / "report-editor.js")
    html = html.replace(
        '<link rel="stylesheet" href="shared/report-editor.css">',
        f'<style data-inline-asset="shared/report-editor.css">\n{css}\n  </style>',
    )
    html = html.replace(
        '<script src="shared/report-editor.js" defer></script>',
        f'<script data-inline-asset="shared/report-editor.js">\n{js}\n  </script>',
    )
    return html


def model_requires_echarts(model: dict) -> bool:
    """Keep the current runtime unless a PPT model explicitly opts out safely."""
    if model.get("requiresEcharts") is not False:
        return True
    content = [slide.get("html", "") for slide in model.get("slides", [])]
    content.append(model.get("customScript", ""))
    return any(ECHARTS_USAGE.search(str(value)) for value in content)


def remove_unused_echarts(html: str, model: dict, mode: str) -> str:
    if mode != "ppt" or model_requires_echarts(model):
        return html
    trimmed, count = re.subn(ECHARTS_INLINE_SCRIPT, "", html, count=1, flags=re.I)
    if count != 1:
        raise SystemExit("PPT template is missing the inline ECharts runtime")
    return trimmed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path, help="Report model JSON with explicit mode")
    parser.add_argument("--template", type=Path, required=True, help="Mode-specific HTML template")
    parser.add_argument("--out", type=Path, required=True, help="Output index.html")
    parser.add_argument("--assets", type=Path, help="Optional content assets directory to copy")
    args = parser.parse_args()

    model = json.loads(read_text(args.model))
    mode = validate_model(model)
    html = read_text(args.template)
    declared_mode = re.search(r'data-report-mode=["\']([^"\']+)', html)
    if not declared_mode or declared_mode.group(1) != mode:
        raise SystemExit(f"template mode must match model.mode={mode}")

    if mode == "ppt":
        html = replace_once(r'  <main class="deck" id="deck">[\s\S]*?</main>', build_ppt_main(model), html, "main deck")
        pptx_json = json.dumps(build_pptx_data(model), ensure_ascii=False, indent=2)
        html = replace_once(
            r'<script id="html-pptx-data" type="application/json">[\s\S]*?</script>',
            f'<script id="html-pptx-data" type="application/json">\n{pptx_json}\n  </script>',
            html,
            "html-pptx-data",
        )
    else:
        html = replace_once(r'  <main class="report" id="report">[\s\S]*?</main>', build_single_page_main(model), html, "main report")
        if "html-pptx-data" in html:
            raise SystemExit("single-page template must not contain html-pptx-data")

    if model.get("title"):
        html = re.sub(r"<title>.*?</title>", f"<title>{model['title']}</title>", html, count=1, flags=re.S)

    custom_css = model.get("customCss", "").strip()
    if custom_css:
        html = insert_before_last("</head>", f'  <style data-report-theme>\n{custom_css}\n  </style>\n', html, "closing head tag")

    custom_script = model.get("customScript", "").strip()
    if custom_script:
        html = insert_before_last("</body>", f'  <script data-report-script>\n{custom_script}\n  </script>\n', html, "closing body tag")

    html = remove_unused_echarts(html, model, mode)
    html = inline_shared_editor(html, args.template)
    write_text(args.out, html)
    if args.assets:
        target = args.out.parent / "assets"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(args.assets, target)

    print(f"[OK] wrote {args.out} ({mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
