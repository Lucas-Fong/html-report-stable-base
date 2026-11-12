#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const skillRoot = path.resolve(import.meta.dirname, '..');
const exporter = path.join(skillRoot, 'scripts', 'export_native_pptx.mjs');
const fixture = path.join(skillRoot, 'fixtures', 'native-pptx-on-demand.json');
const runtimeNode = process.env.RUNTIME_NODE || process.execPath;
const workDir = mkdtempSync(path.join(os.tmpdir(), 'html-report-native-pptx-'));
const deckPath = path.join(workDir, 'deck.json');
const outputPath = path.join(workDir, 'native.pptx');

try {
  const model = JSON.parse(readFileSync(fixture, 'utf8'));
  const nativeCopy = model.slides[0].objects.find(obj => obj.name === 'native-copy');
  // This profile models a high-fidelity editable PPTX: the browser keeps its
  // natural text flow, while export can pin only the visual-critical object.
  nativeCopy.nativeText = '导出专用文字';
  nativeCopy.nativeFrame = { x: 214, y: 228, w: 520, h: 42 };
  nativeCopy.nativeTextStyle = {
    fontFamily: 'Microsoft YaHei',
    fontSizePt: 18,
    lineHeightPt: 18,
    wrap: false,
    bold: true,
    color: '#D9B768',
    align: 'left',
  };
  const deck = {
    pptxContractVersion: model.pptxContractVersion,
    meta: model.meta,
    slides: model.slides.map(({ title, background, objects }) => ({ title, background, objects })),
  };
  writeFileSync(deckPath, JSON.stringify(deck), 'utf8');
  const result = spawnSync(runtimeNode, [exporter, deckPath, outputPath, skillRoot], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(outputPath), 'native PPTX was not created');

  const names = execFileSync('unzip', ['-Z1', outputPath], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const slideFiles = names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const chartFiles = names.filter(name => /^ppt\/(?:charts|slides\/charts)\/chart\d+\.xml$/.test(name));
  const slideXml = execFileSync('unzip', ['-p', outputPath, 'ppt/slides/slide1.xml'], { encoding: 'utf8' });

  assert.equal(slideFiles.length, 1);
  assert.match(slideXml, /<p:sp>/);
  assert.match(slideXml, /<a:tbl>/);
  assert.match(slideXml, /typeface="Microsoft YaHei"/);
  assert.match(slideXml, /<a:t>导出专用文字<\/a:t>/, '导出必须使用原生重建文案');
  assert.match(slideXml, /D9B768/i, '导出必须使用原生重建文字颜色');
  assert.match(slideXml, /sz="1800"/, '导出必须使用原生重建字号');
  assert.match(slideXml, /<a:tcPr[^>]*anchor="ctr"/);
  assert.equal((slideXml.match(/<p:pic>/g) || []).length, 1);
  assert.equal(chartFiles.length, 2);
  console.log('[OK] native PPTX exports editable text, shapes, table, charts, and an explicit image fallback');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
