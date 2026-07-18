(() => {
  const SUPPORTED_TYPES = new Set(['text', 'shape', 'chart', 'image']);
  const STYLE_CONTROLS = {
    elementWidth: ['width', 'px'],
    elementHeight: ['height', 'px'],
    elementFontSize: ['fontSize', 'px'],
    elementColor: ['color', ''],
    elementFontWeight: ['fontWeight', ''],
    elementTextAlign: ['textAlign', ''],
    elementLineHeight: ['lineHeight', ''],
    elementBackground: ['backgroundColor', ''],
    elementBorderColor: ['borderColor', ''],
    elementBorderWidth: ['borderWidth', 'px'],
    elementBorderRadius: ['borderRadius', 'px'],
  };

  let selectedElement = null;
  let documentClickBound = false;
  let sectionNavBound = false;
  let typographyResizeBound = false;
  const globalDefaults = new Map();
  const MODULE_ICONS = {
    '导航样式': '◎',
    '章节导航': '◎',
    '排版设置': 'Aa',
    '全局排版': 'Aa',
    '表格设置': '▦',
    '元素独立样式': '◉',
    '元素尺寸': '↔',
    '文本样式': 'T',
    '框体样式': '□',
  };

  function editModeEnabled() {
    return document.body.classList.contains('edit-mode');
  }

  function pxNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function elementType(element) {
    return element?.dataset.editableElement || '';
  }

  function isSinglePageMode() {
    return document.body.dataset.reportMode === 'single-page';
  }

  function shortSectionTitle(title) {
    return Array.from(String(title || '').trim()).slice(0, 6).join('');
  }

  function setAccordionGroupOpen(group, open) {
    const toggle = group.querySelector(':scope > .control-group-toggle');
    const content = group.querySelector(':scope > .control-group-content');
    if (!toggle || !content) return;
    if (open) {
      document.querySelectorAll('.drawer-body > .control-group').forEach(otherGroup => {
        if (otherGroup !== group) setAccordionGroupOpen(otherGroup, false);
      });
    }
    group.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    content.hidden = !open;
  }

  function initAccordionGroups() {
    document.querySelectorAll('.drawer-body > .control-group').forEach((group, index) => {
      if (group.dataset.accordionInitialized === 'true') return;
      const heading = group.querySelector(':scope > h4');
      if (!heading) return;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'control-group-toggle';
      toggle.textContent = heading.textContent.trim();
      toggle.dataset.moduleIcon = MODULE_ICONS[toggle.textContent] || '•';
      toggle.setAttribute('aria-expanded', 'false');

      const content = document.createElement('div');
      content.className = 'control-group-content';
      content.id = `control-group-content-${index + 1}`;
      content.hidden = true;
      toggle.setAttribute('aria-controls', content.id);

      heading.replaceWith(toggle);
      [...group.children].forEach(child => {
        if (child !== toggle) content.appendChild(child);
      });
      group.appendChild(content);
      group.dataset.accordionInitialized = 'true';

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        setAccordionGroupOpen(group, open);
      });
      setAccordionGroupOpen(group, false);
    });
  }

  function reportScale() {
    if (document.body.dataset.reportMode !== 'ppt') return 1;
    const activeSlide = document.querySelector('.slide.active-slide');
    if (activeSlide?.offsetWidth) {
      const scale = activeSlide.getBoundingClientRect().width / activeSlide.offsetWidth;
      if (Number.isFinite(scale) && scale > 0) return scale;
    }
    const scale = typeof window.currentStageScale === 'function' ? Number(window.currentStageScale()) : 1;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function refreshElementControls() {
    const type = elementType(selectedElement);
    document.querySelectorAll('.element-control-group').forEach(group => {
      const types = (group.dataset.elementTypes || '').split(/\s+/).filter(Boolean);
      group.hidden = !selectedElement || !types.includes(type);
    });
    document.querySelectorAll('.element-empty-state').forEach(note => {
      note.hidden = Boolean(selectedElement);
    });
    document.querySelectorAll('.element-selected-state').forEach(state => {
      state.hidden = !selectedElement;
    });
    document.querySelectorAll('[data-selected-element-label]').forEach(label => {
      label.textContent = selectedElement ? `已选中：${selectedElement.dataset.pptxName || selectedElement.dataset.editableElement || '元素'}` : '';
    });
    if (!selectedElement) return;
    const style = getComputedStyle(selectedElement);
    Object.entries(STYLE_CONTROLS).forEach(([id, [property]]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const value = style[property];
      if (id === 'elementWidth') input.value = Math.round(selectedElement.getBoundingClientRect().width / reportScale());
      else if (id === 'elementHeight') input.value = Math.round(selectedElement.getBoundingClientRect().height / reportScale());
      else if (input.type === 'color') {
        input.value = rgbToHex(value) || input.value;
        const hexInput = document.querySelector(`[data-color-target="${id}"]`);
        if (hexInput) hexInput.value = input.value.toUpperCase();
      }
      else if (id === 'elementFontSize' || id === 'elementBorderWidth' || id === 'elementBorderRadius') input.value = Math.round(pxNumber(value));
      else input.value = value;
    });
  }

  function rememberGlobalDefaults() {
    document.querySelectorAll('[data-global-var]').forEach(input => {
      if (!globalDefaults.has(input.dataset.globalVar)) globalDefaults.set(input.dataset.globalVar, input.value);
    });
    const fontFamily = document.getElementById('fontFamily');
    if (fontFamily && !globalDefaults.has('fontFamily')) globalDefaults.set('fontFamily', fontFamily.value);
  }

  function resetGlobalControls() {
    const fontFamily = document.getElementById('fontFamily');
    if (fontFamily && globalDefaults.has('fontFamily')) {
      fontFamily.value = globalDefaults.get('fontFamily');
      document.documentElement.style.removeProperty('--font-family');
    }
    document.querySelectorAll('[data-global-var]').forEach(input => {
      if (!globalDefaults.has(input.dataset.globalVar)) return;
      input.value = globalDefaults.get(input.dataset.globalVar);
      const unit = input.dataset.unit ?? (input.dataset.globalVar === '--body-line-height' ? '' : 'px');
      document.documentElement.style.removeProperty(input.dataset.globalVar);
      const out = document.querySelector(`[data-global-out="${input.dataset.globalVar}"]`);
      if (out) out.textContent = input.value;
    });
    document.body.classList.remove('global-typography-active', 'global-font-active');
    refreshTypographyLabels();
  }

  function resetSelectedStyles(properties) {
    if (!selectedElement) return;
    properties.forEach(property => { selectedElement.style[property] = ''; });
    resizeSelectedChart();
    refreshElementControls();
    refreshTypographyLabels();
    window.dispatchEvent(new Event('resize'));
  }

  function addGroupReset(title, label, onReset) {
    const group = [...document.querySelectorAll('.drawer-body > .control-group')].find(candidate => {
      const toggle = candidate.querySelector(':scope > .control-group-toggle');
      return toggle?.textContent.trim() === title || (title === '全局排版' && toggle?.textContent.trim() === '排版设置');
    });
    const content = group?.querySelector(':scope > .control-group-content');
    if (!content || content.querySelector('.group-reset-btn')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group-reset-btn edit-only';
    button.textContent = label;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onReset();
    });
    content.appendChild(button);
  }

  function initResetButtons() {
    addGroupReset('全局排版', '重置排版设置', resetGlobalControls);
    addGroupReset('元素尺寸', '重置元素尺寸', () => resetSelectedStyles(['width', 'height']));
    addGroupReset('文本样式', '重置文本样式', () => resetSelectedStyles(['fontSize', 'color', 'fontWeight', 'textAlign', 'lineHeight']));
    addGroupReset('框体样式', '重置框体样式', () => resetSelectedStyles(['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius']));
  }

  function typographyLevel(element) {
    if (!element || !(element instanceof Element)) return '正文';
    if (element.matches('[data-ppt-level="metric"], .metric .value, .metric strong')) return '指标';
    if (element.matches('.note, [data-ppt-level="note"]') || element.closest('.note')) return '备注';
    if (element.matches('h1, [data-ppt-level="h1"]')) return 'L1';
    if (element.matches('h2, [data-ppt-level="h2"]')) return 'L2';
    if (element.matches('h3, [data-ppt-level="h3"]')) return 'L3';
    if (element.matches('h4, [data-ppt-level="h4"]')) return 'L4';
    return '正文';
  }

  function typographyTargets() {
    if (!isSinglePageMode()) return [];
    return [...document.querySelectorAll('main h1, main h2, main h3, main h4, main p, main li, main td, main th, main .body-text, main .note, main .metric .value, main .metric strong')];
  }

  function refreshTypographyLabels() {
    if (!isSinglePageMode()) return;
    document.querySelectorAll('.typography-label').forEach(label => label.remove());
    if (!editModeEnabled()) return;
    const fragment = document.createDocumentFragment();
    typographyTargets().forEach(element => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const label = document.createElement('span');
      label.className = 'typography-label';
      label.textContent = typographyLevel(element);
      label.style.left = `${Math.max(4, rect.left + window.scrollX)}px`;
      label.style.top = `${Math.max(4, rect.top + window.scrollY - 18)}px`;
      fragment.appendChild(label);
      element.dataset.typographyLabel = label.textContent;
    });
    document.body.appendChild(fragment);
  }

  function rgbToHex(value) {
    const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return /^#[0-9a-f]{6}$/i.test(value) ? value : '';
    return `#${match.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
  }

  function selectElement(element) {
    if (element && !SUPPORTED_TYPES.has(elementType(element))) return;
    if (selectedElement === element) return;
    selectedElement?.classList.remove('selected-element');
    selectedElement = element || null;
    selectedElement?.classList.add('selected-element');
    refreshElementControls();
    document.dispatchEvent(new CustomEvent('html-report-element-selected', { detail: { element: selectedElement } }));
  }

  function resizeSelectedChart() {
    if (!selectedElement || elementType(selectedElement) !== 'chart' || !window.echarts) return;
    const chartDom = selectedElement.matches('.chart') ? selectedElement : selectedElement.querySelector('.chart');
    if (!chartDom) return;
    window.echarts.getInstanceByDom(chartDom)?.resize();
  }

  function applyElementStyle(input) {
    if (!editModeEnabled() || !selectedElement) return;
    const mapping = STYLE_CONTROLS[input.id];
    if (!mapping) return;
    const [property, unit] = mapping;
    if (input.value === '') return;
    if (property === 'width' || property === 'height') {
      const computed = getComputedStyle(selectedElement);
      if (computed.display === 'inline') selectedElement.style.display = 'inline-block';
      if (property === 'width') {
        selectedElement.style.maxWidth = 'none';
        const parent = selectedElement.parentElement;
        if (parent) {
          const parentStyle = getComputedStyle(parent);
          const mainAxis = parentStyle.flexDirection.startsWith('column') ? 'height' : 'width';
          if (parentStyle.display.includes('flex') && mainAxis === property) selectedElement.style.flex = `0 0 ${input.value}${unit}`;
        }
      }
    }
    selectedElement.style.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), `${input.value}${unit}`, 'important');
    resizeSelectedChart();
    refreshElementControls();
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new CustomEvent('html-report-element-style', {
      detail: { element: selectedElement, property, value: selectedElement.style[property] },
    }));
  }

  function bindGlobalControls() {
    document.querySelectorAll('[data-global-var]').forEach(input => {
      if (input.dataset.globalControlInitialized === 'true') return;
      input.addEventListener('input', () => {
        if (!editModeEnabled()) return;
        const unit = input.dataset.unit ?? (input.dataset.globalVar === '--body-line-height' ? '' : 'px');
        document.documentElement.style.setProperty(input.dataset.globalVar, `${input.value}${unit}`);
        document.body.classList.add('global-typography-active');
        const out = document.querySelector(`[data-global-out="${input.dataset.globalVar}"]`);
        if (out) out.textContent = input.value;
        window.dispatchEvent(new Event('resize'));
        refreshTypographyLabels();
      });
      input.dataset.globalControlInitialized = 'true';
    });
    const fontFamily = document.getElementById('fontFamily');
    if (fontFamily?.dataset.globalControlInitialized === 'true') return;
    fontFamily?.addEventListener('change', event => {
      if (!editModeEnabled()) return;
      document.documentElement.style.setProperty('--font-family', event.target.value);
      document.body.classList.add('global-font-active');
      refreshTypographyLabels();
    });
    if (fontFamily) fontFamily.dataset.globalControlInitialized = 'true';
  }

  function buildSectionNav() {
    if (!isSinglePageMode()) return;
    const nav = document.getElementById('sectionNav');
    if (!nav) return;
    nav.textContent = '';
    const sections = [...document.querySelectorAll('.report-section[data-title]')];
    sections.forEach((section, index) => {
      if (!section.id) section.id = `section-${index + 1}`;
      const fullTitle = section.dataset.title || section.id;
      const link = document.createElement('a');
      link.href = `#${section.id}`;
      link.textContent = shortSectionTitle(fullTitle);
      link.title = fullTitle;
      link.dataset.sectionNavLabel = link.textContent;
      link.addEventListener('click', event => {
        event.preventDefault();
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(link);
    });
  }

  function setSectionNavStyle(style) {
    if (!isSinglePageMode()) return;
    const nextStyle = ['hidden', 'left', 'right'].includes(style) ? style : 'right';
    document.body.classList.remove('section-nav-hidden', 'section-nav-left', 'section-nav-right');
    document.body.classList.add(`section-nav-${nextStyle}`);
    document.querySelectorAll('[data-section-nav-style]').forEach(button => {
      button.classList.toggle('active', button.dataset.sectionNavStyle === nextStyle);
      button.setAttribute('aria-pressed', String(button.dataset.sectionNavStyle === nextStyle));
    });
    refreshTypographyLabels();
  }

  function refreshSectionNavActiveState() {
    if (!isSinglePageMode()) return;
    const sections = [...document.querySelectorAll('.report-section[data-title]')];
    if (!sections.length) return;
    const current = sections.reduce((active, section) => {
      const offset = section.getBoundingClientRect().top;
      return offset <= 120 ? section : active;
    }, sections[0]);
    document.querySelectorAll('#sectionNav a').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === `#${current.id}`);
    });
  }

  function bindSectionNavControls() {
    if (!isSinglePageMode() || sectionNavBound) return;
    document.querySelectorAll('[data-section-nav-style]').forEach(button => {
      button.addEventListener('click', () => setSectionNavStyle(button.dataset.sectionNavStyle));
    });
    window.addEventListener('scroll', refreshSectionNavActiveState, { passive: true });
    window.addEventListener('resize', () => {
      refreshSectionNavActiveState();
      refreshTypographyLabels();
    });
    sectionNavBound = true;
  }

  function bindElementControls() {
    Object.keys(STYLE_CONTROLS).forEach(id => {
      const input = document.getElementById(id);
      if (!input || input.dataset.elementControlInitialized === 'true') return;
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => applyElementStyle(input));
      input.dataset.elementControlInitialized = 'true';
    });
    document.querySelectorAll('[data-color-target]').forEach(input => {
      if (input.dataset.colorHexInitialized === 'true') return;
      const applyHexColor = () => {
        if (!editModeEnabled() || !selectedElement) return;
        const raw = input.value.trim();
        const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
        if (!match) return;
        const hex = match[1].length === 3
          ? `#${match[1].split('').map(char => char + char).join('')}`
          : `#${match[1]}`;
        const colorInput = document.getElementById(input.dataset.colorTarget);
        if (!colorInput) return;
        colorInput.value = hex;
        input.value = hex.toUpperCase();
        applyElementStyle(colorInput);
      };
      input.addEventListener('input', applyHexColor);
      input.addEventListener('change', applyHexColor);
      input.dataset.colorHexInitialized = 'true';
    });
    if (documentClickBound) return;
    document.addEventListener('click', event => {
      if (!editModeEnabled()) return;
      const target = event.target.closest('[data-editable-element]');
      if (target) {
        selectElement(target);
        return;
      }
      if (!event.target.closest('.style-drawer')) selectElement(null);
    });
    documentClickBound = true;
  }

  function bindDeleteControl() {
    const button = document.getElementById('deleteSelectedElement');
    if (!button || button.dataset.deleteControlInitialized === 'true') return;
    button.addEventListener('click', () => {
      if (!editModeEnabled() || !selectedElement) return;
      const element = selectedElement;
      if (!window.confirm('确定删除当前元素吗？')) return;
      selectElement(null);
      element.remove();
      window.syncDeckJsonFromDom?.();
      window.dispatchEvent(new Event('resize'));
    });
    button.dataset.deleteControlInitialized = 'true';
  }

  function fileToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function inlineStandaloneAssets(clone) {
    for (const link of [...clone.querySelectorAll('link[rel="stylesheet"][href]')]) {
      try {
        const response = await fetch(link.href);
        if (!response.ok) continue;
        const style = clone.ownerDocument.createElement('style');
        style.dataset.inlineAsset = link.getAttribute('href');
        style.textContent = await response.text();
        link.replaceWith(style);
      } catch (_error) {
        // Keep the external stylesheet when the browser cannot inline it.
      }
    }
    for (const script of [...clone.querySelectorAll('script[src]')]) {
      try {
        const response = await fetch(script.src);
        if (!response.ok) continue;
        const inline = clone.ownerDocument.createElement('script');
        inline.dataset.inlineAsset = script.getAttribute('src');
        inline.textContent = await response.text();
        script.replaceWith(inline);
      } catch (_error) {
        // Keep the external script when the browser cannot inline it.
      }
    }
    for (const image of [...clone.querySelectorAll('img[src]')]) {
      if (/^data:/i.test(image.getAttribute('src') || '')) continue;
      try {
        const response = await fetch(image.src);
        if (response.ok) image.src = await fileToDataUrl(await response.blob());
      } catch (_error) {
        // Keep the original source when the browser cannot read it.
      }
    }
  }

  async function downloadStandaloneHtml(preserveEditing = false) {
    selectElement(null);
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
    clone.querySelectorAll('.selected-element, .selected-box, .selected-col').forEach(element => {
      element.classList.remove('selected-element', 'selected-box', 'selected-col');
    });
    const body = clone.querySelector('body');
    body?.classList.remove('drawer-open', 'edit-mode');
    body?.classList.remove('export-dialog-open');
    if (!preserveEditing) body?.classList.add('standalone-export');
    const drawer = clone.querySelector('#styleDrawer');
    drawer?.classList.remove('open');
    const toggle = clone.querySelector('#drawerToggle');
    const choice = clone.querySelector('#htmlExportChoice');
    choice?.setAttribute('hidden', '');
    if (!preserveEditing) {
      drawer?.setAttribute('hidden', '');
      if (drawer) drawer.style.display = 'none';
      toggle?.setAttribute('hidden', '');
      if (toggle) toggle.style.display = 'none';
    } else {
      drawer?.removeAttribute('hidden');
      if (drawer) drawer.style.display = '';
      toggle?.removeAttribute('hidden');
      if (toggle) toggle.style.display = '';
    }
    await inlineStandaloneAssets(clone);
    const blob = new Blob(['<!doctype html>\n' + clone.outerHTML], { type: 'text/html;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'html-report-single.html';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function exportSnapshotHtml() {
    selectElement(null);
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
    clone.querySelectorAll('.selected-element, .selected-box, .selected-col').forEach(element => {
      element.classList.remove('selected-element', 'selected-box', 'selected-col');
    });
    clone.querySelectorAll('.typography-label').forEach(element => element.remove());
    const body = clone.querySelector('body');
    body?.classList.remove('drawer-open', 'edit-mode');
    body?.classList.add('standalone-export');
    const drawer = clone.querySelector('#styleDrawer');
    drawer?.setAttribute('hidden', '');
    const toggle = clone.querySelector('#drawerToggle');
    toggle?.setAttribute('hidden', '');
    return '<!doctype html>\n' + clone.outerHTML;
  }

  function previewServiceAvailable() {
    return location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  }

  async function requestInstantExport(format) {
    if (!previewServiceAvailable()) {
      window.alert('请通过本地预览地址打开报告后再进行高保真导出。');
      return false;
    }
    const buttons = [...document.querySelectorAll(`[data-export-format="${format}"], #printPdf, #exportPpt, #downloadLongPng, #downloadLongPdf`)];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: document.body.dataset.reportMode, format, html: exportSnapshotHtml(), title: document.title || 'html-report' }),
      });
      const result = await response.json();
      if (!response.ok || !result.downloadUrl) throw new Error(result.error || '导出失败。');
      const anchor = document.createElement('a');
      anchor.href = result.downloadUrl;
      anchor.download = result.fileName || '';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '导出失败。');
      return false;
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function bindLongExportDownloads() {
    ['downloadLongPng', 'downloadLongPdf'].forEach(id => {
      const button = document.getElementById(id);
      if (!button || button.dataset.longExportInitialized === 'true') return;
      button.addEventListener('click', () => requestInstantExport(id === 'downloadLongPng' ? 'png' : 'pdf'));
      button.dataset.longExportInitialized = 'true';
    });
  }

  function init() {
    initAccordionGroups();
    rememberGlobalDefaults();
    initResetButtons();
    bindGlobalControls();
    bindElementControls();
    bindDeleteControl();
    refreshElementControls();
    if (isSinglePageMode()) {
      buildSectionNav();
      bindSectionNavControls();
      const activeNav = document.body.classList.contains('section-nav-left') ? 'left' : document.body.classList.contains('section-nav-hidden') ? 'hidden' : 'right';
      setSectionNavStyle(activeNav);
      refreshSectionNavActiveState();
      if (!typographyResizeBound) {
        document.addEventListener('input', event => {
          if (event.target.closest('main')) refreshTypographyLabels();
        });
        typographyResizeBound = true;
      }
      const download = document.getElementById('downloadHtml');
      if (download) download.onclick = downloadStandaloneHtml;
      bindLongExportDownloads();
    }
  }

  window.HTMLReportEditor = {
    init,
    initAccordionGroups,
    buildSectionNav,
    setSectionNavStyle,
    shortSectionTitle,
    typographyLevel,
    refreshTypographyLabels,
    selectElement,
    getSelectedElement: () => selectedElement,
    downloadStandaloneHtml,
    exportSnapshotHtml,
    previewServiceAvailable,
    requestInstantExport,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
