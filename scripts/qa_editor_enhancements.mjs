#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const target = process.argv[2];
if (!target) {
  console.error('Usage: qa_editor_enhancements.mjs <index.html>');
  process.exit(2);
}

const failures = [];
const ok = message => console.log(`[OK] ${message}`);
const fail = message => { failures.push(message); console.error(`[FAIL] ${message}`); };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1466, height: 900 } });
page.on('dialog', dialog => dialog.accept());
await page.goto(pathToFileURL(path.resolve(target)).href);
await page.waitForLoadState('networkidle');

const mode = await page.evaluate(() => document.body.dataset.reportMode);
await page.evaluate(() => {
  const levelOne = document.querySelector('[data-ppt-level="h1"], main h1, h1');
  if (levelOne) levelOne.style.fontSize = '62px';
});
await page.click('#drawerToggle');
await page.click('#editToggle');

const basics = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.drawer-body > .control-group > .control-group-toggle')];
  const repairToggle = document.querySelector('.drawer-repair > .control-group > .control-group-toggle');
  const repairGroup = document.querySelector('.drawer-repair > .control-group');
  const repairStyle = repairGroup ? getComputedStyle(repairGroup) : null;
  return {
    editing: document.body.classList.contains('edit-mode'),
    saveLabel: document.getElementById('editToggle')?.textContent.trim(),
    icons: labels.length > 0 && labels.every(button => button.dataset.moduleIcon),
    commonLabels: labels.map(button => button.textContent.trim()),
    repairOutsideCommon: Boolean(repairToggle) && !labels.includes(repairToggle),
    repairIcon: repairToggle?.dataset.moduleIcon,
    repairColor: repairStyle?.borderLeftColor || repairStyle?.borderTopColor,
    lLabels: [...document.querySelectorAll('.control-row > span:first-child')].map(node => node.textContent).filter(text => /^L[1-4]字号$/.test(text)),
    globalTypographyInputs: [...document.querySelectorAll('[data-global-var]')].map(input => ({ type: input.type, min: input.min, max: input.max })),
    reset: Boolean(document.querySelector('.group-reset-btn')),
    deleteControl: Boolean(document.getElementById('deleteSelectedElement')),
  };
});
if (basics.editing && basics.saveLabel === '保存修改') ok('edit toggle uses 编辑模式 / 保存修改');
else fail(`edit toggle state failed: ${JSON.stringify(basics)}`);
if (basics.icons) ok('all drawer modules include an icon'); else fail('drawer module icon is missing');
if (basics.repairOutsideCommon && basics.repairIcon && !basics.commonLabels.includes('修复识别')) ok('repair recognition is fixed outside common drawer groups');
else fail(`repair recognition placement failed: ${JSON.stringify(basics)}`);
if (basics.lLabels.length === 4) ok('global typography uses L1-L4 labels'); else fail(`L-level labels missing: ${JSON.stringify(basics.lLabels)}`);
if (basics.globalTypographyInputs.every(input => input.type === 'number' && !input.min && !input.max)) ok('global typography uses unconstrained numeric inputs');
else fail(`global typography inputs must be numeric fields: ${JSON.stringify(basics.globalTypographyInputs)}`);
if (basics.reset && basics.deleteControl) ok('reset and delete controls are available'); else fail(`editor commands missing: ${JSON.stringify(basics)}`);

const selectStyle = await page.evaluate(() => {
  const select = document.getElementById('elementFontWeight');
  if (!select) return { missing: true };
  const style = getComputedStyle(select);
  return {
    appearance: style.appearance || style.webkitAppearance,
    height: Math.round(parseFloat(style.height)),
    paddingRight: Math.round(parseFloat(style.paddingRight)),
    borderRadius: Math.round(parseFloat(style.borderRadius)),
  };
});
if (!selectStyle.missing && selectStyle.appearance === 'none' && selectStyle.height >= 34 && selectStyle.paddingRight >= 28 && selectStyle.borderRadius >= 6) ok('drawer select controls use styled dropdown appearance');
else fail(`drawer select style failed: ${JSON.stringify(selectStyle)}`);

const computedTypography = await page.evaluate(() => {
  const input = document.querySelector('[data-global-var="--h1-size"]');
  const levelOne = document.querySelector('[data-ppt-level="h1"], main h1, h1');
  return {
    inputValue: input?.value,
    computed: levelOne ? Math.round(parseFloat(getComputedStyle(levelOne).fontSize)) : null,
  };
});
if (computedTypography.inputValue === String(computedTypography.computed)) ok('global typography inputs start from computed page font sizes');
else fail(`global typography input did not reflect computed size: ${JSON.stringify(computedTypography)}`);

