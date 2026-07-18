#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const htmlPath = path.resolve(process.argv[2] || '');
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error('Usage: export_single_page_long.mjs <index.html> [out-dir]');
  process.exit(2);
}

const outDir = path.resolve(process.argv[3] || path.join(path.dirname(htmlPath), 'exports'));
fs.mkdirSync(outDir, { recursive: true });

const baseName = path.basename(htmlPath, path.extname(htmlPath));
const pngPath = path.join(outDir, `${baseName}-long.png`);
const pdfPath = path.join(outDir, `${baseName}-long.pdf`);

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

function jpegToSinglePagePdf(jpegBuffer, imageWidth, imageHeight) {
  const pageWidth = 900;
  const pageHeight = pageWidth * imageHeight / imageWidth;
  const content = `q\n${pageWidth.toFixed(3)} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    concatBytes([
      ascii(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuffer.length} >>\nstream\n`),
      jpegBuffer,
      ascii('\nendstream\nendobj\n'),
    ]),
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
  ];
  const parts = [ascii('%PDF-1.4\n% Chromium long-page screenshot export\n')];
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
  return Buffer.from(concatBytes(parts));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1645, height: 1000 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  window.setEditMode?.(false);
  window.HTMLReportEditor?.selectElement?.(null);
  document.querySelectorAll('.typography-label').forEach(label => label.remove());
  document.body.classList.remove('drawer-open', 'edit-mode');
  document.body.classList.add('standalone-export');
});
await page.waitForTimeout(350);

const report = page.locator('#report');
const pngBuffer = await report.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
const jpegBuffer = await report.screenshot({ type: 'jpeg', quality: 94, animations: 'disabled', caret: 'hide' });
await browser.close();

fs.writeFileSync(pngPath, pngBuffer);
const size = pngSize(pngBuffer);
fs.writeFileSync(pdfPath, jpegToSinglePagePdf(jpegBuffer, size.width, size.height));

console.log(JSON.stringify({ png: pngPath, pdf: pdfPath, width: size.width, height: size.height }, null, 2));
