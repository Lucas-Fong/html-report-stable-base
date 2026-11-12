#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
const documentImageBuffer = () => Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4HwAAAABJRU5ErkJggg==',
  'base64',
);

const chromeCandidates = [
  process.env.HTML_REPORT_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => fs.existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForLoadState('networkidle');

const mode = await page.evaluate(() => document.body.dataset.reportMode);
if (['single-page', 'ppt'].includes(mode)) ok(`report mode: ${mode}`);
else fail(`invalid report mode: ${mode}`);

if (mode === 'single-page') {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.waitForTimeout(100);
  const defaultSinglePageLayout = await page.evaluate(() => {
    const report = document.getElementById('report').getBoundingClientRect();
    const nav = document.getElementById('sectionNav').getBoundingClientRect();
    return {
      reportWidth: Math.round(report.width),
      viewportWidth: window.innerWidth,
      navPosition: getComputedStyle(document.getElementById('sectionNav')).position,
      defaultTop: document.body.classList.contains('section-nav-top'),
    };
  });
  if (
    Math.abs(defaultSinglePageLayout.reportWidth - defaultSinglePageLayout.viewportWidth) <= 1
    && defaultSinglePageLayout.navPosition === 'fixed'
    && defaultSinglePageLayout.defaultTop
  ) {
    ok('single-page report is full-width with a fixed top navigation');
  } else {
    fail(`single-page full-width top navigation failed: ${JSON.stringify(defaultSinglePageLayout)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(100);
}

const pptScaleBeforeDrawer = mode === 'ppt'
  ? await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale')))
  : null;

await page.click('#drawerToggle');
await page.waitForTimeout(150);
if (await page.evaluate(() => document.body.classList.contains('drawer-open'))) ok('drawer opens');
else fail('drawer did not open');

const offlineExportGuard = await page.evaluate(reportMode => {
  const htmlButton = document.getElementById('downloadHtml');
  const secondaryButton = document.querySelector(reportMode === 'ppt' ? '#printPdf' : '#downloadLongPdf');
  let printFallbackUsed = false;
  window.print = () => { printFallbackUsed = true; };

  htmlButton?.click();
  const dialog = document.getElementById('previewExportRequired');
  const afterHtml = {
    dialogVisible: Boolean(dialog && !dialog.hidden),
    htmlChoiceVisible: Boolean(document.getElementById('htmlExportChoice') && !document.getElementById('htmlExportChoice').hidden),
  };
  dialog?.querySelector('[data-preview-export-required-close]')?.click();
  secondaryButton?.click();
  const dialogVisibleAfterSecondary = Boolean(dialog && !dialog.hidden);
  dialog?.querySelector('[data-preview-export-required-close]')?.click();

  return {
    hint: document.querySelector('[data-preview-export-hint]')?.textContent.trim() || '',
    previewAvailable: window.HTMLReportEditor?.previewServiceAvailable?.(),
    dialogVisibleAfterSecondary,
    printFallbackUsed,
    ...afterHtml,
  };
}, mode);
if (
  offlineExportGuard.previewAvailable === false &&
  offlineExportGuard.hint.includes('本地预览服务') &&
  offlineExportGuard.dialogVisible &&
  !offlineExportGuard.htmlChoiceVisible &&
  offlineExportGuard.dialogVisibleAfterSecondary &&
  !offlineExportGuard.printFallbackUsed
) ok('file preview blocks every export behind a local preview-service prompt');
else fail(`file preview export guard failed: ${JSON.stringify(offlineExportGuard)}`);

if (mode === 'ppt') {
  const drawerScaleState = await page.evaluate(() => {
    const deck = document.getElementById('deck').getBoundingClientRect();
    const drawer = document.getElementById('styleDrawer').getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return {
      deckWidth: deck.width,
      drawerWidth: drawer.width,
      viewport,
      scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale')),
    };
  });
  const expectedDeckWidth = drawerScaleState.viewport.width - drawerScaleState.drawerWidth;
  const expectedScale = Math.min(1, expectedDeckWidth / 1440, drawerScaleState.viewport.height / 810);
  const keepsCanvasInAvailableWidth = Math.abs(drawerScaleState.deckWidth - expectedDeckWidth) <= 1;
  const rescalesCanvas = Math.abs(drawerScaleState.scale - expectedScale) <= 0.002 && drawerScaleState.scale < pptScaleBeforeDrawer;
  if (keepsCanvasInAvailableWidth && rescalesCanvas) ok('open drawer reserves canvas width and rescales the PPT stage');
  else fail(`open drawer scale failed: ${JSON.stringify({ ...drawerScaleState, pptScaleBeforeDrawer, expectedDeckWidth, expectedScale })}`);
}

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
  const navState = await page.evaluate(() => {
    const firstSection = document.querySelector('.report-section:not([data-page-hidden="true"])');
    const originalChapter = firstSection?.dataset.chapter;
    const current = () => ({
      labels: [...document.querySelectorAll('#sectionNav a')].map(link => ({ text: link.textContent, title: link.title })),
      chapterLinks: [...document.querySelectorAll('#sectionNav .section-nav-chapter-link')].map(link => link.dataset.sectionNavChapter),
      sectionLinks: document.querySelectorAll('#sectionNav [data-section-nav-section]').length,
    });
    const initial = current();
    if (firstSection) {
      firstSection.dataset.chapter = '一二三四五六';
      window.HTMLReportEditor.buildSectionNav();
    }
    const probeLabels = current().labels;
    if (firstSection) {
      if (originalChapter === undefined) delete firstSection.dataset.chapter;
      else firstSection.dataset.chapter = originalChapter;
      window.HTMLReportEditor.buildSectionNav();
    }
    return {
      navExists: Boolean(document.getElementById('sectionNav')),
      controlExists: Boolean(document.getElementById('sectionNavStyleControl')),
      sideControlExists: Boolean(document.getElementById('sectionNavSideControl')),
      modes: [...document.querySelector('#sectionNavStyleControl').options].map(option => option.value),
      sides: [...document.querySelector('#sectionNavSideControl').options].map(option => option.value),
      defaultTop: document.body.classList.contains('section-nav-top'),
      defaultLeft: document.body.classList.contains('section-nav-side-left'),
      ...initial,
      probeLabels,
    };
  });
  const expectedModes = ['hidden', 'top', 'embedded', 'floating', 'dots'];
  const hasAllModes = expectedModes.every(modeName => navState.modes.includes(modeName));
  const hasBothSides = ['left', 'right'].every(sideName => navState.sides.includes(sideName));
  const labelsTruncated = navState.labels.length > 0 && navState.labels.every(label => Array.from(label.text).length <= 5 && label.title);
  const probeLabelsTruncated = navState.probeLabels.length > 0 && navState.probeLabels.every(label => Array.from(label.text).length <= 5 && label.title);
  const chaptersAreVisible = navState.chapterLinks.length > 0 && navState.chapterLinks.every(Boolean) && navState.sectionLinks === 0;
  if (navState.navExists && navState.controlExists && navState.sideControlExists && hasAllModes && hasBothSides && navState.defaultTop && navState.defaultLeft && labelsTruncated && probeLabelsTruncated && chaptersAreVisible) ok('single-page navigation renders chapter-only links with separate mode and position controls');
  else fail(`single-page section navigation failed: ${JSON.stringify(navState)}`);

  await page.selectOption('#sectionNavStyleControl', 'top');
  await page.selectOption('#sectionNavSideControl', 'right');
  const navTop = await page.evaluate(() => {
    const nav = document.getElementById('sectionNav');
    const drawer = document.getElementById('styleDrawer').getBoundingClientRect();
    return document.body.classList.contains('section-nav-top')
      && document.querySelector('#sectionNavStyleControl').value === 'top'
      && document.querySelector('#sectionNavSideControl').value === 'right'
      && document.body.classList.contains('section-nav-side-right')
      && getComputedStyle(nav).top === '0px'
      && getComputedStyle(nav).display !== 'none'
      && nav.getBoundingClientRect().right <= drawer.left + 1;
  });
  await page.selectOption('#sectionNavStyleControl', 'embedded');
  await page.selectOption('#sectionNavSideControl', 'left');
  await page.click('#sectionNavCollapse');
  const navEmbeddedLeft = await page.evaluate(() => document.body.classList.contains('section-nav-embedded-left') && document.body.classList.contains('section-nav-side-left') && document.body.classList.contains('section-nav-collapsed') && document.querySelector('#sectionNavStyleControl').value === 'embedded' && document.querySelector('#sectionNavSideControl').value === 'left');
  await page.selectOption('#sectionNavStyleControl', 'floating');
  const navFloatingLeft = await page.evaluate(() => {
    const nav = document.getElementById('sectionNav').getBoundingClientRect();
    return document.body.classList.contains('section-nav-floating-left')
      && document.querySelector('#sectionNavStyleControl').value === 'floating'
      && document.querySelector('#sectionNavSideControl').value === 'left'
      && nav.width <= 112;
  });
  await page.selectOption('#sectionNavStyleControl', 'dots');
  await page.selectOption('#sectionNavSideControl', 'right');
  const navDotsRight = await page.evaluate(() => document.body.classList.contains('section-nav-dots-right') && document.body.classList.contains('section-nav-side-right') && getComputedStyle(document.querySelector('#sectionNav a')).fontSize === '0px');
  await page.selectOption('#sectionNavStyleControl', 'hidden');
  const navHidden = await page.evaluate(() => document.body.classList.contains('section-nav-hidden') && getComputedStyle(document.getElementById('sectionNav')).display === 'none');
  await page.selectOption('#sectionNavStyleControl', 'embedded');
  const navEmbeddedRight = await page.evaluate(() => {
    const nav = document.getElementById('sectionNav').getBoundingClientRect();
    const report = document.getElementById('report').getBoundingClientRect();
    const drawer = document.getElementById('styleDrawer').getBoundingClientRect();
    return document.body.classList.contains('section-nav-embedded-right')
      && !document.body.classList.contains('section-nav-collapsed')
      && document.querySelector('#sectionNavStyleControl').value === 'embedded'
      && document.querySelector('#sectionNavSideControl').value === 'right'
      && nav.width <= 156
      && nav.right <= drawer.left + 1
      && report.right <= nav.left + 1;
  });
  if (navTop && navEmbeddedLeft && navFloatingLeft && navDotsRight && navHidden && navEmbeddedRight) ok('single-page navigation switches top, embedded, floating, dots, and hidden modes');
  else fail(`single-page navigation mode switching failed: ${JSON.stringify({ navTop, navEmbeddedLeft, navFloatingLeft, navDotsRight, navHidden, navEmbeddedRight })}`);

  await page.selectOption('#sectionNavStyleControl', 'top');
  await page.selectOption('#sectionNavSideControl', 'left');
}

await page.click('#editToggle');
await page.waitForTimeout(100);
if (await page.evaluate(() => document.body.classList.contains('edit-mode'))) ok('edit mode opens');
else fail('edit mode did not open');

const pageVisibility = await page.evaluate(reportMode => {
  const input = document.getElementById('currentPageVisible');
  if (!input) return { missing: true };
  if (reportMode === 'single-page') {
    const sections = [...document.querySelectorAll('.report-section')];
    sections[1]?.scrollIntoView({ block: 'start' });
    window.dispatchEvent(new Event('scroll'));
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const snapshot = window.HTMLReportEditor.exportSnapshotHtml();
    const exported = new DOMParser().parseFromString(snapshot, 'text/html');
    return {
      hidden: sections[1]?.dataset.pageHidden === 'true',
      navCount: document.querySelectorAll('#sectionNav a').length,
      visibleSectionCount: [...sections].filter(section => section.dataset.pageHidden !== 'true').length,
      exportSectionCount: exported.querySelectorAll('.report-section').length,
      expectedVisibleSectionCount: sections.length - (sections[1] ? 1 : 0),
      expectedChapterCount: new Set(
        sections.flatMap((section, index) => section.dataset.pageHidden === 'true'
          ? []
          : [(section.dataset.chapter || `第 ${String(index + 1).padStart(2, '0')} 章`).trim()]),
      ).size,
    };
  }
  const slides = [...document.querySelectorAll('.slide')];
  const hiddenSlide = slides[1];
  const initialSlideCount = slides.length;
  const initialFooterCount = slides.filter(slide => slide.querySelector('.page-number')).length;
  const hiddenSlideHasFooter = Boolean(hiddenSlide?.querySelector('.page-number'));
  window.goTo(1);
  input.checked = false;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('editToggle').click();
  const snapshot = window.HTMLReportEditor.exportSnapshotHtml(true);
  const exported = new DOMParser().parseFromString(snapshot, 'text/html');
  const deck = JSON.parse(exported.getElementById('html-pptx-data').textContent);
  return {
    hidden: hiddenSlide?.dataset.pageHidden === 'true',
    navCount: document.querySelectorAll('#nav button').length,
    visiblePageNumbers: [...document.querySelectorAll('.slide:not([data-page-hidden="true"]) .page-number')].map(node => node.textContent.trim()),
    expectedNavCount: initialSlideCount - 1,
    expectedFooterCount: initialFooterCount - (hiddenSlideHasFooter ? 1 : 0),
    expectedPageNumbers: Array.from(
      { length: initialFooterCount - (hiddenSlideHasFooter ? 1 : 0) },
      (_, index) => String(index + 1).padStart(2, '0'),
    ),
    exportSlideCount: exported.querySelectorAll('.slide').length,
    exportJsonSlideCount: deck.slides.length,
  };
}, mode);
if (pageVisibility.missing) {
  fail('current page visibility control is missing');
} else if (mode === 'single-page') {
  if (pageVisibility.hidden && pageVisibility.navCount === pageVisibility.expectedChapterCount && pageVisibility.visibleSectionCount === pageVisibility.expectedVisibleSectionCount && pageVisibility.exportSectionCount === pageVisibility.expectedVisibleSectionCount) ok('single-page visibility filters empty chapter links and hides the section from export');
  else fail(`single-page visibility failed: ${JSON.stringify(pageVisibility)}`);
} else if (pageVisibility.hidden && pageVisibility.navCount === pageVisibility.expectedNavCount && pageVisibility.visiblePageNumbers.join(',') === pageVisibility.expectedPageNumbers.join(',') && pageVisibility.exportSlideCount === pageVisibility.expectedNavCount && pageVisibility.exportJsonSlideCount === pageVisibility.expectedNavCount) {
  ok('PPT visibility hides the page, renumbers visible footers, and filters export slides');
} else {
  fail(`PPT visibility failed: ${JSON.stringify(pageVisibility)}`);
}

const hiddenPageKeyboardNavigation = mode === 'ppt' && !pageVisibility.missing
  ? await page.evaluate(() => {
    const slides = [...document.querySelectorAll('.slide')];
    if (slides.length < 3) return { skipped: true };
    const activeIndex = () => slides.findIndex(slide => slide.classList.contains('active-slide'));
    window.goTo(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const afterPrevious = activeIndex();
    window.goTo(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const afterNext = activeIndex();
    return { afterPrevious, afterNext };
  })
  : null;
if (hiddenPageKeyboardNavigation?.skipped) {
  ok('hidden-page keyboard navigation check skipped: fewer than three slides');
} else if (hiddenPageKeyboardNavigation && hiddenPageKeyboardNavigation.afterPrevious === 0 && hiddenPageKeyboardNavigation.afterNext === 2) {
  ok('PPT keyboard navigation skips hidden pages in both directions');
} else if (hiddenPageKeyboardNavigation) {
  fail(`PPT keyboard navigation did not skip the hidden page: ${JSON.stringify(hiddenPageKeyboardNavigation)}`);
}

if (mode === 'ppt' && !pageVisibility.missing) {
  await page.click('#editToggle');
  await page.evaluate(() => window.goTo(0));
}

const repeatedInitResult = await page.evaluate(() => {
  let resizeEvents = 0;
  const onResize = () => { resizeEvents += 1; };
  window.addEventListener('resize', onResize);
  window.HTMLReportEditor.init();
  window.HTMLReportEditor.init();
  const input = document.querySelector('[data-global-var="--body-line-height"]');
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

const replacementImage = documentImageBuffer();
const replacementInput = page.locator('#replaceImageInput');
if (imageResult.skipped) {
  ok('image replacement check skipped: no image element');
} else if (await replacementInput.count() !== 1) {
  fail('image replacement control is missing');
} else {
  const imageBeforeReplacement = await page.evaluate(() => {
    const image = document.querySelector('[data-editable-element="image"]');
    const style = getComputedStyle(image);
    return {
      src: image.getAttribute('src'),
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      width: style.width,
      height: style.height,
    };
  });
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#replaceImageTrigger'),
  ]);
  await fileChooser.setFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: replacementImage,
  });
  const cropDialogState = await page.waitForFunction(() => {
    const dialog = document.getElementById('imageCropDialog');
    return dialog && !dialog.hidden;
  }, null, { timeout: 1200 }).then(async () => page.evaluate(() => {
    const dialog = document.getElementById('imageCropDialog');
    const image = document.querySelector('[data-editable-element="image"]');
    const preview = document.getElementById('imageCropPreview');
    const rect = image.getBoundingClientRect();
    return {
      open: Boolean(dialog && !dialog.hidden),
      sourceUnchanged: image.getAttribute('src') === dialog.dataset.originalSrc,
      cropAspect: Number(dialog.dataset.cropAspect),
      displayAspect: rect.width / rect.height,
      previewExists: Boolean(preview),
    };
  })).catch(() => null);
  if (!cropDialogState || !cropDialogState.open || !cropDialogState.previewExists || !cropDialogState.sourceUnchanged || Math.abs(cropDialogState.cropAspect - cropDialogState.displayAspect) > 0.02) {
    fail(`image crop dialog failed: ${JSON.stringify(cropDialogState)}`);
  } else {
    ok('image replacement opens a crop dialog that matches the display aspect ratio');
  }
  if (cropDialogState?.open) await page.click('#applyImageCrop');
  await page.waitForFunction(() => document.querySelector('[data-editable-element="image"]')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
  const imageAfterReplacement = await page.evaluate(reportMode => {
    const image = document.querySelector('[data-editable-element="image"]');
    const style = getComputedStyle(image);
    let pptxSource = '';
    if (reportMode === 'ppt') {
      const deck = JSON.parse(document.getElementById('html-pptx-data').textContent);
      pptxSource = deck.slides.flatMap(slide => slide.objects).find(object => object.name === image.dataset.pptxName)?.src || '';
    }
    return {
      src: image.getAttribute('src'),
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      width: style.width,
      height: style.height,
      selected: image.classList.contains('selected-element'),
      pptxSource,
    };
  }, mode);
  const sourceUpdated = imageAfterReplacement.src?.startsWith('data:image/png;base64,');
  const geometryPreserved = ['objectFit', 'objectPosition', 'width', 'height']
    .every(property => imageAfterReplacement[property] === imageBeforeReplacement[property]);
  const pptxPreserved = mode !== 'ppt' || imageAfterReplacement.pptxSource === imageAfterReplacement.src;
  if (sourceUpdated && geometryPreserved && imageAfterReplacement.selected && pptxPreserved) ok('image replacement inlines the selected local file and preserves display geometry');
  else fail(`image replacement failed: ${JSON.stringify({ imageBeforeReplacement, imageAfterReplacement, sourceUpdated, geometryPreserved, pptxPreserved })}`);
}

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
  const input = document.querySelector('[data-global-var="--body-line-height"]');
  if (!input) return null;
  input.value = '1.8';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return getComputedStyle(document.documentElement).getPropertyValue('--body-line-height').trim();
});
if (globalResult === '1.8') ok('global layout control updates CSS variables');
else fail(`global typography failed: ${globalResult}`);

const metricResult = await page.evaluate(() => {
  const value = document.querySelector('.metric .value');
  const label = document.querySelector('.metric .label');
  return {
    controlsAbsent: ['--metric-size', '--body-size', '--note-size'].every(variable => !document.querySelector(`[data-global-var="${variable}"]`)),
    valueExists: Boolean(value),
    labelExists: Boolean(label),
  };
});
if (metricResult.controlsAbsent) ok('drawer omits global metric, body, and note font controls');
else fail(`metric typography failed: ${JSON.stringify(metricResult)}`);

const typographyBadges = await page.evaluate(() => ({
  badges: document.querySelectorAll('.typography-label').length,
  labelledElements: document.querySelectorAll('[data-typography-label]').length,
}));
if (typographyBadges.badges === 0 && typographyBadges.labelledElements === 0) ok('edit mode omits global typography badges');
else fail(`typography badges must be absent: ${JSON.stringify(typographyBadges)}`);

if (mode === 'single-page') {

  const levelIsolation = await page.evaluate(() => {
    document.querySelectorAll('main [data-editable-element="text"]').forEach(element => {
      element.style.fontSize = '';
    });
    const h1 = document.querySelector('main h1');
    const h2 = document.querySelector('main h2');
    const h3 = document.querySelector('main h3');
    const h4 = document.querySelector('main h4');
    const fontControlsAbsent = ['--body-size', '--note-size', '--metric-size'].every(variable => !document.querySelector(`[data-global-var="${variable}"]`));
    return {
      fontControlsAbsent,
      headingsPresent: [h1, h2, h3, h4].every(Boolean),
      headingControlAbsent: !document.querySelector('[data-global-var^="--h"]'),
    };
  });
  if (levelIsolation.fontControlsAbsent && levelIsolation.headingsPresent && levelIsolation.headingControlAbsent) ok('single-page drawer keeps typography levels editable per element only');
  else fail(`single-page typography control mapping failed: ${JSON.stringify(levelIsolation)}`);

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

} else if (mode === 'ppt') {
  const pptState = await page.evaluate(() => ({
    slides: document.querySelectorAll('section.slide').length,
    nav: Boolean(document.getElementById('nav')),
    pptxData: Boolean(document.getElementById('html-pptx-data')),
    scale: getComputedStyle(document.documentElement).getPropertyValue('--stage-scale').trim(),
  }));
  if (pptState.slides > 0 && pptState.nav && pptState.pptxData && Number(pptState.scale) > 0) ok('PPT canvas, navigation, and PPTX contract remain available');
  else fail(`PPT contract failed: ${JSON.stringify(pptState)}`);
  const renderedSlides = await page.evaluate(() => ({
    activeIndex: [...document.querySelectorAll('section.slide')].findIndex(slide => slide.classList.contains('active-slide')),
    visibleIndexes: [...document.querySelectorAll('section.slide')]
      .map((slide, index) => ({ index, display: getComputedStyle(slide).display }))
      .filter(slide => slide.display !== 'none')
      .map(slide => slide.index),
  }));
  if (renderedSlides.visibleIndexes.length === 1 && renderedSlides.visibleIndexes[0] === renderedSlides.activeIndex) ok('PPT mode renders only the current slide');
  else fail(`PPT active-slide rendering failed: ${JSON.stringify(renderedSlides)}`);

  for (const viewport of [{ width: 1191, height: 655 }, { width: 744, height: 756 }]) {
    await page.evaluate(() => {
      if (document.body.classList.contains('drawer-open')) document.getElementById('closeDrawer')?.click();
    });
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      if (document.body.classList.contains('ppt-mode')) document.getElementById('modeToggle')?.click();
    });
    await page.waitForTimeout(120);
    const adaptiveOverflow = await page.evaluate(() => {
      const deck = document.getElementById('deck');
      const navLeft = document.getElementById('nav').getBoundingClientRect().left;
      const visibleSlides = [...document.querySelectorAll('.slide')].filter(slide => getComputedStyle(slide).display !== 'none');
      const responsiveSlides = visibleSlides.filter(slide => !slide.matches('.fidelity-slide, [data-adaptive-fixed-layout="true"]'));
      const overflowingSlides = responsiveSlides
        .filter(slide => slide.scrollWidth > slide.clientWidth + 1)
        .map(slide => ({ title: slide.dataset.title || '', width: slide.clientWidth, contentWidth: slide.scrollWidth }));
      const navOverlaps = responsiveSlides
        .filter(slide => slide.getBoundingClientRect().right > navLeft + 1)
        .map(slide => ({ title: slide.dataset.title || '', slideRight: Math.round(slide.getBoundingClientRect().right) }));
      return {
        adaptive: document.body.classList.contains('adaptive-mode'),
        viewportWidth: window.innerWidth,
        deckWidth: deck.clientWidth,
        deckContentWidth: deck.scrollWidth,
        responsiveSlideCount: responsiveSlides.length,
        fixedCanvasSlideCount: visibleSlides.length - responsiveSlides.length,
        overflowingSlides,
        navLeft: Math.round(navLeft),
        navOverlaps,
      };
    });
    if (adaptiveOverflow.responsiveSlideCount === 0) {
      ok(`adaptive overflow reflow check skipped at ${viewport.width}px for explicitly fixed-canvas slides`);
    } else if (
      adaptiveOverflow.adaptive
      && adaptiveOverflow.deckContentWidth <= adaptiveOverflow.deckWidth + 1
      && adaptiveOverflow.overflowingSlides.length === 0
      && adaptiveOverflow.navOverlaps.length === 0
    ) ok(`adaptive browsing has no horizontal overflow at ${viewport.width}px`);
    else fail(`adaptive browsing overflows at ${viewport.width}px: ${JSON.stringify(adaptiveOverflow)}`);
    await page.evaluate(() => {
      if (document.body.classList.contains('adaptive-mode')) document.getElementById('modeToggle')?.click();
    });
  }
}

if (keepScreenshots) await page.screenshot({ path: path.join(path.dirname(htmlPath), `qa-${mode}.png`), fullPage: mode === 'single-page' });
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} QA check(s) failed.`);
  process.exit(1);
}
console.log('\n[OK] HTML Report browser QA passed');
