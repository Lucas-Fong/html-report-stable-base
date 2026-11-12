#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
const chromeCandidates = [
  process.env.HTML_REPORT_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => fs.existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
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
    headingSizeLabels: [...document.querySelectorAll('.control-row > span:first-child')].map(node => node.textContent).filter(text => /^L[1-6]字号$/.test(text)),
    headingSizeControls: [...document.querySelectorAll('[data-global-var^="--h"]')].map(input => input.dataset.globalVar),
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
if (!basics.headingSizeLabels.length && !basics.headingSizeControls.length) ok('global styling does not expose unified heading-size controls');
else fail(`global heading-size controls must be absent: ${JSON.stringify(basics)}`);
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

const headingTypography = await page.evaluate(() => {
  const input = document.querySelector('[data-global-var="--body-line-height"]');
  const levelOne = document.querySelector('[data-ppt-level="h1"], main h1, h1');
  const before = levelOne ? Math.round(parseFloat(getComputedStyle(levelOne).fontSize)) : null;
  input.value = String(Number(input.value) + 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const after = levelOne ? Math.round(parseFloat(getComputedStyle(levelOne).fontSize)) : null;
  document.querySelector('[data-drawer-intent="global"] .group-reset-btn')?.click();
  return {
    headingControl: document.querySelector('[data-global-var^="--h"]')?.dataset.globalVar || null,
    before,
    after,
  };
});
if (!headingTypography.headingControl && headingTypography.before === headingTypography.after) ok('body typography changes do not unify heading sizes');
else fail(`heading typography must remain per-element: ${JSON.stringify(headingTypography)}`);

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

const typographyBadgeState = await page.evaluate(() => ({
  badges: document.querySelectorAll('.typography-label').length,
  labelledElements: document.querySelectorAll('[data-typography-label]').length,
}));
if (typographyBadgeState.badges === 0 && typographyBadgeState.labelledElements === 0) ok('edit mode omits global typography badges in every report mode');
else fail(`typography badges must be absent: ${JSON.stringify(typographyBadgeState)}`);

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

const automaticRecognition = await page.evaluate(async reportMode => {
  const host = reportMode === 'ppt' ? document.querySelector('.slide.active-slide') : document.getElementById('report');
  const card = document.createElement('section');
  card.className = 'card reputation-note-card';
  const label = document.createElement('div');
  label.className = 'root-label category-label';
  label.textContent = '词根类型：8 类已确认';
  const list = document.createElement('ul');
  const item = document.createElement('li');
  item.textContent = '同价位价值感';
  list.appendChild(item);
  const image = document.createElement('img');
  image.alt = '自动识别图片';
  image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3C/svg%3E';
  const chart = document.createElement('div');
  chart.className = 'chart';
  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr><td>自动识别表格</td></tr></tbody>';
  card.append(label, list, image, chart, table);
  host.appendChild(card);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  label.click();
  return {
    card: card.dataset.editableElement,
    label: label.dataset.editableElement,
    item: item.dataset.editableElement,
    image: image.dataset.editableElement,
    chart: chart.dataset.editableElement,
    cellEditable: table.querySelector('td').classList.contains('editable'),
    selected: window.HTMLReportEditor.getSelectedElement() === label,
  };
}, mode);
if (
  automaticRecognition.card === 'shape' &&
  automaticRecognition.label === 'text' &&
  automaticRecognition.item === 'text' &&
  automaticRecognition.image === 'image' &&
  automaticRecognition.chart === 'chart' &&
  automaticRecognition.cellEditable &&
  automaticRecognition.selected
) ok('automatic recognition covers semantic text, cards, images, charts, and tables');
else fail(`automatic recognition failed: ${JSON.stringify(automaticRecognition)}`);

const associatedLabelEditing = await page.evaluate(async reportMode => {
  const host = reportMode === 'ppt' ? document.querySelector('.slide.active-slide') : document.getElementById('report');
  const form = document.createElement('div');
  const input = document.createElement('textarea');
  input.id = 'qa-associated-canvas-field';
  input.dataset.canvasField = '测试画布字段';
  input.value = '测试输入内容';
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = '测试画布标题';
  form.append(label, input);
  host.appendChild(form);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  window.HTMLReportEditor.selectElement(null);
  label.click();
  const editing = {
    labelType: label.dataset.editableElement,
    selected: window.HTMLReportEditor.getSelectedElement() === label,
    objectOpen: document.querySelector('[data-drawer-intent="object"] > .control-group-toggle')?.getAttribute('aria-expanded') === 'true',
  };

  document.getElementById('editToggle')?.click();
  input.blur();
  label.click();
  const browsing = { inputFocused: document.activeElement === input };
  document.getElementById('editToggle')?.click();
  window.HTMLReportEditor.selectElement(null);
  form.remove();
  return { editing, browsing };
}, mode);
if (
  associatedLabelEditing.editing.labelType === 'text' &&
  associatedLabelEditing.editing.selected &&
  associatedLabelEditing.editing.objectOpen
) ok('editing a form label selects it without following its associated field');
else fail(`editable form label selection failed: ${JSON.stringify(associatedLabelEditing)}`);
if (associatedLabelEditing.browsing.inputFocused) ok('form label retains its associated-field behavior outside edit mode');
else fail(`form label default behavior changed outside edit mode: ${JSON.stringify(associatedLabelEditing)}`);

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
  const input = document.querySelector('[data-global-var="--body-line-height"]');
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