const fontFamilyControl = await page.evaluate(() => {
  const input = document.getElementById('fontFamily');
  if (!input) return { missing: true };
  input.value = '"Arial",\n"Microsoft YaHei",\nsans-serif';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    tagName: input.tagName.toLowerCase(),
    rows: input.getAttribute('rows'),
    cssValue: getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim(),
  };
});
if (fontFamilyControl.tagName === 'textarea' && Number(fontFamilyControl.rows) >= 3 && fontFamilyControl.cssValue === '"Arial", "Microsoft YaHei", sans-serif') ok('global font family control supports multiline editing');
else fail(`font family multiline control failed: ${JSON.stringify(fontFamilyControl)}`);

const typographyLabelPlacement = await page.evaluate(() => {
  const target = [...document.querySelectorAll('.editable[data-typography-label], main [data-typography-label]')]
    .find(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 80 && rect.height > 12;
    });
  if (!target) return { skipped: true };
  const rect = target.getBoundingClientRect();
  const labels = [...document.querySelectorAll('.typography-label')];
  const label = labels
    .filter(candidate => candidate.textContent === target.dataset.typographyLabel)
    .map(candidate => ({ element: candidate, rect: candidate.getBoundingClientRect() }))
    .sort((a, b) => Math.abs(a.rect.top - rect.top) - Math.abs(b.rect.top - rect.top))[0];
  if (!label) return { missing: true, target: target.dataset.typographyLabel };
  return {
    targetTop: Math.round(rect.top),
    targetRight: Math.round(rect.right),
    labelTop: Math.round(label.rect.top),
    labelLeft: Math.round(label.rect.left),
    labelWidth: Math.round(label.rect.width),
    labelBottom: Math.round(label.rect.bottom),
  };
});
if (typographyLabelPlacement.skipped) ok('typography label placement skipped: no labelled target');
else if (!typographyLabelPlacement.missing && typographyLabelPlacement.labelBottom <= typographyLabelPlacement.targetTop + 1 && typographyLabelPlacement.labelLeft >= typographyLabelPlacement.targetRight - Math.max(26, typographyLabelPlacement.labelWidth + 64)) ok('typography labels sit outside the top-right of their element');
else fail(`typography label placement failed: ${JSON.stringify(typographyLabelPlacement)}`);

const closeSaves = await page.evaluate(() => {
  const text = document.querySelector('[contenteditable="true"]');
  if (text) text.textContent = `${text.textContent} QA`;
  document.getElementById('closeDrawer').click();
  return {
    drawerOpen: document.getElementById('styleDrawer')?.classList.contains('open'),
    editing: document.body.classList.contains('edit-mode'),
    label: document.getElementById('editToggle')?.textContent.trim(),
    editableCount: document.querySelectorAll('[contenteditable="true"]').length,
    changed: text?.textContent.endsWith(' QA') ?? true,
  };
});
if (!closeSaves.drawerOpen && !closeSaves.editing && closeSaves.label === '编辑模式' && closeSaves.editableCount === 0 && closeSaves.changed) ok('drawer close saves active edits before closing');
else fail(`drawer close did not save edit state: ${JSON.stringify(closeSaves)}`);

await page.click('#drawerToggle');
await page.click('#editToggle');

const hexColor = await page.evaluate(() => {
  const text = document.querySelector('[data-editable-element="text"]');
  if (!text) return { skipped: true };
  window.HTMLReportEditor.selectElement(text);
  const input = document.querySelector('[data-color-target="elementColor"]');
  if (!input) return { missing: true };
  input.value = '#FFFFFF';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const objectOpen = document.querySelector('[data-drawer-intent="object"] > .control-group-toggle')?.getAttribute('aria-expanded') === 'true';
  const tableToggle = document.querySelector('[data-drawer-intent="table"] > .control-group-toggle');
  const chartToggle = document.querySelector('[data-drawer-intent="chart"] > .control-group-toggle');
  return {
    color: getComputedStyle(text).color,
    value: input.value,
    objectOpen,
    tableDisabled: !tableToggle || tableToggle.disabled === true,
    chartDisabled: chartToggle?.disabled === true,
    tableUnavailable: !tableToggle || tableToggle.closest('.control-group')?.classList.contains('is-unavailable'),
    chartUnavailable: chartToggle?.closest('.control-group')?.classList.contains('is-unavailable'),
  };
});
if (hexColor.skipped) ok('HEX color input skipped: no text element');
else if (hexColor.color === 'rgb(255, 255, 255)' && hexColor.value === '#FFFFFF' && hexColor.objectOpen && hexColor.tableDisabled && hexColor.chartDisabled && hexColor.tableUnavailable && hexColor.chartUnavailable) ok('HEX color input applies pasted colors, opens object editing, and disables table/chart editing for text');
else fail(`HEX color input failed: ${JSON.stringify(hexColor)}`);

