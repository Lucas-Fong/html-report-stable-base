#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('Usage: test_qa_preview_export_ppt.mjs <ppt-index.html>');

const qaScript = path.join(import.meta.dirname, 'qa_preview_export.mjs');
const result = spawnSync(process.execPath, [qaScript, target], {
  encoding: 'utf8',
  env: process.env,
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) {
  throw new Error('PPT 预览导出验收应通过：PDF 页数必须与 5 个实际 .slide 页面一致。');
}
