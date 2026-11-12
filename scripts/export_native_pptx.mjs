#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [deckPath, outputPath, assetRootArg] = process.argv.slice(2);
if (!deckPath || !outputPath || !assetRootArg) {
  throw new Error('Usage: export_native_pptx.mjs <deck-json> <output-pptx> <asset-root>');
}
if (!process.env.RUNTIME_NODE_MODULES) {
  throw new Error('原生 PPTX 导出需要 RUNTIME_NODE_MODULES。请通过 Codex 运行时启动预览服务。');
}

const runtimeRequire = createRequire(path.join(process.env.RUNTIME_NODE_MODULES, 'package.json'));
const artifactToolEntry = runtimeRequire.resolve('@oai/artifact-tool');
const { Presentation, PresentationFile } = await import(pathToFileURL(artifactToolEntry).href);

const deck = JSON.parse(readFileSync(path.resolve(deckPath), 'utf8'));
const assetRoot = path.resolve(assetRootArg);
const DEFAULT_FONT = 'Microsoft YaHei';
const OUTPUT_W = 1280;
const OUTPUT_H = 720;
const NO_LINE = { style: 'solid', fill: 'none', width: 0 };
const SHAPES = new Set(['rect', 'roundRect', 'roundedRect', 'ellipse', 'line']);
const CHART_TYPES = new Set(['bar', 'column', 'line', 'pie', 'doughnut']);

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function frameFor(frame, meta) {
  const widthScale = OUTPUT_W / Math.max(1, asNumber(meta.width, 1440));
  const heightScale = OUTPUT_H / Math.max(1, asNumber(meta.height, 810));
  return {
    left: asNumber(frame?.x) * widthScale,
    top: asNumber(frame?.y) * heightScale,
    width: asNumber(frame?.w) * widthScale,
    height: asNumber(frame?.h) * heightScale,
  };
}

// Native reconstruction stays opt-in: HTML keeps its measured frame and
// text flow, while only visual-critical PPTX objects may pin an export frame.
function nativeFrameFor(obj) {
  const candidate = obj?.nativeFrame;
  return candidate && typeof candidate === 'object' ? candidate : obj?.frame;
}

function nativeTextFor(obj) {
  return obj?.nativeText !== undefined ? obj.nativeText : obj?.text;
}

function nativeTextStyleFor(obj) {
  return obj?.nativeTextStyle && typeof obj.nativeTextStyle === 'object'
    ? obj.nativeTextStyle
    : (obj?.textStyle && typeof obj.textStyle === 'object' ? obj.textStyle : {});
}

function fontPx(style = {}, meta = {}) {
  const pointSize = asNumber(style.fontSizePt, asNumber(style.fontSize, 14));
  return pointSize * 4 / 3;
}