const recognition = await page.evaluate(reportMode => {
  const host = reportMode === 'ppt' ? document.querySelector('.slide.active-slide') : document.getElementById('report');
  const text = document.createElement('div');
  text.textContent = '未识别文本';
  text.style.padding = '4px';
  host.appendChild(text);
  document.getElementById('pickRecognitionElement')?.click();
  text.click();
  document.querySelector('[data-recognition-type="text"]')?.click();

  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr><td>未识别表格</td></tr></tbody>';
  host.appendChild(table);
  document.getElementById('pickRecognitionElement')?.click();
  table.querySelector('td').click();
  document.querySelector('[data-recognition-type="table"]')?.click();

  return {
    hasModule: Boolean(document.getElementById('pickRecognitionElement')),
    textType: text.dataset.editableElement,
    textEditable: text.classList.contains('editable'),
    textContentEditable: text.getAttribute('contenteditable'),
    textSelected: text.classList.contains('selected-element'),
    tableCellEditable: table.querySelector('td').classList.contains('editable'),
    tableCellContentEditable: table.querySelector('td').getAttribute('contenteditable'),
    tableOpen: document.querySelector('[data-drawer-intent="table"] > .control-group-toggle')?.getAttribute('aria-expanded') === 'true',
    chartOpen: document.querySelector('[data-drawer-intent="chart"] > .control-group-toggle')?.getAttribute('aria-expanded') === 'true',
    status: document.getElementById('recognitionStatus')?.textContent,
  };
}, mode);
if (
  recognition.hasModule &&
  recognition.textType === 'text' &&
  recognition.textEditable &&
  recognition.textContentEditable === 'true' &&
  recognition.textSelected &&
  recognition.tableCellEditable &&
  recognition.tableCellContentEditable === 'true' &&
  (mode === 'ppt' ? recognition.tableOpen : !recognition.chartOpen)
) ok('manual recognition works for text and tables in current mode and opens the matching group when available');
else fail(`manual recognition failed: ${JSON.stringify(recognition)}`);

const chartDataEdit = await page.evaluate(() => {
  if (!window.echarts) return { skipped: true, reason: 'missing echarts' };
  const chartElement = [...document.querySelectorAll('[data-editable-element="chart"]')]
    .find(element => window.echarts.getInstanceByDom(element.matches('.chart') ? element : element.querySelector('.chart')));
  if (!chartElement) return { skipped: true, reason: 'no rendered chart' };
  window.HTMLReportEditor.selectElement(chartElement);
  const editor = document.getElementById('chartDataEditor');
  const button = document.getElementById('applyChartData');
  if (!editor || !button) return { missing: true };
  const payload = JSON.parse(editor.value);
  const before = payload.series?.[0]?.data?.[0];
  if (typeof before !== 'number') return { skipped: true, reason: 'first value is not numeric', payload };
  payload.series[0].data[0] = before + 7;
  editor.value = JSON.stringify(payload, null, 2);
  button.click();
  const chartDom = chartElement.matches('.chart') ? chartElement : chartElement.querySelector('.chart');
  const option = window.echarts.getInstanceByDom(chartDom).getOption();
  return {
    before,
    after: option.series?.[0]?.data?.[0],
    storedData: Boolean(chartDom.dataset.chartData),
    storedOption: Boolean(chartDom.dataset.chartOption),
    chartOpen: document.querySelector('[data-drawer-intent="chart"] > .control-group-toggle')?.getAttribute('aria-expanded') === 'true',
    chartDisabled: document.querySelector('[data-drawer-intent="chart"] > .control-group-toggle')?.disabled === true,
    status: document.getElementById('chartDataStatus')?.textContent,
  };
});
if (chartDataEdit.skipped) ok(`chart data editor skipped: ${chartDataEdit.reason}`);
else if (chartDataEdit.after === chartDataEdit.before + 7 && chartDataEdit.storedData && chartDataEdit.storedOption && chartDataEdit.chartOpen && !chartDataEdit.chartDisabled) ok('ECharts data editor applies and persists chart data');
else fail(`ECharts data editor failed: ${JSON.stringify(chartDataEdit)}`);

