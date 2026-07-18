#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const root = path.resolve(process.argv[2] || process.cwd());
const port = Number(process.argv[3] || 5300);
const skillRoot = path.resolve(import.meta.dirname, '..');
const exportDir = path.join(root, 'exports');
const maxBodyBytes = 50 * 1024 * 1024;

if (!existsSync(path.join(root, 'index.html'))) throw new Error(`index.html not found in ${root}`);
mkdirSync(exportDir, { recursive: true });

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

async function createExport(payload) {
  const { mode, format, html, title } = payload || {};
  if (!['ppt', 'single-page'].includes(mode)) throw new Error('报告模式无效。');
  if (!['pdf', 'pptx', 'png'].includes(format)) throw new Error('导出格式无效。');
  if (typeof html !== 'string' || !html.includes(`data-report-mode="${mode}"`)) throw new Error('当前页面快照无效。');
  if (mode === 'ppt' && !['pdf', 'pptx'].includes(format)) throw new Error('PPT 仅支持 PDF 或 PPTX 即时导出。');
  if (mode === 'single-page' && !['png', 'pdf'].includes(format)) throw new Error('滚动报告仅支持图片或 PDF 即时导出。');

  const token = randomUUID();
  const snapshotPath = path.join(root, `.html-report-export-${token}.html`);
  const prefix = safeFileName(title);
  writeFileSync(snapshotPath, html, 'utf8');
  try {
    if (mode === 'ppt') {
      const script = path.join(skillRoot, 'scripts', 'export_html_report.py');
      await run('python3', [script, snapshotPath, '--out-dir', exportDir, '--formats', format]);
      const ext = format === 'pptx' ? '.pptx' : '.pdf';
      const generated = path.join(exportDir, `${path.basename(snapshotPath, '.html')}${ext}`);
      const finalName = `${prefix}-${Date.now()}${ext}`;
      const finalPath = path.join(exportDir, finalName);
      if (!existsSync(generated)) throw new Error('导出器未返回文件。');
      writeFileSync(finalPath, readFileSync(generated));
      unlinkSync(generated);
      return finalName;
    }
    const script = path.join(skillRoot, 'scripts', 'export_single_page_long.mjs');
    await run(process.execPath, [script, snapshotPath, exportDir]);
    const ext = format === 'png' ? '-long.png' : '-long.pdf';
    const generated = path.join(exportDir, `${path.basename(snapshotPath, '.html')}${ext}`);
    const finalName = `${prefix}-${Date.now()}${format === 'png' ? '.png' : '.pdf'}`;
    const finalPath = path.join(exportDir, finalName);
    if (!existsSync(generated)) throw new Error('导出器未返回文件。');
    writeFileSync(finalPath, readFileSync(generated));
    unlinkSync(generated);
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
      const fileName = await createExport(await readJson(req));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, fileName, downloadUrl: `/api/download?file=${encodeURIComponent(fileName)}` }));
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
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
