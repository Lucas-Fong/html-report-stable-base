#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || process.cwd());
const port = Number(process.argv[3] || 5300);
const skillRoot = path.resolve(import.meta.dirname, '..');
const exportDir = path.join(root, 'exports');
const maxBodyBytes = 50 * 1024 * 1024;

if (!existsSync(path.join(root, 'index.html'))) throw new Error(`index.html not found in ${root}`);
mkdirSync(exportDir, { recursive: true });
let browserPromise;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function safeFileName(value, fallback = 'html-report') {
  const base = String(value || fallback).replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 72);
  return base || fallback;
}

function safePath(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${root}${path.sep}`) || resolved === root ? resolved : null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error('导出快照超过 50MB。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('导出请求格式无效。')); }
    });
    req.on('error', reject);
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || stdout || `导出器退出码 ${code}`)));
  });
}

function bytesFromBinary(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 255;
  return bytes;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function ascii(text) {
  return bytesFromBinary(text);
}

function pngSize(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid PNG signature');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error('Invalid JPEG dimensions');
}

function jpegImagesToPdf(images, outPath, fixedAspect = false) {
  if (!images.length) throw new Error('没有可导出的页面。');
  const parts = [ascii('%PDF-1.4\n% HTML Report preview export\n')];
  const objects = [];
  const kids = [];
  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const pageWidth = 900;
    const pageHeight = fixedAspect ? 506.25 : pageWidth * image.height / image.width;
    kids.push(`${pageId} 0 R`);
    const content = `q\n${pageWidth.toFixed(3)} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im${index} Do\nQ\n`;
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);
    objects.push(concatBytes([
      ascii(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.buffer.length} >>\nstream\n`),
      image.buffer,
      ascii('\nendstream\nendobj\n'),
    ]));
    objects.push(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });
  objects.unshift(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${images.length} >>\nendobj\n`);
  objects.unshift('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const offsets = [0];
  let cursor = parts[0].length;
  objects.forEach(object => {
    offsets.push(cursor);
    const bytes = typeof object === 'string' ? ascii(object) : object;
    parts.push(bytes);
    cursor += bytes.length;
  });
  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(ascii(xref));
  writeFileSync(outPath, Buffer.from(concatBytes(parts)));
}

async function browser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

async function withPage(options, callback) {
  const instance = await browser();
  const page = await instance.newPage(options);
  try {
    return await callback(page);
  } finally {
    await page.close();
  }
}

async function captureSinglePage(snapshotPath, finalPath, format) {
  await withPage({ viewport: { width: 1645, height: 1000 }, deviceScaleFactor: 2 }, async page => {
    await page.goto(pathToFileURL(snapshotPath).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.setEditMode?.(false);
      window.HTMLReportEditor?.selectElement?.(null);
      document.querySelectorAll('.typography-label').forEach(label => label.remove());
      document.body.classList.remove('drawer-open', 'edit-mode');
      document.body.classList.add('standalone-export');
    });
    await page.waitForTimeout(200);
    const report = page.locator('#report');
    if (format === 'png') {
      writeFileSync(finalPath, await report.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }));
      return;
    }
    const pngBuffer = await report.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    const jpegBuffer = await report.screenshot({ type: 'jpeg', quality: 94, animations: 'disabled', caret: 'hide' });
    jpegImagesToPdf([{ buffer: jpegBuffer, ...pngSize(pngBuffer) }], finalPath);
  });
}

async function capturePptPdf(snapshotPath, finalPath) {
  await withPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 }, async page => {
    await page.goto(pathToFileURL(snapshotPath).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.setEditMode?.(false);
      window.HTMLReportEditor?.selectElement?.(null);
      document.querySelectorAll('.typography-label').forEach(label => label.remove());
      document.body.classList.remove('drawer-open', 'edit-mode');
      document.body.classList.add('standalone-export', 'ppt-mode');
    });
    await page.waitForTimeout(250);
    const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
    const images = [];
    for (let index = 0; index < slideCount; index += 1) {
      await page.evaluate(i => window.goTo ? window.goTo(i) : document.querySelectorAll('.slide')[i]?.scrollIntoView(), index);
      await page.waitForTimeout(120);
      const buffer = await page.locator('.slide.active-slide').screenshot({ type: 'jpeg', quality: 94, animations: 'disabled', caret: 'hide' });
      images.push({ buffer, ...jpegSize(buffer) });
    }
    jpegImagesToPdf(images, finalPath, true);
  });
}

async function capturePptPngs(snapshotPath, prefix) {
  const timestamp = Date.now();
  return withPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 }, async page => {
    await page.goto(pathToFileURL(snapshotPath).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.setEditMode?.(false);
      window.HTMLReportEditor?.selectElement?.(null);
      document.querySelectorAll('.typography-label').forEach(label => label.remove());
      document.body.classList.remove('drawer-open', 'edit-mode');
      document.body.classList.add('standalone-export', 'ppt-mode');
    });
    await page.waitForTimeout(250);
    const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
    const files = [];
    for (let index = 0; index < slideCount; index += 1) {
      await page.evaluate(i => window.goTo ? window.goTo(i) : document.querySelectorAll('.slide')[i]?.scrollIntoView(), index);
      await page.waitForTimeout(120);
      const fileName = `${prefix}-${timestamp}-${String(index + 1).padStart(2, '0')}.png`;
      const finalPath = path.join(exportDir, fileName);
      writeFileSync(finalPath, await page.locator('.slide.active-slide').screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }));
      files.push(fileName);
    }
    return files;
  });
}

function extractPptxData(snapshotPath, jsonPath) {
  const html = readFileSync(snapshotPath, 'utf8');
  const match = html.match(/<script[^>]+id=["']html-pptx-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('当前页面缺少 html-pptx-data。');
  JSON.parse(match[1].trim());
  writeFileSync(jsonPath, match[1].trim(), 'utf8');
}

async function createExport(payload) {
  const { mode, format, html, title } = payload || {};
  if (!['ppt', 'single-page'].includes(mode)) throw new Error('报告模式无效。');
  if (!['pdf', 'pptx', 'png'].includes(format)) throw new Error('导出格式无效。');
  if (typeof html !== 'string' || !html.includes(`data-report-mode="${mode}"`)) throw new Error('当前页面快照无效。');
  if (mode === 'ppt' && !['pdf', 'pptx', 'png'].includes(format)) throw new Error('PPT 仅支持 PDF、图片或 PPTX 即时导出。');
  if (mode === 'single-page' && !['png', 'pdf'].includes(format)) throw new Error('滚动报告仅支持图片或 PDF 即时导出。');

  const token = randomUUID();
  const snapshotPath = path.join(root, `.html-report-export-${token}.html`);
  const prefix = safeFileName(title);
  writeFileSync(snapshotPath, html, 'utf8');
  try {
    if (mode === 'ppt') {
      if (format === 'pdf') {
        const finalName = `${prefix}-${Date.now()}.pdf`;
        await capturePptPdf(snapshotPath, path.join(exportDir, finalName));
        return finalName;
      }
      if (format === 'png') {
        return await capturePptPngs(snapshotPath, prefix);
      }
      const script = path.join(skillRoot, 'scripts', 'export_html_report.py');
      const deckJsonPath = path.join(root, `.html-report-export-${token}.json`);
      extractPptxData(snapshotPath, deckJsonPath);
      try {
        await run('python3', [script, snapshotPath, '--out-dir', exportDir, '--formats', format, '--deck-json', deckJsonPath]);
      } finally {
        if (existsSync(deckJsonPath)) unlinkSync(deckJsonPath);
      }
      const ext = format === 'pptx' ? '.pptx' : '.pdf';
      const generated = path.join(exportDir, `${path.basename(snapshotPath, '.html')}${ext}`);
      const finalName = `${prefix}-${Date.now()}${ext}`;
      const finalPath = path.join(exportDir, finalName);
      if (!existsSync(generated)) throw new Error('导出器未返回文件。');
      writeFileSync(finalPath, readFileSync(generated));
      unlinkSync(generated);
      return finalName;
    }
    const finalName = `${prefix}-${Date.now()}${format === 'png' ? '.png' : '.pdf'}`;
    const finalPath = path.join(exportDir, finalName);
    await captureSinglePage(snapshotPath, finalPath, format);
    if (!existsSync(finalPath)) throw new Error('导出器未返回文件。');
    return finalName;
  } finally {
    if (existsSync(snapshotPath)) unlinkSync(snapshotPath);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/api/export' && req.method === 'POST') {
      const output = await createExport(await readJson(req));
      const fileNames = Array.isArray(output) ? output : [output];
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        fileName: fileNames[0],
        fileNames,
        downloadUrl: `/api/download?file=${encodeURIComponent(fileNames[0])}`,
        downloadUrls: fileNames.map(fileName => `/api/download?file=${encodeURIComponent(fileName)}`),
      }));
      return;
    }
    if (url.pathname === '/api/download') {
      const fileName = path.basename(url.searchParams.get('file') || '');
      const filePath = path.join(exportDir, fileName);
      if (!fileName || !existsSync(filePath)) throw new Error('导出文件不存在。');
      const ext = path.extname(fileName).toLowerCase();
      res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` });
      res.end(readFileSync(filePath));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new Error('不支持的请求。');
    const filePath = safePath(url.pathname);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else res.end(readFileSync(filePath));
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '导出失败。' }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`HTML Report preview: http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  server.close(async () => {
    if (browserPromise) await (await browserPromise).close();
    process.exit(0);
  });
});
