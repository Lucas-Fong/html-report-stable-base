# PPTX JSON Contract v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PPT 模式从完整 JSON v2 合同生成原生可编辑 PPTX，避免以浏览器 CSS 反推对象排版。

**Architecture:** 新增 `pptxContractVersion: 2`。HTML 仅以 `data-pptx-name` 绑定 JSON 对象；JSON 负责 PPTX 的对象类型、1440×810 画布坐标及原生文本 `pt` 样式。预览服务只提交已更新的 v2 JSON；Python 导出器直接写原生对象。复杂 ECharts 与词云转为图片对象。

**Tech Stack:** Python 3、python-pptx、Playwright、Node.js、浏览器内 ECharts。

**Spec:** `docs/superpowers/specs/2026-08-26-pptx-json-contract-v2.md`

## Global Constraints

- `single-page` 行为与其导出链路不得变化。
- 新 v2 JSON 的文字样式使用明确的 `pt`；坐标框使用 1440×810 逻辑画布像素。
- v2 PPTX 导出不得读取 `getBoundingClientRect()` 或 `getComputedStyle()` 来计算对象的坐标、类型或字号。
- 复杂 ECharts 和词云必须作为高分辨率图片导出；原生基础图表继续保持可编辑。
- 不覆盖工作区现有的 `scripts/qa_html_report.mjs` 未提交改动。

---

### Task 1: 为 v2 JSON 增加完整性校验与生成支持

**Files:**
- Modify: `scripts/build_html_report_from_model.py:25-81`
- Modify: `scripts/test_report_modes.py`
- Create: `scripts/test_pptx_contract_v2.py`

**Interfaces:**
- Consumes: PPT model 的 `pptxContractVersion`、每张 slide 的 `html` 与 `objects`。
- Produces: `validate_pptx_v2_slide(slide, index)`，在生成前检查 DOM 名称与对象名称的一一对应。

- [ ] **Step 1: 写出失败测试**

```python
def test_v2_rejects_missing_or_extra_named_objects():
    model = {
        "mode": "ppt", "pptxContractVersion": 2,
        "slides": [{
            "html": '<h1 data-pptx-name="title">Title</h1>',
            "objects": [],
        }],
    }
    with pytest.raises(SystemExit, match="missing PPTX objects: title"):
        validate_model(model)
```

- [ ] **Step 2: 运行失败测试**

Run: `python scripts/test_pptx_contract_v2.py`

Expected: 测试因 v2 校验尚不存在而失败。

- [ ] **Step 3: 实现最小校验**

```python
def validate_pptx_v2_slide(slide: dict, index: int) -> None:
    dom_names = set(re.findall(r'data-pptx-name=["\']([^"\']+)["\']', slide["html"]))
    object_names = {obj["name"] for obj in slide["objects"]}
    if dom_names - object_names:
        raise SystemExit(f"slide {index} missing PPTX objects: {', '.join(sorted(dom_names - object_names))}")
    if object_names - dom_names:
        raise SystemExit(f"slide {index} has unbound PPTX objects: {', '.join(sorted(object_names - dom_names))}")
```

- [ ] **Step 4: 运行通过测试与原有模式测试**

Run: `python scripts/test_pptx_contract_v2.py && python scripts/test_report_modes.py`

Expected: v2 缺失、重复、类型不匹配及合法合同均受检；已有模式测试通过。

- [ ] **Step 5: 提交**

```bash
git add scripts/build_html_report_from_model.py scripts/test_report_modes.py scripts/test_pptx_contract_v2.py
git commit -m "feat: validate PPTX JSON v2 contracts"
```

### Task 2: 让 Python 导出器直接消费 v2 原生对象样式

**Files:**
- Modify: `scripts/export_html_report.py:333-585`
- Modify: `scripts/test_editable_pptx_export.py`

**Interfaces:**
- Consumes: `frame`、`textStyle.fontSizePt`、`textStyle.lineHeightPt`、`textStyle.paddingPt`、table 的行列及单元格样式。
- Produces: `normalize_v2_object(obj)`、`apply_text_style(text_frame, paragraph, style)`；v2 不调用 DOM 同步。

