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
await page.click('#drawerToggle');
await page.click('#editToggle');

const basics = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.drawer-body > .control-group > .control-group-toggle')];
  return {
    editing: document.body.classList.contains('edit-mode'),
    saveLabel: document.getElementById('editToggle')?.textContent.trim(),
    icons: labels.length > 0 && labels.every(button => button.dataset.moduleIcon),
    lLabels: [...document.querySelectorAll('.control-row > span:first-child')].map(node => node.textContent).filter(text => /^L[1-4]字号$/.test(text)),
    globalTypographyInputs: [...document.querySelectorAll('[data-global-var]')].map(input => ({ type: input.type, min: input.min, max: input.max })),
    reset: Boolean(document.querySelector('.group-reset-btn')),
    deleteControl: Boolean(document.getElementById('deleteSelectedElement')),
  };
});
if (basics.editing && basics.saveLabel === '保存修改') ok('edit toggle uses 编辑模式 / 保存修改');
else fail(`edit toggle state failed: ${JSON.stringify(basics)}`);
if (basics.icons) ok('all drawer modules include an icon'); else fail('drawer module icon is missing');
if (basics.lLabels.length === 4) ok('global typography uses L1-L4 labels'); else fail(`L-level labels missing: ${JSON.stringify(basics.lLabels)}`);
if (basics.globalTypographyInputs.every(input => input.type === 'number' && !input.min && !input.max)) ok('global typography uses unconstrained numeric inputs');
else fail(`global typography inputs must be numeric fields: ${JSON.stringify(basics.globalTypographyInputs)}`);
if (basics.reset && basics.deleteControl) ok('reset and delete controls are available'); else fail(`editor commands missing: ${JSON.stringify(basics)}`);

const hexColor = await page.evaluate(() => {
  const text = document.querySelector('[data-editable-element="text"]');
  if (!text) return { skipped: true };
  window.HTMLReportEditor.selectElement(text);
  const input = document.querySelector('[data-color-target="elementColor"]');
  if (!input) return { missing: true };
  input.value = '#FFFFFF';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { color: getComputedStyle(text).color, value: input.value };
});
if (hexColor.skipped) ok('HEX color input skipped: no text element');
else if (hexColor.color === 'rgb(255, 255, 255)' && hexColor.value === '#FFFFFF') ok('HEX color input applies pasted colors');
else fail(`HEX color input failed: ${JSON.stringify(hexColor)}`);

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
    exports: [...document.querySelectorAll('.export-actions button')].map(button => button.id),
    sameRow: (() => {
      const buttons = [...document.querySelectorAll('.export-actions button')];
      return buttons.length === 3 && buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2);
    })(),
  }));
  if (ppt.exports.join(',') === 'downloadHtml,printPdf,exportPpt' && ppt.sameRow) ok('PPT exports are arranged in one row');
  else fail(`PPT export layout failed: ${JSON.stringify(ppt)}`);
}

await page.click('#editToggle');
const exitLabel = await page.locator('#editToggle').textContent();
if (exitLabel?.trim() === '编辑模式') ok('save action exits edit mode'); else fail(`edit mode exit label failed: ${exitLabel}`);
await browser.close();
if (failures.length) process.exit(1);