function typeface(style = {}, meta = {}) {
  const candidate = String(style.fontFamily || meta.fontFamily || DEFAULT_FONT).trim();
  return candidate.split(',')[0].replace(/^['"]|['"]$/g, '') || DEFAULT_FONT;
}

function lineSpacing(style = {}) {
  const size = asNumber(style.fontSizePt, asNumber(style.fontSize, 0));
  const height = asNumber(style.lineHeightPt, asNumber(style.lineHeight, 0));
  if (size <= 0 || height <= 0) return undefined;
  // Artifact Tool uses a line-height multiplier (1.03 = 103%); keep the
  // browser's computed leading instead of letting PowerPoint choose 1.2.
  return Math.round((height / size) * 100) / 100;
}

function lineFor(line, widthOverride) {
  if (!line || line === 'none') return NO_LINE;
  if (typeof line === 'string') return { style: 'solid', fill: line, width: asNumber(widthOverride, 1) };
  return {
    style: line.style || 'solid',
    fill: line.fill || line.color || '#DCE9E5',
    width: asNumber(line.widthPt ?? line.width ?? widthOverride, 1),
  };
}

function imageContentType(source) {
  if (source.startsWith('data:image/')) return source.slice(5, source.indexOf(';') > 0 ? source.indexOf(';') : source.indexOf(','));
  const extension = path.extname(source).toLowerCase();
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function imageSource(source) {
  if (String(source).startsWith('data:image/')) return { dataUrl: source, contentType: imageContentType(source) };
  const imagePath = path.resolve(assetRoot, source);
  if (!imagePath.startsWith(`${assetRoot}${path.sep}`) && imagePath !== assetRoot) {
    throw new Error(`图片路径超出报告目录：${source}`);
  }
  if (!existsSync(imagePath)) throw new Error(`图片不存在：${source}`);
  return { blob: readFileSync(imagePath), contentType: imageContentType(source) };
}

function addNativeText(slide, obj, meta) {
  const style = nativeTextStyleFor(obj);
  const box = slide.shapes.add({
    name: obj.name,
    geometry: SHAPES.has(obj.shape) ? obj.shape : 'textbox',
    position: frameFor(nativeFrameFor(obj), meta),
    fill: obj.fill || 'none',
    line: lineFor(obj.line, obj.lineWidth),
  });
  box.text = String(nativeTextFor(obj) ?? '');
  const spacing = lineSpacing(style);
  box.text.style = {
    typeface: typeface(style, meta),
    fontSize: fontPx(style, meta),
    color: style.color || '#173F3B',
    bold: Boolean(style.bold),
    alignment: style.align || 'left',
    ...(spacing ? { lineSpacing: spacing } : {}),
    ...(style.wrap === false ? { wrap: 'none' } : {}),
  };
}

function addNativeShape(slide, obj, meta) {
  const geometry = SHAPES.has(obj.shape) ? obj.shape : 'rect';
  slide.shapes.add({
    name: obj.name,
    geometry,
    position: frameFor(nativeFrameFor(obj), meta),
    fill: obj.fill || 'none',
    line: lineFor(obj.line, obj.lineWidth),
    ...(['rect', 'roundRect', 'roundedRect'].includes(geometry) && obj.radius !== undefined
      ? { borderRadius: asNumber(obj.radius) * (OUTPUT_W / Math.max(1, asNumber(meta.width, 1440))) }
      : {}),
  });
}

function applyTableStyle(table, obj, meta) {
  const tableStyle = obj.tableStyle && typeof obj.tableStyle === 'object' ? obj.tableStyle : {};
  const header = tableStyle.header && typeof tableStyle.header === 'object' ? tableStyle.header : {};
  const body = tableStyle.body && typeof tableStyle.body === 'object' ? tableStyle.body : {};
  const border = tableStyle.border && typeof tableStyle.border === 'object' ? tableStyle.border : {};
  const rows = [obj.columns || [], ...(obj.rows || [])];
  table.styleOptions = { headerRow: true, bandedRows: false };
  table.borders.assign({ style: 'solid', fill: border.color || '#DCE9E5', width: asNumber(border.widthPt, 1) });
  table.cells.block({ row: 0, column: 0, rowCount: rows.length, columnCount: obj.columns.length }).assign({ anchor: 'middle' });
  rows.forEach((row, rowIndex) => row.forEach((_value, columnIndex) => {
    const cell = table.getCell(rowIndex, columnIndex);
    const cellStyle = rowIndex === 0 ? header : body;
    cell.fill = cellStyle.fill || (rowIndex === 0 ? '#173F3B' : '#FFFFFF');
    cell.text.style = {
      typeface: typeface(cellStyle, meta),
      fontSize: fontPx(cellStyle, meta),
      color: cellStyle.color || (rowIndex === 0 ? '#FFFFFF' : '#173F3B'),
      bold: rowIndex === 0 ? cellStyle.bold !== false : Boolean(cellStyle.bold),
      alignment: 'center',
    };
  }));
}

function addNativeTable(slide, obj, meta) {
  const columns = obj.columns || [];
  const rows = obj.rows || [];
  if (!columns.length) throw new Error(`表格 ${obj.name} 缺少列定义`);
  const position = frameFor(nativeFrameFor(obj), meta);
  const table = slide.tables.add({
    rows: rows.length + 1,
    columns: columns.length,
    left: position.left,
    top: position.top,
    width: position.width,
    height: position.height,
    values: [columns, ...rows],
  });
  table.name = obj.name;
  if (Array.isArray(obj.columnWidths) && obj.columnWidths.length) {
    const total = obj.columnWidths.reduce((sum, value) => sum + asNumber(value), 0) || 1;
    obj.columnWidths.slice(0, columns.length).forEach((value, index) => {
      table.columns.get(index).width = position.width * asNumber(value) / total;
    });
  }
  if (Array.isArray(obj.rowHeights) && obj.rowHeights.length) {
    const heightScale = OUTPUT_H / Math.max(1, asNumber(meta.height, 810));
    obj.rowHeights.slice(0, rows.length + 1).forEach((value, index) => {
      table.rows[index].height = asNumber(value) * heightScale;
    });
  }
  applyTableStyle(table, obj, meta);
}

function normalizeChartType(obj) {
  const type = String(obj.chartType || obj.type || '').toLowerCase();
  if (type === 'column') return 'bar';
  return type;
}

function addNativeChart(slide, obj, meta) {
  if (obj.renderMode === 'image' || obj.chartType === 'image') {
    const source = obj.imageSrc || obj.src;
    if (!source) throw new Error(`图片回退图表 ${obj.name} 缺少图片来源`);
    slide.images.add({
      ...imageSource(source),
      alt: obj.name,
      fit: 'cover',
      position: frameFor(nativeFrameFor(obj), meta),
    });
    return;
  }
  const chartType = normalizeChartType(obj);
  if (!CHART_TYPES.has(chartType)) throw new Error(`图表 ${obj.name} 不支持原生导出：${obj.chartType || '未知类型'}`);
  const series = (obj.series || []).map((item, index) => ({
    name: item.name || `系列 ${index + 1}`,
    values: (item.values || []).map(value => Number(value)),
    ...(item.color ? { fill: item.color, line: { style: 'solid', fill: item.color, width: 2 } } : {}),
  }));
  if (!series.length) throw new Error(`图表 ${obj.name} 缺少数据系列`);
  slide.charts.add(chartType, {
    position: frameFor(nativeFrameFor(obj), meta),
    categories: (obj.categories || []).map(String),
    series,
    hasLegend: obj.legend !== false,
    legend: { position: chartType === 'pie' || chartType === 'doughnut' ? 'right' : 'top', textStyle: { fontSize: 9, fill: '#6C817B' } },
    ...(chartType === 'bar' ? { barOptions: { direction: obj.chartType === 'column' ? 'column' : 'column', grouping: 'clustered', gapWidth: 42 } } : {}),
    ...(chartType === 'line' ? { lineOptions: { smooth: Boolean(obj.smooth) } } : {}),
    chartFill: '#FFFFFF',
    plotAreaFill: '#FFFFFF',
    xAxis: { textStyle: { fontSize: 9, fill: '#6C817B' }, line: { style: 'solid', fill: '#DCE9E5', width: 1 } },
    yAxis: { textStyle: { fontSize: 9, fill: '#6C817B' }, majorGridlines: { style: 'solid', fill: '#EDF4F1', width: 1 } },
  });
}

function addNativeImage(slide, obj, meta) {
  if (!obj.src) throw new Error(`图片 ${obj.name} 缺少来源`);
  slide.images.add({
    ...imageSource(obj.src),
    alt: obj.alt || obj.name,
    fit: 'cover',
    position: frameFor(nativeFrameFor(obj), meta),
  });
}

async function main() {
  if (!Array.isArray(deck.slides) || !deck.slides.length) throw new Error('html-pptx-data 没有页面');
  const meta = deck.meta || {};
  const presentation = Presentation.create({ slideSize: { width: OUTPUT_W, height: OUTPUT_H } });
  for (const slideData of deck.slides) {
    const slide = presentation.slides.add();
    slide.background.fill = slideData.background || '#FFFFFF';
    for (const obj of slideData.objects || []) {
      if (!obj.name) throw new Error('PPTX 对象缺少名称');
      if (!obj.frame || !['x', 'y', 'w', 'h'].every(key => Object.hasOwn(obj.frame, key))) {
        throw new Error(`对象 ${obj.name} 缺少 frame.x/y/w/h`);
      }
      if (obj.type === 'text') addNativeText(slide, obj, meta);
      else if (obj.type === 'shape') addNativeShape(slide, obj, meta);
      else if (obj.type === 'table') addNativeTable(slide, obj, meta);
      else if (obj.type === 'chart') addNativeChart(slide, obj, meta);
      else if (obj.type === 'image') addNativeImage(slide, obj, meta);
      else throw new Error(`对象 ${obj.name} 使用了不支持的类型：${obj.type || '未知类型'}`);
    }
  }
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(path.resolve(outputPath));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
