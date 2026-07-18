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


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


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
    return {
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
