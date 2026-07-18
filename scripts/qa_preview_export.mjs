#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
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
  if (!download.ok || (await download.arrayBuffer()).byteLength < 100) throw new Error('generated export download is unavailable');
  if (mode === 'ppt') {
    const pptxResponse = await fetch(`http://127.0.0.1:${port}/api/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, format: 'pptx', html: snapshot, title: '即时导出验收' }),
    });
    const pptxResult = await pptxResponse.json();
    if (!pptxResponse.ok || !pptxResult.downloadUrl) throw new Error(`PPTX export endpoint failed: ${JSON.stringify(pptxResult)}`);
    const pptxDownload = await fetch(`http://127.0.0.1:${port}${pptxResult.downloadUrl}`);
    if (!pptxDownload.ok || (await pptxDownload.arrayBuffer()).byteLength < 1000) throw new Error('generated PPTX download is unavailable');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1466, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForLoadState('networkidle');
  await page.click('#drawerToggle');
  const ui = await page.evaluate(() => ({
    width: getComputedStyle(document.documentElement).getPropertyValue('--drawer-width').trim(),
    exports: [...document.querySelectorAll('.export-actions button, .drawer-footer [data-export-format]')].map(button => button.id || button.dataset.exportFormat),
    htmlChoice: Boolean(document.getElementById('htmlExportChoice')),
    htmlChoiceIsModal: document.getElementById('htmlExportChoice')?.getAttribute('role') === 'dialog' && !document.getElementById('htmlExportChoice')?.closest('.style-drawer'),
  }));
  if (ui.width !== '320px') throw new Error(`drawer width should be 320px, received ${ui.width}`);
  if (mode === 'ppt' && (ui.exports.join(',') !== 'downloadHtml,printPdf,exportPpt' || !ui.htmlChoice || !ui.htmlChoiceIsModal)) throw new Error(`PPT export UI contract failed: ${JSON.stringify(ui)}`);
  if (mode === 'single-page' && ui.exports.join(',') !== 'downloadHtml,downloadLongPng,downloadLongPdf') throw new Error(`single export UI contract failed: ${JSON.stringify(ui)}`);
  if (mode === 'single-page' && (!ui.htmlChoice || !ui.htmlChoiceIsModal)) throw new Error(`single HTML export modal is missing: ${JSON.stringify(ui)}`);
  if (mode === 'ppt') {
    await page.click('#downloadHtml');
    const [editableDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="editable"]'),
    ]);
    const editablePath = path.join(os.tmpdir(), `html-report-editable-${Date.now()}.html`);
    await editableDownload.saveAs(editablePath);
    const editableHtml = fs.readFileSync(editablePath, 'utf8');
    if (!editableHtml.includes('id="styleDrawer"') || /id="styleDrawer"[^>]*hidden/.test(editableHtml)) throw new Error('editable HTML export lost the editor entry');
    await page.click('#downloadHtml');
    const [viewDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="view"]'),
    ]);
    const viewPath = path.join(os.tmpdir(), `html-report-view-${Date.now()}.html`);
    await viewDownload.saveAs(viewPath);
    const viewHtml = fs.readFileSync(viewPath, 'utf8');
    if (!/id="styleDrawer"[^>]*hidden/.test(viewHtml) || !viewHtml.includes('standalone-export')) throw new Error('view-only HTML export kept editor UI');
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
    await page.click('#downloadHtml');
    const [viewDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-html-export-mode="view"]'),
    ]);
    const viewPath = path.join(os.tmpdir(), `html-report-single-view-${Date.now()}.html`);
    await viewDownload.saveAs(viewPath);
    const viewHtml = fs.readFileSync(viewPath, 'utf8');
    if (!/id="styleDrawer"[^>]*hidden/.test(viewHtml) || !viewHtml.includes('standalone-export')) throw new Error('single view-only HTML export kept editor UI');
    fs.rmSync(editablePath, { force: true });
    fs.rmSync(viewPath, { force: true });
  }
  await browser.close();
  console.log(`[OK] preview export and UI contract: ${mode}`);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