- [ ] **Step 1: 写出失败测试**

```python
def test_v2_metric_uses_points_and_does_not_overlap_label():
    deck = v2_deck(metric_font_pt=22.5, metric_frame_h=36, label_y=278)
    pptx = export_deck(deck)
    slide_xml = read_slide_xml(pptx)
    assert 'name="metric-value"' in slide_xml
    assert 'sz="2250"' in slide_xml
    assert text_frame_bottom("metric-value", slide_xml) <= text_frame_top("metric-label", slide_xml)
```

- [ ] **Step 2: 运行失败测试**

Run: `python scripts/test_editable_pptx_export.py`

Expected: 当前导出器无法读取 `frame` / `textStyle`，或将字号写成错误单位，测试失败。

- [ ] **Step 3: 实现 v2 文本与表格映射**

```python
def v2_frame(obj: dict) -> dict:
    return obj.get("frame") or {key: obj.get(key, 0) for key in ("x", "y", "w", "h")}

def v2_text_style(obj: dict) -> dict:
    style = obj.get("textStyle") or {}
    return {
        "fontSizePt": float(style.get("fontSizePt", obj.get("fontSize", 14))),
        "lineHeightPt": float(style.get("lineHeightPt", style.get("fontSizePt", obj.get("fontSize", 14)) * 1.2)),
        "paddingPt": style.get("paddingPt", {"top": 0, "right": 0, "bottom": 0, "left": 0}),
        "wrap": bool(style.get("wrap", True)),
    }
```

设置文本框四边距、`word_wrap`、段前段后距离、固定行高和顶部锚定；表格使用每个 cell 的 JSON 样式，而不是固定 14pt/默认黑边框。

- [ ] **Step 4: 实现复杂图表图片兜底**

```python
if obj.get("renderMode") == "image" or obj.get("chartType") == "image":
    add_image(slide, {**obj, "type": "image", "src": obj["imageSrc"]}, meta, prs, root)
    return
```

- [ ] **Step 5: 运行导出测试**

Run: `python scripts/test_editable_pptx_export.py`

Expected: v2 文本使用精确 pt、表格保留样式、复杂图表成为图片、基础图表仍为原生图表。

- [ ] **Step 6: 提交**

```bash
git add scripts/export_html_report.py scripts/test_editable_pptx_export.py
git commit -m "feat: export native PPTX from JSON v2"
```

### Task 3: 将浏览器编辑改为命名对象的增量 JSON 更新

**Files:**
- Modify: `assets/template/html-report-ppt-base.html:1206-1402`
- Modify: `assets/template/shared/report-editor.js`
- Modify: `scripts/qa_preview_export.mjs`
- Modify: `scripts/test_pptx_contract_v2.py`

**Interfaces:**
- Consumes: 当前 slide 的 `data-pptx-name` 与 v2 对象。
- Produces: `window.syncDeckJsonFromDom()` 的 v2 快照，以及 `updatePptxObject(name, patch)`。

- [ ] **Step 1: 写出失败测试**

```javascript
const snapshot = await page.evaluate(() => {
  const title = document.querySelector('[data-pptx-name="title"]');
  title.textContent = '已编辑';
  title.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return window.syncDeckJsonFromDom();
});
expect(snapshot.slides[0].objects.find(o => o.name === 'title').text).toBe('已编辑');
expect(snapshot.audit.domGeometryReads).toBe(0);
```

- [ ] **Step 2: 运行失败测试**

Run: `node scripts/qa_preview_export.mjs <v2-demo>/index.html`

Expected: 当前实现会全量读取 DOM 几何，断言失败。

- [ ] **Step 3: 实现增量写回**

```javascript
function updatePptxObject(name, patch) {
  const object = currentPptxSlide().objects.find(item => item.name === name);
  if (!object) throw new Error(`Missing v2 PPTX object: ${name}`);
  Object.assign(object, patch);
  writePptxDeckData(currentPptxDeck());
}
```

