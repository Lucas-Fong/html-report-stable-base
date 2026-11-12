#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const target = process.argv[2];
if (!target) throw new Error('Usage: qa_preview_export.mjs <index.html>');

const skillRoot = path.resolve(import.meta.dirname, '..');
const htmlPath = path.resolve(target);
const originalRoot = path.dirname(htmlPath);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-report-preview-'));
fs.copyFileSync(htmlPath, path.join(root, 'index.html'));
for (const entry of ['assets', 'shared']) {
  const source = path.join(originalRoot, entry);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(root, entry), { recursive: true });
}
fs.writeFileSync(path.join(root, 'qa-export-image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLNYgAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(path.join(root, 'qa-export-style.css'), '.qa-export-background{background-image:url("qa-export-image.png");min-height:1px}');
const port = 5300 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [path.join(skillRoot, 'scripts', 'start_html_report_preview.mjs'), root, String(port)], { stdio: 'pipe' });
const logs = [];
server.stderr.on('data', chunk => logs.push(chunk.toString()));
const waitForReady = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`preview server did not start: ${logs.join('')}`);
};

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

function assertStandaloneImageAssets(html, label) {
  if (html.includes('qa-export-image.png') || !html.includes('data:image/png;base64,')) {
    throw new Error(`${label} must inline image, srcset, CSS background assets, and JSON image data`);
  }
}

