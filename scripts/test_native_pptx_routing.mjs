#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const skillRoot = path.resolve(import.meta.dirname, '..');
const workDir = mkdtempSync(path.join(os.tmpdir(), 'html-report-native-routing-'));
const output = path.join(workDir, 'index.html');

try {
  const build = spawnSync('python3', [
    path.join(skillRoot, 'scripts', 'build_html_report_from_model.py'),
    path.join(skillRoot, 'fixtures', 'native-pptx-on-demand.json'),
    '--template', path.join(skillRoot, 'assets', 'template', 'html-report-ppt-base.html'),
    '--out', output,
  ], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const html = readFileSync(output, 'utf8');
  const pptxButton = html.match(/<button id="exportPpt"[^>]*>([^<]+)<\/button>/);
  assert.ok(pptxButton, 'PPTX export button is missing');
  assert.equal(pptxButton[1].trim(), '原生可编辑 PPTX');
  assert.equal(existsSync(path.join(workDir, 'exports')), false, 'HTML generation must not create an exports directory');
  assert.equal(readdirSync(workDir).some(entry => entry.endsWith('.pptx')), false, 'HTML generation must not create a PPTX');
  console.log('[OK] HTML generation remains PPTX-free and exposes the native editable export action');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