文本输入、图片裁剪、尺寸控制和页面隐藏各自调用该函数。v2 的 `syncDeckJsonFromDom` 只复制现有 JSON、过滤隐藏页并重排页码，不读取元素的计算样式或几何。

- [ ] **Step 4: 把 ECharts 物化为图片对象**

```javascript
const instance = echarts.getInstanceByDom(chartElement);
updatePptxObject(name, {
  type: 'image',
  src: instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }),
  renderMode: 'image'
});
```

- [ ] **Step 5: 运行预览导出测试**

Run: `node scripts/qa_preview_export.mjs <v2-demo>/index.html`

Expected: 编辑内容、裁剪图片、隐藏页与 ECharts 图片均进入提交 JSON，且无全量 CSS 同步。

- [ ] **Step 6: 提交**

```bash
git add assets/template/html-report-ppt-base.html assets/template/shared/report-editor.js scripts/qa_preview_export.mjs scripts/test_pptx_contract_v2.py
git commit -m "feat: sync PPTX v2 objects from editor mutations"
```

### Task 4: 迁移体验页并进行视觉验收

**Files:**
- Modify: `fixtures/editor-contract-ppt.json`
- Create: `fixtures/pptx-contract-v2-demo.json`
- Modify: `scripts/qa_editor_enhancements.mjs`
- Create: `scripts/qa_pptx_v2_visual.mjs`
- Create: `/Users/lucasfong/Documents/GEO 月报/html-report-pptx-v2-demo/index.html`

**Interfaces:**
- Consumes: 完整 v2 fixture 与导出的 PPTX。
- Produces: 可下载体验 HTML、PPTX、每页渲染图及视觉验收结果。

- [ ] **Step 1: 写出失败测试**

```javascript
const result = await validatePptxVisual({ htmlPath, pptxPath });
assert.equal(result.overlappingTextFrames.length, 0);
assert.equal(result.unsupportedChartPlaceholders.length, 0);
assert.equal(result.slideCount, 3);
```

- [ ] **Step 2: 运行失败测试**

Run: `node scripts/qa_pptx_v2_visual.mjs <v2-demo>/index.html <v2-demo>/exports/demo.pptx`

Expected: 当前旧 JSON 链路存在文本碰撞或不支持图表占位，测试失败。

- [ ] **Step 3: 编写完整 v2 demo 模型**

每页声明完整的文本、形状、表格、图片、页脚与页码对象；所有 `data-pptx-name` 都有匹配对象。图表对象使用 `renderMode: "image"`。

- [ ] **Step 4: 生成、导出并渲染 PPTX**

Run:

```bash
python scripts/build_html_report_from_model.py fixtures/pptx-contract-v2-demo.json --template assets/template/html-report-ppt-base.html --out /Users/lucasfong/Documents/GEO\ 月报/html-report-pptx-v2-demo/index.html
python scripts/export_html_report.py /Users/lucasfong/Documents/GEO\ 月报/html-report-pptx-v2-demo/index.html --formats pptx --out-dir /Users/lucasfong/Documents/GEO\ 月报/html-report-pptx-v2-demo/exports
```

- [ ] **Step 5: 运行完整回归**

Run:

```bash
python scripts/test_pptx_contract_v2.py
python scripts/test_editable_pptx_export.py
python scripts/test_report_modes.py
node scripts/qa_html_report.mjs <v2-demo>/index.html
node scripts/qa_editor_enhancements.mjs <v2-demo>/index.html
node scripts/qa_preview_export.mjs <v2-demo>/index.html
node scripts/qa_pptx_v2_visual.mjs <v2-demo>/index.html <v2-demo>/exports/index.pptx
```

Expected: 所有测试通过，体验 PPTX 中没有原生文本碰撞，复杂图表以图片呈现。

- [ ] **Step 6: 提交**

```bash
git add fixtures/editor-contract-ppt.json fixtures/pptx-contract-v2-demo.json scripts/qa_editor_enhancements.mjs scripts/qa_pptx_v2_visual.mjs
git commit -m "test: add PPTX JSON v2 visual acceptance"
```
