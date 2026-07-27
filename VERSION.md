# html-report 变更日志

版本号采用日期 + 序号；每条记录变更范围、动机与影响，便于回滚。

---

## 2026-07-27 · PPTX 导出保真度优化（v1）

**动机**：用户反馈导出的 PPTX 与原始 HTML 在「布局和字体」上差异较大。经排查，PPTX 走的是
「按 `html-pptx-data` JSON 逐对象用 python-pptx 重建」的路径，失真集中在重建端 `scripts/export_html_report.py`。

**根因**（均已定位到代码）：
1. 字号把 px 直接当 pt 写入（`set_run_font` 的 `Pt(font_size_px)`），但几何按 1440px→960pt（13.333in）缩放了 0.667；
   字号没同步缩放，导致全局字体约放大 1.5×，文字溢出文本框、换行错乱。
2. `ppt_font_size` 按 `pptLevel` 硬编码字号（h1=60/h2=28/h3=20/body=14），丢弃 DOM 已采集的真实 `fontSize`，
   用户在抽屉里调过的字号在 PPT 中失效；且缺 h4，各级行为不一致。
3. `add_text` 未清零 python-pptx 文本框默认内边距、未开自动换行、未设行距、多行文本未按 `\n` 拆段。

**本次变更（有意修改旧的既定行为，相关测试同步更新）**：
- `scripts/export_html_report.py`
  - 新增 `px_to_pt(px, meta, prs)`：字号使用与几何一致的缩放系数（slide_width_pt / canvas_width_px）。
  - `ppt_font_size` 改为「真实 `fontSize` 优先，level/role 仅兜底」。
  - 表格改用采集到的 `bodyFontSize` / `headerFontSize`；图表/图片占位文字同步缩放。
  - `add_text` 清零文本框四边内边距、开启 `word_wrap`、`auto_size=NONE`、按 `lineHeight` 设段落行距、
    多行文本按 `\n` 拆分为多段落并统一样式与对齐。
  - 新增 CLI 开关 `--chart-mode native|image`（默认 native）：image 模式用 Playwright 截取图表元素贴入图片，
    追求与 HTML 一致的观感；截图失败时回退 native。图表在 image 模式下不可再在 PPT 内编辑。
- `assets/template/html-report-ppt-base.html`
  - `syncDeckJsonFromDom` / `syncObjectGeometry` 为文本对象增加 `lineHeight`（computed px）采集。
- `scripts/test_editable_pptx_export.py`
  - 更新被旧行为锁死的字号断言（H2/metric/body/furniture）为缩放后的新期望值。

**影响**：导出 PPTX 的字号与版式与 HTML 基本一致；旧的“固定 28/14/12pt”行为不再成立。
**回滚**：`scripts/export_html_report.py.bak` 为改动前备份。
