#!/usr/bin/env python3
"""Static contract checks for HTML Report outputs."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


COMMON_TOKENS = [
    'id="styleDrawer"',
    'id="drawerToggle"',
    'id="editToggle"',
    'id="downloadHtml"',
    "--font-family",
    "--body-line-height",
    "--table-cell-padding-y",
    "--table-cell-padding-x",
    "data-editable-element",
    "elementWidth",
    "elementHeight",
    "elementFontSize",
    "elementColor",
    "elementBackground",
    "elementBorderColor",
    "elementBorderWidth",
    "elementBorderRadius",
    "pickRecognitionElement",
    "data-recognition-type",
    "浏览与模式",
    "全局样式",
    "对象编辑",
    "图表数据",
    "修复识别",
    "导出",
    "https://github.com/Lucas-Fong/html-report-stable-base",
    "Lucas Fong",
    "MIT License",
    "© 2026",
    "report-editor.js",
]

FORBIDDEN_GLOBAL_HEADING_TOKENS = [
    *(f"--h{level}-size" for level in range(1, 7)),
    *(f"L{level}字号" for level in range(1, 7)),
    'data-global-var="--metric-size"',
    'data-global-var="--body-size"',
    'data-global-var="--note-size"',
    "<span>指标字号</span>",
    "<span>正文字号</span>",
    "<span>备注字号</span>",
    ".typography-label",
    "typographyLabelForElement",
]

SINGLE_PAGE_NAV_MODES = (
    "hidden",
    "top",
    "embedded",
    "floating",
    "dots",
)

SINGLE_PAGE_NAV_SIDES = ("left", "right")


def fail(message: str) -> None:
    print(f"[FAIL] {message}")


def ok(message: str) -> None:
    print(f"[OK] {message}")


def parse_mode(html: str) -> str | None:
    match = re.search(r'<body[^>]+data-report-mode=["\']([^"\']+)', html, flags=re.I)
    return match.group(1) if match else None


def check_ppt_json(html: str) -> bool:
    match = re.search(
        r'<script[^>]+id=["\']html-pptx-data["\'][^>]*>([\s\S]*?)</script>',
        html,
        flags=re.I,
    )
    if not match:
        fail("PPT mode is missing html-pptx-data")
        return False
    try:
        deck = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        fail(f"html-pptx-data is invalid: {exc}")
        return False
    for index, slide in enumerate(deck.get("slides", []), start=1):
        names = [obj.get("name") for obj in slide.get("objects", []) if obj.get("name")]
        duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
        if duplicates:
            fail(f"slide {index} has duplicate object names: {', '.join(duplicates)}")
            return False
    ok("PPTX JSON parses and object names are unique per slide")
    return True


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: check_html_report.py <index.html>")
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        fail(f"missing file: {path}")
        return 2
    html = path.read_text(encoding="utf-8")
    mode = parse_mode(html)
    failed = False
    if mode not in {"single-page", "ppt"}:
        fail("body must declare data-report-mode as single-page or ppt")
        return 1
    ok(f"report mode: {mode}")

    for token in COMMON_TOKENS:
        if token not in html:
            fail(f"missing common editor token: {token}")
            failed = True
        else:
            ok(token)

    for token in FORBIDDEN_GLOBAL_HEADING_TOKENS:
        if token in html:
            fail(f"global typography control or badge must be absent: {token}")
            failed = True
    if not any(token in html for token in FORBIDDEN_GLOBAL_HEADING_TOKENS):
        ok("global typography controls and badges are absent")

    if "renderer: 'svg'" in html or 'renderer: "svg"' in html:
        fail("ECharts SVG renderer is forced")
        failed = True
    else:
        ok("ECharts canvas renderer is not overridden")

    if mode == "single-page":
        navigation_tokens = ('id="sectionNav"', 'id="sectionNavStyleControl"', 'section-nav-top')
        for token in navigation_tokens:
            if token not in html:
                fail(f"single-page navigation is missing {token}")
                failed = True
            else:
                ok(token)
        for mode_name in SINGLE_PAGE_NAV_MODES:
            token = f'<option value="{mode_name}"'
            if token not in html:
                fail(f"single-page navigation is missing supported mode: {mode_name}")
                failed = True
            else:
                ok(token)
        for side_name in SINGLE_PAGE_NAV_SIDES:
            token = f'<option value="{side_name}"'
            if token not in html:
                fail(f"single-page navigation is missing supported position: {side_name}")
                failed = True
            else:
                ok(token)
        for token in ('id="downloadLongPng"', 'id="downloadLongPdf"'):
            if token not in html:
                fail(f"single-page mode is missing {token}")
                failed = True
            else:
                ok(token)
        section_count = len(re.findall(r'<section\s+class=["\'][^"\']*\breport-section\b', html))
        if section_count < 1:
            fail("single-page report has no report sections")
            failed = True
        else:
            ok(f"report section count: {section_count}")
        forbidden = ["html-pptx-data", 'id="exportPpt"', 'id="nav"', 'class="slide"']
        for token in forbidden:
            if token in html:
                fail(f"single-page mode must not contain {token}")
                failed = True
        if re.search(r"\.slide\s*\{[^}]*1440px", html, flags=re.S):
            fail("single-page mode must not use a fixed 1440px slide canvas")
            failed = True
        else:
            ok("single-page mode uses flowing report layout")
    else:
        slide_count = len(re.findall(r'<section\s+class=["\'][^"\']*\bslide\b', html))
        if slide_count < 1:
            fail("PPT mode has no slides")
            failed = True
        else:
            ok(f"slide count: {slide_count}")
        for token in ('id="deck"', 'id="nav"', 'id="modeToggle"', 'id="exportPpt"', "syncDeckJsonFromDom", "表格设置"):
            if token not in html:
                fail(f"PPT mode is missing {token}")
                failed = True
        if not check_ppt_json(html):
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