try {
  await waitForReady();
  const snapshot = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const mode = /data-report-mode="([^"]+)"/.exec(snapshot)?.[1];
  const response = await fetch(`http://127.0.0.1:${port}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, format: mode === 'ppt' ? 'pdf' : 'png', html: snapshot, title: '即时导出验收' }),
  });
  const result = await response.json();
  if (!response.ok || !result.downloadUrl || !result.fileName) throw new Error(`export endpoint failed: ${JSON.stringify(result)}`);
  const download = await fetch(`http://127.0.0.1:${port}${result.downloadUrl}`);
  const downloadBuffer = Buffer.from(await download.arrayBuffer());
  if (!download.ok || downloadBuffer.byteLength < 100) throw new Error('generated export download is unavailable');
  const missingImageSnapshot = snapshot.replace(/<\/body>\s*<\/html>\s*$/, '<img src="missing-export-asset.png" alt="missing export asset"></body></html>');
  const missingImageResponse = await fetch(`http://127.0.0.1:${port}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, format: 'png', html: missingImageSnapshot, title: '缺图验收' }),
  });
  const missingImageResult = await missingImageResponse.json();
  if (missingImageResponse.ok || !/图片加载失败/.test(missingImageResult.error || '')) {
    throw new Error(`preview export must reject an unloaded image: ${JSON.stringify(missingImageResult)}`);
  }
  if (mode === 'ppt') {
    const slideCount = (snapshot.match(/<section\b[^>]*\bclass="[^"]*\bslide\b/g) || []).length;
    if (pdfPageCount(downloadBuffer) !== slideCount) throw new Error('PPT PDF export must contain one page per slide');
    if (fs.readdirSync(path.join(root, 'exports')).some(fileName => fileName.endsWith('.pptx'))) {
      throw new Error('PPT PDF export must not pre-generate a PPTX');
    }
    const pngEnabled = /"images"\s*:\s*true/.test(snapshot);
    if (pngEnabled) {
      const pngResponse = await fetch(`http://127.0.0.1:${port}/api/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, format: 'png', html: snapshot, title: '逐页图片验收' }),
      });
      const pngResult = await pngResponse.json();
      if (!pngResponse.ok || pngResult.fileNames?.length !== slideCount || pngResult.downloadUrls?.length !== slideCount) {
        throw new Error(`PPT PNG export must create one image per slide: ${JSON.stringify(pngResult)}`);
      }
      const firstPng = await fetch(`http://127.0.0.1:${port}${pngResult.downloadUrls[0]}`);
      const firstPngBuffer = Buffer.from(await firstPng.arrayBuffer());
      if (!firstPng.ok || firstPngBuffer.readUInt32BE(0) !== 0x89504e47) throw new Error('generated PPT PNG download is unavailable');
    }
  }

  const chromeCandidates = [
    process.env.HTML_REPORT_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const executablePath = chromeCandidates.find(candidate => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1466, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForLoadState('networkidle');
  await page.click('#drawerToggle');
  const ui = await page.evaluate(() => ({
    width: getComputedStyle(document.documentElement).getPropertyValue('--drawer-width').trim(),
    exports: [...document.querySelectorAll('.export-actions button, .drawer-footer [data-export-format]')]
      .filter(button => getComputedStyle(button).display !== 'none')
      .map(button => button.id || button.dataset.exportFormat),
    htmlChoice: Boolean(document.getElementById('htmlExportChoice')),
    htmlChoiceIsModal: document.getElementById('htmlExportChoice')?.getAttribute('role') === 'dialog' && !document.getElementById('htmlExportChoice')?.closest('.style-drawer'),
    previewHint: document.querySelector('[data-preview-export-hint]')?.textContent.trim() || '',
  }));
  if (ui.width !== '320px') throw new Error(`drawer width should be 320px, received ${ui.width}`);
  if (!ui.previewHint.includes('本地预览服务已连接')) throw new Error(`preview export availability hint is missing: ${JSON.stringify(ui)}`);
  const pptExportSets = new Set(['downloadHtml,printPdf,exportPpt', 'downloadHtml,exportImages,printPdf']);
  if (mode === 'ppt' && (!pptExportSets.has(ui.exports.join(',')) || !ui.htmlChoice || !ui.htmlChoiceIsModal)) throw new Error(`PPT export UI contract failed: ${JSON.stringify(ui)}`);
  if (mode === 'single-page' && ui.exports.join(',') !== 'downloadHtml,downloadLongPng,downloadLongPdf') throw new Error(`single export UI contract failed: ${JSON.stringify(ui)}`);
  if (mode === 'single-page' && (!ui.htmlChoice || !ui.htmlChoiceIsModal)) throw new Error(`single HTML export modal is missing: ${JSON.stringify(ui)}`);
  await page.evaluate(async () => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'qa-export-style.css';
    const styleLoaded = new Promise((resolve, reject) => {
      style.addEventListener('load', resolve, { once: true });
      style.addEventListener('error', () => reject(new Error(`QA stylesheet failed to load: ${style.href}`)), { once: true });
    });
    document.head.appendChild(style);
    const host = document.querySelector('.slide.active-slide, #report');
    const image = document.createElement('img');
    image.alt = '独立 HTML 图片资源验收';
    image.src = 'qa-export-image.png';
    image.srcset = 'qa-export-image.png 1x';
    const imageLoaded = new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error(`QA image failed to load: ${image.src}`)), { once: true });
    });
    const background = document.createElement('div');
    background.className = 'qa-export-background';
    host.append(image, background);
    await Promise.all([styleLoaded, imageLoaded]);
  });
  if (mode === 'ppt') {
    const updatedText = `按钮级PDF验收-${Date.now()}`;
    let postedSnapshot = '';
    await page.route('**/api/export', async route => {
      postedSnapshot = route.request().postData() || '';
      await route.continue();
    });
    await page.locator('.slide.active-slide [data-pptx-name][data-editable-element="text"], .slide.active-slide .editable[data-editable-element="text"]').first().evaluate((element, text) => {
      element.textContent = text;
    }, updatedText);
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 120000 }),
      page.click('#printPdf'),
    ]);
    const pdfPath = path.join(os.tmpdir(), `html-report-button-${Date.now()}.pdf`);
    await pdfDownload.saveAs(pdfPath);
    const exportedPdf = fs.readFileSync(pdfPath);
    if (pdfPageCount(exportedPdf) !== await page.locator('.slide').count()) throw new Error('button PDF export must create one PDF page per slide');
    const payload = JSON.parse(postedSnapshot || '{}');
    if (payload.format !== 'pdf' || payload.mode !== 'ppt') throw new Error(`button PDF request used the wrong mode/format: ${postedSnapshot}`);
    if (!payload.html?.includes(updatedText)) throw new Error('button PDF export did not submit the edited DOM snapshot');
    const jsonMatch = payload.html.match(/<script[^>]+id=["']html-pptx-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonMatch || !jsonMatch[1].includes(updatedText)) throw new Error('button PDF export must sync html-pptx-data before submitting the snapshot');
    fs.rmSync(pdfPath, { force: true });

    const pptxDisabled = process.env.HTML_REPORT_SKIP_PPTX === '1' || /"pptx"\s*:\s*false/.test(snapshot);
    if (!pptxDisabled) {
      let pptxSnapshot = '';
      await page.route('**/api/export', async route => {
        pptxSnapshot = route.request().postData() || '';
        await route.continue();
      });
      const [pptxDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 120000 }),
        page.click('#exportPpt'),
      ]);
      const pptxPath = path.join(os.tmpdir(), `html-report-native-${Date.now()}.pptx`);
      await pptxDownload.saveAs(pptxPath);
      const pptxBuffer = fs.readFileSync(pptxPath);
      if (pptxBuffer.byteLength < 1000) throw new Error('generated PPTX download is unavailable');
      const pptxPayload = JSON.parse(pptxSnapshot || '{}');
      if (pptxPayload.format !== 'pptx' || pptxPayload.mode !== 'ppt') throw new Error(`button PPTX request used the wrong mode/format: ${pptxSnapshot}`);
      const entries = execFileSync('unzip', ['-Z1', pptxPath], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      const slideXml = entries
        .filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
        .map(entry => execFileSync('unzip', ['-p', pptxPath, entry], { encoding: 'utf8' }))
        .join('\n');
      fs.rmSync(pptxPath, { force: true });
      if (snapshot.includes('"pptxContractVersion": 2')) {
        if (!entries.some(entry => /^ppt\/slides\/charts\/chart\d+\.xml$/.test(entry))) {
          throw new Error('v2 PPTX export must use the native Artifact Tool chart path');
        }
        if (!/<a:tbl>/.test(slideXml) || !/typeface="Microsoft YaHei"/.test(slideXml)) {
          throw new Error('v2 PPTX export must preserve native tables and Microsoft YaHei text');
        }

        const unsupportedSnapshot = pptxPayload.html.replace('"chartType": "pie"', '"chartType": "radar"');
        const unsupportedResponse = await fetch(`http://127.0.0.1:${port}/api/export`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, format: 'pptx', html: unsupportedSnapshot, title: '复杂图表验收' }),
        });
        const unsupportedResult = await unsupportedResponse.json();
        if (unsupportedResponse.ok || !/radar/.test(unsupportedResult.error || '')) {
          throw new Error(`v2 PPTX export must reject undeclared complex charts: ${JSON.stringify(unsupportedResult)}`);
        }
      }
    }

    await page.evaluate(() => {
      if (!document.body.classList.contains('adaptive-mode')) document.getElementById('modeToggle')?.click();
    });
    await page.click('#downloadHtml');
    const [editableDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="editable"]'),
    ]);
    const editablePath = path.join(os.tmpdir(), `html-report-editable-${Date.now()}.html`);
    await editableDownload.saveAs(editablePath);
    const editableHtml = fs.readFileSync(editablePath, 'utf8');
    if (!editableHtml.includes('id="styleDrawer"') || /id="styleDrawer"[^>]*hidden/.test(editableHtml)) throw new Error('editable HTML export lost the editor entry');
    assertStandaloneImageAssets(editableHtml, 'editable HTML export');
    await page.click('#downloadHtml');
    const [viewDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="view"]'),
    ]);
    const viewPath = path.join(os.tmpdir(), `html-report-view-${Date.now()}.html`);
    await viewDownload.saveAs(viewPath);
    const viewHtml = fs.readFileSync(viewPath, 'utf8');
    if (!/id="styleDrawer"[^>]*hidden/.test(viewHtml) || !viewHtml.includes('standalone-export')) throw new Error('view-only HTML export kept editor UI');
    assertStandaloneImageAssets(viewHtml, 'view-only HTML export');

    const editableStandalone = await browser.newPage({ viewport: { width: 744, height: 756 } });
    await editableStandalone.goto(pathToFileURL(editablePath).href);
    await editableStandalone.waitForLoadState('networkidle');
    const editableEntry = await editableStandalone.evaluate(() => ({
      hasViewOnlyClass: document.body.classList.contains('standalone-export'),
      startsAdaptive: document.body.classList.contains('adaptive-mode'),
      gearVisible: getComputedStyle(document.getElementById('drawerToggle')).display !== 'none',
      drawerVisible: getComputedStyle(document.getElementById('styleDrawer')).display !== 'none',
      editToggle: Boolean(document.getElementById('editToggle')),
      modeToggle: Boolean(document.getElementById('modeToggle')),
    }));
    if (editableEntry.hasViewOnlyClass || !editableEntry.startsAdaptive || !editableEntry.gearVisible || !editableEntry.drawerVisible || !editableEntry.editToggle || !editableEntry.modeToggle) {
      throw new Error(`editable standalone HTML lost its editing/browsing entry: ${JSON.stringify(editableEntry)}`);
    }
    await editableStandalone.click('#drawerToggle');
    const navigationGroupToggle = editableStandalone.locator('[data-drawer-intent="navigation"] > .control-group-toggle');
    if (!(await editableStandalone.locator('#modeToggle').isVisible()) && await navigationGroupToggle.getAttribute('aria-expanded') !== 'true') {
      await navigationGroupToggle.click();
    }
    await editableStandalone.click('#modeToggle');
    await editableStandalone.click('#editToggle');
    const editableModes = await editableStandalone.evaluate(() => ({
      editing: document.body.classList.contains('edit-mode'),
      switchedToPpt: document.body.classList.contains('ppt-mode') && !document.body.classList.contains('adaptive-mode'),
    }));
    if (!editableModes.editing || !editableModes.switchedToPpt) throw new Error(`editable standalone controls did not enter edit and switch browse mode: ${JSON.stringify(editableModes)}`);

    const viewStandalone = await browser.newPage({ viewport: { width: 744, height: 756 } });
    await viewStandalone.goto(pathToFileURL(viewPath).href);
    await viewStandalone.waitForLoadState('networkidle');
    const viewEntry = await viewStandalone.evaluate(() => ({
      viewOnly: document.body.classList.contains('standalone-export'),
      startsAdaptive: document.body.classList.contains('adaptive-mode'),
      gearHidden: getComputedStyle(document.getElementById('drawerToggle')).display === 'none',
      drawerHidden: getComputedStyle(document.getElementById('styleDrawer')).display === 'none',
      browseVisible: getComputedStyle(document.getElementById('standaloneBrowseToggle')).display !== 'none',
    }));
    if (!viewEntry.viewOnly || !viewEntry.startsAdaptive || !viewEntry.gearHidden || !viewEntry.drawerHidden || !viewEntry.browseVisible) {
      throw new Error(`view-only standalone HTML browsing controls are invalid: ${JSON.stringify(viewEntry)}`);
    }
    await viewStandalone.click('#standaloneBrowseToggle');
    const switchedToPpt = await viewStandalone.evaluate(() => document.body.classList.contains('ppt-mode') && !document.body.classList.contains('adaptive-mode'));
    if (!switchedToPpt) throw new Error('view-only standalone HTML could not switch to PPT browsing');
    await viewStandalone.click('#standaloneBrowseToggle');
    const switchedBackToAdaptive = await viewStandalone.evaluate(() => document.body.classList.contains('adaptive-mode'));
    if (!switchedBackToAdaptive) throw new Error('view-only standalone HTML could not return to adaptive browsing');
    await editableStandalone.close();
    await viewStandalone.close();
    fs.rmSync(editablePath, { force: true });
    fs.rmSync(viewPath, { force: true });
  }
  if (mode === 'single-page') {
    await page.click('#downloadHtml');
    const [editableDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="editable"]'),
    ]);
    const editablePath = path.join(os.tmpdir(), `html-report-single-editable-${Date.now()}.html`);
    await editableDownload.saveAs(editablePath);
    const editableHtml = fs.readFileSync(editablePath, 'utf8');
    if (!editableHtml.includes('id="styleDrawer"') || /id="styleDrawer"[^>]*hidden/.test(editableHtml)) throw new Error('single editable HTML export lost the editor entry');
    assertStandaloneImageAssets(editableHtml, 'single editable HTML export');
    await page.click('#downloadHtml');
    const [viewDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="view"]'),
    ]);
    const viewPath = path.join(os.tmpdir(), `html-report-single-view-${Date.now()}.html`);
    await viewDownload.saveAs(viewPath);
    const viewHtml = fs.readFileSync(viewPath, 'utf8');
    if (!/id="styleDrawer"[^>]*hidden/.test(viewHtml) || !viewHtml.includes('standalone-export')) throw new Error('single view-only HTML export kept editor UI');
    assertStandaloneImageAssets(viewHtml, 'single view-only HTML export');
    fs.rmSync(editablePath, { force: true });
    fs.rmSync(viewPath, { force: true });
  }
  await browser.close();
  console.log(`[OK] preview export and UI contract: ${mode}`);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