if (mode === 'ppt') {
  const modeIcon = await page.evaluate(() => {
    const button = document.getElementById('modeToggle');
    return { className: button.className, before: getComputedStyle(button, '::before').content };
  });
  if (modeIcon.className.includes('mode-toggle-button') && modeIcon.before !== 'none') ok('PPT mode uses a presentation icon');
  else fail(`PPT mode icon is missing: ${JSON.stringify(modeIcon)}`);
}

const typography = await page.evaluate(() => {
  const input = document.querySelector('[data-global-var="--body-size"]');
  const before = document.body.classList.contains('global-typography-active');
  input.value = String(Number(input.value) + 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const activated = document.body.classList.contains('global-typography-active');
  document.querySelector('.group-reset-btn')?.click();
  return { before, activated, reset: !document.body.classList.contains('global-typography-active') };
});
if (!typography.before && typography.activated && typography.reset) ok('global typography applies and reset restores source rules');
else fail(`global typography reset failed: ${JSON.stringify(typography)}`);

const dimensions = await page.evaluate(reportMode => {
  const host = reportMode === 'ppt' ? document.querySelector('.slide.active-slide') : document.getElementById('report');
  const flex = document.createElement('div');
  flex.style.display = 'flex';
  const inline = document.createElement('span');
  inline.dataset.editableElement = 'text';
  inline.className = 'editable';
  inline.style.maxWidth = '40px';
  inline.textContent = '尺寸测试';
  flex.appendChild(inline);
  host.appendChild(flex);
  window.HTMLReportEditor.selectElement(inline);
  const width = document.getElementById('elementWidth');
  width.value = '280';
  width.dispatchEvent(new Event('input', { bubbles: true }));
  return { display: getComputedStyle(inline).display, width: getComputedStyle(inline).width, maxWidth: inline.style.maxWidth, flex: inline.style.flex };
}, mode);
if (dimensions.display !== 'inline' && dimensions.width === '280px' && dimensions.maxWidth === 'none' && dimensions.flex.includes('280px')) ok('element dimensions override inline, flex, and max-width constraints');
else fail(`element dimension compatibility failed: ${JSON.stringify(dimensions)}`);

const deletion = await page.evaluate(reportMode => {
  const host = reportMode === 'ppt' ? document.querySelector('.slide.active-slide') : document.getElementById('report');
  const element = document.createElement('div');
  element.dataset.editableElement = 'text';
  element.dataset.pptxName = 'qa-deletable';
  element.className = 'editable';
  element.textContent = '待删除元素';
  host.appendChild(element);
  window.HTMLReportEditor.selectElement(element);
  document.getElementById('deleteSelectedElement').click();
  return { removed: !document.contains(element), selected: window.HTMLReportEditor.getSelectedElement() === null };
}, mode);
if (deletion.removed && deletion.selected) ok('selected element can be deleted');
else fail(`delete element failed: ${JSON.stringify(deletion)}`);

if (mode === 'ppt') {
  const ppt = await page.evaluate(() => ({
    exports: [...document.querySelectorAll('.export-actions button')]
      .filter(button => getComputedStyle(button).display !== 'none')
      .map(button => button.id),
    sameRow: (() => {
      const buttons = [...document.querySelectorAll('.export-actions button')]
        .filter(button => getComputedStyle(button).display !== 'none');
      return buttons.length === 3 && buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2);
    })(),
  }));
  const expectedPptExports = new Set(['downloadHtml,printPdf,exportPpt', 'downloadHtml,exportImages,printPdf']);
  if (expectedPptExports.has(ppt.exports.join(',')) && ppt.sameRow) ok('PPT exports are arranged in one row');
  else fail(`PPT export layout failed: ${JSON.stringify(ppt)}`);
}

await page.click('#editToggle');
const exitLabel = await page.locator('#editToggle').textContent();
if (exitLabel?.trim() === '编辑模式') ok('save action exits edit mode'); else fail(`edit mode exit label failed: ${exitLabel}`);
await browser.close();
if (failures.length) process.exit(1);
