#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) {
  console.error('Usage: qa_html_report.mjs <index.html> [--screenshots]');
  process.exit(2);
}

const keepScreenshots = process.argv.includes('--screenshots');
const htmlPath = path.resolve(target);
const failures = [];
const fail = message => { failures.push(message); console.error(`[FAIL] ${message}`); };
const ok = message => console.log(`[OK] ${message}`);

async function exportStandalone(page, browser, outputName = 'single.html') {
  const exportAction = async () => {
    await page.click('#downloadHtml');
    const viewChoice = page.locator('[data-html-export-mode="view"]');
    if (await viewChoice.count()) await viewChoice.click();
  };
  const [download] = await Promise.all([page.waitForEvent('download'), exportAction()]);
  const exportedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'html-report-qa-')), outputName);
  await download.saveAs(exportedPath);
  const exported = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await exported.goto(pathToFileURL(exportedPath).href);
  await exported.waitForLoadState('networkidle');
  return exported;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForLoadState('networkidle');

const mode = await page.evaluate(() => document.body.dataset.reportMode);
if (['single-page', 'ppt'].includes(mode)) ok(`report mode: ${mode}`);
else fail(`invalid report mode: ${mode}`);

if (mode === 'single-page') {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.waitForTimeout(100);
  const defaultNavBoundary = await page.evaluate(() => {
    const report = document.getElementById('report').getBoundingClientRect();
    const nav = document.getElementById('sectionNav').getBoundingClientRect();
    return {
      reportLeft: Math.round(report.left),
      reportRight: Math.round(report.right),
      navLeft: Math.round(nav.left),
      navRight: Math.round(nav.right),
      navDisplay: getComputedStyle(document.getElementById('sectionNav')).display,
    };
  });
  if (defaultNavBoundary.navDisplay === 'none' || defaultNavBoundary.reportRight <= defaultNavBoundary.navLeft || defaultNavBoundary.navRight <= defaultNavBoundary.reportLeft) {
    ok('default single-page section navigation does not cover the report');
  } else {
    fail(`default single-page section navigation overlaps the report: ${JSON.stringify(defaultNavBoundary)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(100);
}

await page.click('#drawerToggle');
await page.waitForTimeout(150);
if (await page.evaluate(() => document.body.classList.contains('drawer-open'))) ok('drawer opens');
else fail('drawer did not open');

const accordionInitialState = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('.drawer-body > .control-group')];
  const visibleGroups = groups.filter(group => !group.hidden);
  const hiddenElementGroups = groups.filter(group => group.matches('.element-control-group[hidden]'));
  return {
    visibleCount: visibleGroups.length,
    allVisibleCollapsed: visibleGroups.every(group => {
      const toggle = group.querySelector(':scope > .control-group-toggle');
      const content = group.querySelector(':scope > .control-group-content');
      return toggle?.getAttribute('aria-expanded') === 'false' && content?.hidden === true && !group.classList.contains('is-open');
    }),
    hiddenElementGroupsStayHidden: hiddenElementGroups.every(group => group.hidden && getComputedStyle(group).display === 'none'),
  };
});
if (accordionInitialState.visibleCount > 1 && accordionInitialState.allVisibleCollapsed) ok('visible accordion groups start collapsed');
else fail(`accordion initial state failed: ${JSON.stringify(accordionInitialState)}`);
if (accordionInitialState.hiddenElementGroupsStayHidden) ok('hidden element control groups remain hidden after accordion setup');
else fail(`hidden element control groups became visible: ${JSON.stringify(accordionInitialState)}`);

const accordionToggles = page.locator('.drawer-body > .control-group:not([hidden]) > .control-group-toggle');
const accordionToggleCount = await accordionToggles.count();
if (accordionToggleCount > 1) {
  await accordionToggles.nth(0).click();
  const firstOpenState = await page.evaluate(() => [...document.querySelectorAll('.drawer-body > .control-group:not([hidden])')].map(group => ({
    expanded: group.querySelector(':scope > .control-group-toggle')?.getAttribute('aria-expanded'),
    contentHidden: group.querySelector(':scope > .control-group-content')?.hidden,
  })));
  await accordionToggles.nth(1).click();
  const secondOpenState = await page.evaluate(() => [...document.querySelectorAll('.drawer-body > .control-group:not([hidden])')].map(group => ({
    expanded: group.querySelector(':scope > .control-group-toggle')?.getAttribute('aria-expanded'),
    contentHidden: group.querySelector(':scope > .control-group-content')?.hidden,
  })));
  const firstOnlyOpen = firstOpenState[0]?.expanded === 'true' && firstOpenState[0]?.contentHidden === false && firstOpenState.slice(1).every(state => state.expanded === 'false' && state.contentHidden === true);
  const secondOnlyOpen = secondOpenState[1]?.expanded === 'true' && secondOpenState[1]?.contentHidden === false && secondOpenState.every((state, index) => index === 1 || (state.expanded === 'false' && state.contentHidden === true));
  if (firstOnlyOpen && secondOnlyOpen) ok('accordion clicks keep visible groups mutually exclusive and aria-expanded synchronized');
  else fail(`accordion click state failed: ${JSON.stringify({ firstOpenState, secondOpenState })}`);

  await page.evaluate(() => {
    const group = document.createElement('div');
    group.className = 'control-group';
    group.innerHTML = '<h4>动态分组</h4><span>动态内容</span>';
    document.querySelector('.drawer-body').appendChild(group);
    window.HTMLReportEditor.initAccordionGroups();
  });
  const dynamicToggle = page.locator('.drawer-body > .control-group > .control-group-toggle').filter({ hasText: '动态分组' });
  await dynamicToggle.click();
  await accordionToggles.nth(0).click();
  const dynamicAccordionState = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.drawer-body > .control-group')];
    const dynamicGroup = groups.find(group => group.querySelector(':scope > .control-group-toggle')?.textContent === '动态分组');
    const firstVisibleGroup = groups.find(group => !group.hidden);
    const hiddenElementGroups = groups.filter(group => group.matches('.element-control-group[hidden]'));
    return {
      firstExpanded: firstVisibleGroup?.querySelector(':scope > .control-group-toggle')?.getAttribute('aria-expanded'),
      dynamicExpanded: dynamicGroup?.querySelector(':scope > .control-group-toggle')?.getAttribute('aria-expanded'),
      dynamicContentHidden: dynamicGroup?.querySelector(':scope > .control-group-content')?.hidden,
      hiddenElementGroupsStayHidden: hiddenElementGroups.every(group => group.hidden && getComputedStyle(group).display === 'none'),
    };
  });
  if (dynamicAccordionState.firstExpanded === 'true' && dynamicAccordionState.dynamicExpanded === 'false' && dynamicAccordionState.dynamicContentHidden && dynamicAccordionState.hiddenElementGroupsStayHidden) ok('dynamic accordion groups join the global mutually exclusive set');
  else fail(`dynamic accordion state failed: ${JSON.stringify(dynamicAccordionState)}`);
} else {
  fail(`expected at least two visible accordion groups, found ${accordionToggleCount}`);
}

if (mode === 'single-page') {
  const drawerBoundary = await page.evaluate(() => {
    const report = document.getElementById('report').getBoundingClientRect();
    const drawer = document.getElementById('styleDrawer').getBoundingClientRect();
    return {
      reportRight: Math.round(report.right),
      drawerLeft: Math.round(drawer.left),
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  if (drawerBoundary.reportRight <= drawerBoundary.drawerLeft && drawerBoundary.pageOverflow <= 0) {
    ok('open drawer does not cover the single-page report');
  } else {
    fail(`open drawer overlaps the report: ${JSON.stringify(drawerBoundary)}`);
  }
}

if (mode === 'single-page') {
  const navState = await page.evaluate(() => ({
    navExists: Boolean(document.getElementById('sectionNav')),
    controlExists: Boolean(document.getElementById('sectionNavStyleControl')),
    styles: [...document.querySelectorAll('[data-section-nav-style]')].map(button => button.dataset.sectionNavStyle),
    defaultRight: document.body.classList.contains('section-nav-right'),
    labels: [...document.querySelectorAll('#sectionNav a')].map(link => ({ text: link.textContent, title: link.title })),
  }));
  const hasThreeStyles = ['hidden', 'left', 'right'].every(style => navState.styles.includes(style));
  const labelsTruncated = navState.labels.length > 0 && navState.labels.every(label => Array.from(label.text).length <= 6 && label.title);
  if (navState.navExists && navState.controlExists && hasThreeStyles && navState.defaultRight && labelsTruncated) ok('single-page section navigation renders with right default and six-character labels');
  else fail(`single-page section navigation failed: ${JSON.stringify(navState)}`);

  await page.click('[data-section-nav-style="left"]');
  const navLeft = await page.evaluate(() => document.body.classList.contains('section-nav-left') && document.querySelector('[data-section-nav-style="left"]').classList.contains('active'));
  await page.click('[data-section-nav-style="hidden"]');
  const navHidden = await page.evaluate(() => document.body.classList.contains('section-nav-hidden') && getComputedStyle(document.getElementById('sectionNav')).display === 'none');
  await page.click('[data-section-nav-style="right"]');
  const navRight = await page.evaluate(() => document.body.classList.contains('section-nav-right') && document.querySelector('[data-section-nav-style="right"]').classList.contains('active'));
  if (navLeft && navHidden && navRight) ok('single-page section navigation switches hidden/left/right modes');
  else fail(`single-page section navigation mode switching failed: ${JSON.stringify({ navLeft, navHidden, navRight })}`);
}

await page.click('#editToggle');
await page.waitForTimeout(100);
if (await page.evaluate(() => document.body.classList.contains('edit-mode'))) ok('edit mode opens');
else fail('edit mode did not open');

const repeatedInitResult = await page.evaluate(() => {
  let resizeEvents = 0;
  const onResize = () => { resizeEvents += 1; };
  window.addEventListener('resize', onResize);
  window.HTMLReportEditor.init();
  window.HTMLReportEditor.init();
  const input = document.querySelector('[data-global-var="--body-size"]');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  window.removeEventListener('resize', onResize);
  return resizeEvents;
});
if (repeatedInitResult === 1) ok('repeated editor initialization does not duplicate control listeners');
else fail(`repeated editor initialization duplicated control listeners: ${repeatedInitResult} resize events`);

const editableCount = await page.locator('[contenteditable="true"]').count();
if (editableCount > 0) ok(`editable text count: ${editableCount}`);
else fail('edit mode has no editable text');

const independentTextResult = await page.evaluate(() => {
  const texts = [...document.querySelectorAll('[data-editable-element="text"]')];
  if (texts.length < 2) return { skipped: true };
  const before = getComputedStyle(texts[1]).fontSize;
  texts[0].click();
  const input = document.getElementById('elementFontSize');
  input.value = '31';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { first: getComputedStyle(texts[0]).fontSize, secondBefore: before, secondAfter: getComputedStyle(texts[1]).fontSize };
});
if (independentTextResult.skipped) ok('independent text check skipped: fewer than two text elements');
else if (independentTextResult.first === '31px' && independentTextResult.secondBefore === independentTextResult.secondAfter) ok('text style change only affects selected element');
else fail(`independent text style failed: ${JSON.stringify(independentTextResult)}`);

const shapeResult = await page.evaluate(() => {
  const shape = document.querySelector('[data-editable-element="shape"]');
  if (!shape) return { skipped: true };
  shape.click();
  const background = document.getElementById('elementBackground');
  background.value = '#123456';
  background.dispatchEvent(new Event('input', { bubbles: true }));
  const radius = document.getElementById('elementBorderRadius');
  radius.value = '17';
  radius.dispatchEvent(new Event('input', { bubbles: true }));
  return { background: getComputedStyle(shape).backgroundColor, radius: getComputedStyle(shape).borderRadius };
});
if (shapeResult.skipped) ok('shape check skipped: no shape element');
else if (shapeResult.background === 'rgb(18, 52, 86)' && shapeResult.radius === '17px') ok('shape fill and radius update');
else fail(`shape style failed: ${JSON.stringify(shapeResult)}`);

const imageResult = await page.evaluate(() => {
  const image = document.querySelector('[data-editable-element="image"]');
  if (!image) return { skipped: true };
  image.click();
  const width = document.getElementById('elementWidth');
  width.value = '321';
  width.dispatchEvent(new Event('input', { bubbles: true }));
  return { width: getComputedStyle(image).width };
});
if (imageResult.skipped) ok('image check skipped: no image element');
else if (imageResult.width === '321px') ok('image width updates');
else fail(`image size failed: ${JSON.stringify(imageResult)}`);

const chartResult = await page.evaluate(() => {
  const chart = document.querySelector('[data-editable-element="chart"]');
  if (!chart) return { skipped: true };
  const realInstance = window.echarts?.getInstanceByDom?.(chart);
  let fakeResizeCount = 0;
  if (!realInstance) {
    if (!window.echarts) window.echarts = {};
    window.echarts.getInstanceByDom = () => ({ resize() { fakeResizeCount += 1; } });
  }
  chart.click();
  const height = document.getElementById('elementHeight');
  height.value = '333';
  height.dispatchEvent(new Event('input', { bubbles: true }));
  const canvas = chart.querySelector('canvas');
  const canvasMatches = canvas ? Math.abs(canvas.getBoundingClientRect().height - chart.getBoundingClientRect().height) < 2 : false;
  return { height: getComputedStyle(chart).height, resized: realInstance ? canvasMatches : fakeResizeCount > 0 };
});
if (chartResult.skipped) ok('chart check skipped: no chart element');
else if (chartResult.height === '333px' && chartResult.resized) ok('chart size updates and ECharts resizes');
else fail(`chart resize failed: ${JSON.stringify(chartResult)}`);

const globalResult = await page.evaluate(() => {
  const input = document.querySelector('[data-global-var="--body-size"]');
  if (!input) return null;
  input.value = '19';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return getComputedStyle(document.documentElement).getPropertyValue('--body-size').trim();
});
if (globalResult === '19px') ok('global typography control updates CSS variables');
else fail(`global typography failed: ${globalResult}`);

const metricResult = await page.evaluate(() => {
  const input = document.querySelector('[data-global-var="--metric-size"]');
  const value = document.querySelector('.metric .value');
  const label = document.querySelector('.metric .label');
  if (!input || !value || !label) return { skipped: true };
  const h3 = document.querySelector('h3:not(.metric h3)');
  const body = document.querySelector('p:not(.metric p)');
  const before = {
    h3: h3 ? getComputedStyle(h3).fontSize : null,
    body: body ? getComputedStyle(body).fontSize : null,
    label: getComputedStyle(label).fontSize,
  };
  input.value = '40';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    value: getComputedStyle(value).fontSize,
    label: getComputedStyle(label).fontSize,
    labelBefore: before.label,
    valueLevel: value.dataset.typographyLabel,
    labelLevel: label.dataset.typographyLabel,
    h3Unchanged: !h3 || getComputedStyle(h3).fontSize === before.h3,
    bodyUnchanged: !body || getComputedStyle(body).fontSize === before.body,
  };
});
if (metricResult.skipped) ok('metric typography check skipped: no metric cards');
else if (metricResult.value === '40px' && metricResult.label === metricResult.labelBefore && (mode !== 'ppt' || (metricResult.valueLevel === '指标' && metricResult.labelLevel === '正文')) && metricResult.h3Unchanged && metricResult.bodyUnchanged) ok('only metric values use the independent metric typography level');
else fail(`metric typography failed: ${JSON.stringify(metricResult)}`);

if (mode === 'single-page') {
  const typographyLabels = await page.evaluate(() => {
    window.HTMLReportEditor.refreshTypographyLabels();
    return [...document.querySelectorAll('.typography-label')].map(label => label.textContent);
  });
  const requiredLevels = ['L1', 'L2', 'L3', 'L4', '指标', '正文', '备注'];
  const missingLevels = requiredLevels.filter(level => !typographyLabels.includes(level));
  if (missingLevels.length === 0) ok('single-page edit mode displays all seven typography labels');
  else fail(`single-page typography labels missing: ${JSON.stringify({ missingLevels, typographyLabels })}`);

  const levelIsolation = await page.evaluate(() => {
    document.querySelectorAll('main [data-editable-element="text"]').forEach(element => {
      element.style.fontSize = '';
    });
    const h1 = document.querySelector('main h1');
    const h2 = document.querySelector('main h2');
    const h3 = document.querySelector('main h3');
    const h4 = document.querySelector('main h4');
    const body = document.querySelector('main p:not(.note):not(.metric p)');
    const note = document.querySelector('main .note');
    const metric = document.querySelector('main .metric .value');
    const before = {
      h1: h1 && getComputedStyle(h1).fontSize,
      h2: h2 && getComputedStyle(h2).fontSize,
      h3: h3 && getComputedStyle(h3).fontSize,
      h4: h4 && getComputedStyle(h4).fontSize,
      body: body && getComputedStyle(body).fontSize,
      note: note && getComputedStyle(note).fontSize,
      metric: metric && getComputedStyle(metric).fontSize,
    };
    const cases = [
      ['--h1-size', '41', h1, 'h1'],
      ['--h2-size', '35', h2, 'h2'],
      ['--h3-size', '29', h3, 'h3'],
      ['--h4-size', '23', h4, 'h4'],
      ['--body-size', '18', body, 'body'],
      ['--note-size', '15', note, 'note'],
      ['--metric-size', '37', metric, 'metric'],
    ];
    const results = cases.map(([variable, value, element, key]) => {
      const input = document.querySelector(`[data-global-var="${variable}"]`);
      if (!input || !element) return { key, skipped: true };
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { key, size: getComputedStyle(element).fontSize, expected: `${value}px` };
    });
    return {
      results,
      h2NotH1: h2 && getComputedStyle(h2).fontSize !== '41px',
      labelStillBody: document.querySelector('.metric .label') && getComputedStyle(document.querySelector('.metric .label')).fontSize === '18px',
      before,
    };
  });
  const allMatched = levelIsolation.results.every(result => result.skipped || result.size === result.expected);
  if (allMatched && levelIsolation.h2NotH1 && levelIsolation.labelStillBody) ok('single-page global sliders map to the intended typography levels only');
  else fail(`single-page typography slider mapping failed: ${JSON.stringify(levelIsolation)}`);

  const contract = await page.evaluate(() => ({
    reportSections: document.querySelectorAll('.report-section').length,
    pptNav: Boolean(document.getElementById('nav')),
    sectionNav: Boolean(document.getElementById('sectionNav')),
    ppt: Boolean(document.getElementById('exportPpt')),
    pdf: Boolean(document.getElementById('printPdf')),
    pptxData: Boolean(document.getElementById('html-pptx-data')),
  }));
  if (contract.reportSections > 0 && !contract.pptNav && contract.sectionNav && !contract.ppt && !contract.pdf && !contract.pptxData) ok('single-page mode excludes PPT-only UI and data');
  else fail(`single-page contract failed: ${JSON.stringify(contract)}`);

  await page.evaluate(() => {
    const text = document.querySelector('main [data-editable-element="text"]');
    if (text) text.style.setProperty('font-size', '31px', 'important');
  });
  await page.click('#editToggle');

  const exportedStates = {};
  for (const style of ['right', 'left', 'hidden']) {
    await page.click(`[data-section-nav-style="${style}"]`);
    const exported = await exportStandalone(page, browser, `${style}.html`);
    exportedStates[style] = await exported.evaluate(expectedStyle => ({
      drawer: getComputedStyle(document.getElementById('styleDrawer')).display,
      toggle: getComputedStyle(document.getElementById('drawerToggle')).display,
      standalone: document.body.classList.contains('standalone-export'),
      navMode: document.body.classList.contains(`section-nav-${expectedStyle}`),
      navHiddenDisplay: expectedStyle !== 'hidden' || getComputedStyle(document.getElementById('sectionNav')).display === 'none',
      sectionNavItems: [...document.querySelectorAll('#sectionNav a')].map(link => link.textContent),
      visibleTopText: [...document.body.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).map(node => node.textContent.trim()),
      textStyle: getComputedStyle(document.querySelector('[data-editable-element="text"]')).fontSize,
    }), style);
    await exported.close();
  }
  const allExportsClean = Object.values(exportedStates).every(state => (
    state.drawer === 'none' &&
    state.toggle === 'none' &&
    state.standalone &&
    state.navMode &&
    state.navHiddenDisplay &&
    state.sectionNavItems.length > 0 &&
    state.visibleTopText.length === 0
  ));
  if (allExportsClean) ok('standalone HTML hides editor chrome, preserves all section nav modes, and has no leaked top text');
  else fail(`standalone HTML cleanup failed: ${JSON.stringify(exportedStates)}`);
  const allElementStylesPreserved = Object.values(exportedStates).every(state => state.textStyle === '31px');
  if (allElementStylesPreserved) ok('standalone HTML preserves element style edits');
  else fail(`standalone HTML lost element styles: ${JSON.stringify(exportedStates)}`);
} else if (mode === 'ppt') {
  const pptState = await page.evaluate(() => ({
    slides: document.querySelectorAll('section.slide').length,
    nav: Boolean(document.getElementById('nav')),
    pptxData: Boolean(document.getElementById('html-pptx-data')),
    scale: getComputedStyle(document.documentElement).getPropertyValue('--stage-scale').trim(),
  }));
  if (pptState.slides > 0 && pptState.nav && pptState.pptxData && Number(pptState.scale) > 0) ok('PPT canvas, navigation, and PPTX contract remain available');
  else fail(`PPT contract failed: ${JSON.stringify(pptState)}`);
}

if (keepScreenshots) await page.screenshot({ path: path.join(path.dirname(htmlPath), `qa-${mode}.png`), fullPage: mode === 'single-page' });
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} QA check(s) failed.`);
  process.exit(1);
}
console.log('\n[OK] HTML Report browser QA passed');
