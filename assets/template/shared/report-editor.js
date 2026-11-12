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
  const SECTION_NAV_STYLES = ['hidden', 'top', 'embedded-left', 'embedded-right', 'floating-left', 'floating-right', 'dots-left', 'dots-right'];
  const SECTION_NAV_MODES = ['hidden', 'top', 'embedded', 'floating', 'dots'];
  const SECTION_NAV_SIDES = ['left', 'right'];

  let selectedElement = null;
  let recognitionPickMode = false;
  let recognitionCandidate = null;
  let imageCropState = null;
  let documentClickBound = false;
  let sectionNavBound = false;
  const globalDefaults = new Map();
  const MODULE_ICONS = {
    '浏览与模式': '⌘',
    '全局样式': 'Aa',
    '对象编辑': '◉',
    '表格设置': '▦',
    '图表数据': '▧',
    '修复识别': '＋',
    '导出': '⇩',
    '导航样式': '◎',
    '章节导航': '◎',
    '排版设置': 'Aa',
    '全局排版': 'Aa',
    '补充识别': '＋',
    '元素独立样式': '◉',
    '元素尺寸': '↔',
    '文本样式': 'T',
    '框体样式': '□',
  };

  function accordionGroups() {
    return [...document.querySelectorAll('.drawer-body > .control-group, .drawer-repair > .control-group')];
  }

  function editModeEnabled() {
    return document.body.classList.contains('edit-mode');
  }

  function setDataEditContext(context = '') {
    if (context) document.body.dataset.dataEditContext = context;
    else delete document.body.dataset.dataEditContext;
    refreshDataGroupAvailability();
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
    return Array.from(String(title || '').trim()).slice(0, 5).join('');
  }

  function currentSectionNavStyle() {
    const mode = currentSectionNavMode();
    return mode === 'top' || mode === 'hidden' ? mode : `${mode}-${currentSectionNavSide()}`;
  }

  function currentSectionNavMode() {
    if (document.body.classList.contains('section-nav-hidden')) return 'hidden';
    if (document.body.classList.contains('section-nav-top')) return 'top';
    return SECTION_NAV_MODES.find(mode => mode !== 'hidden' && mode !== 'top' && document.body.classList.contains(`section-nav-${mode}-left`))
      || SECTION_NAV_MODES.find(mode => mode !== 'hidden' && mode !== 'top' && document.body.classList.contains(`section-nav-${mode}-right`))
      || 'top';
  }

  function currentSectionNavSide() {
    if (document.body.classList.contains('section-nav-side-right')) return 'right';
    if (document.body.classList.contains('section-nav-side-left')) return 'left';
    return SECTION_NAV_STYLES.some(style => style.endsWith('-right') && document.body.classList.contains(`section-nav-${style}`)) ? 'right' : 'left';
  }

  function isEmbeddedSectionNav(style = currentSectionNavStyle()) {
    return style === 'embedded-left' || style === 'embedded-right';
  }

  function setSectionNavCollapsed(collapsed) {
    if (!isSinglePageMode()) return;
    const enabled = isEmbeddedSectionNav() && Boolean(collapsed);
    document.body.classList.toggle('section-nav-collapsed', enabled);
    const button = document.getElementById('sectionNavCollapse');
    if (button) {
      button.setAttribute('aria-expanded', String(!enabled));
      button.setAttribute('aria-label', enabled ? '展开嵌入导航' : '折叠嵌入导航');
      button.title = button.getAttribute('aria-label');
    }
  }

  function reportCoverTitle() {
    const scope = isSinglePageMode()
      ? document.querySelector('.report-section:not([data-page-hidden="true"])') || document.querySelector('.report-section')
      : document.querySelector('.slide:not([data-page-hidden="true"])') || document.querySelector('.slide');
    const title = scope?.querySelector('h1, [data-ppt-level="h1"]')?.textContent?.replace(/\s+/g, ' ').trim();
    return title || document.title || 'html-report';
  }

  function htmlExportFileName() {
    const normalized = reportCoverTitle()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim();
    const base = Array.from(normalized || 'html-report').slice(0, 72).join('');
    return `${base || 'html-report'}.html`;
  }

  function visibleReportSections() {
    return [...document.querySelectorAll('.report-section[data-title]')]
      .filter(section => section.dataset.pageHidden !== 'true');
  }

  function currentVisibleReportSection() {
    const sections = visibleReportSections();
    if (!sections.length) return null;
    const anchor = Math.min(280, Math.max(120, window.innerHeight * 0.3));
    const intersecting = sections.find(section => {
      const rect = section.getBoundingClientRect();
      return rect.top <= anchor && rect.bottom >= anchor;
    });
    if (intersecting) return intersecting;
    return sections.reduce((nearest, section) => {
      const distance = Math.abs(section.getBoundingClientRect().top - anchor);
      const nearestDistance = Math.abs(nearest.getBoundingClientRect().top - anchor);
      return distance < nearestDistance ? section : nearest;
    }, sections[0]);
  }

  function setPageVisibilityStatus(message, kind = '') {
    const status = document.getElementById('pageVisibilityStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-ok', kind === 'ok');
  }

  function refreshSinglePageVisibilityControl() {
    if (!isSinglePageMode()) return;
    const input = document.getElementById('currentPageVisible');
    if (!input) return;
    const section = currentVisibleReportSection();
    input.checked = Boolean(section);
    input.disabled = !editModeEnabled() || !section;
    if (section) setPageVisibilityStatus(`当前章节：${section.dataset.title || section.id || '未命名'}。隐藏后不会出现在导航或导出文件中。`);
  }

  function setCurrentSinglePageVisibility(visible) {
    if (!isSinglePageMode() || !editModeEnabled()) return;
    const section = currentVisibleReportSection();
    const input = document.getElementById('currentPageVisible');
    if (!section) return;
    if (!visible && visibleReportSections().length <= 1) {
      if (input) input.checked = true;
      setPageVisibilityStatus('至少保留一个可见章节。', 'error');
      return;
    }
    if (visible) section.removeAttribute('data-page-hidden');
    else section.dataset.pageHidden = 'true';
    buildSectionNav();
    refreshSectionNavActiveState();
    refreshSinglePageVisibilityControl();
    document.dispatchEvent(new CustomEvent('html-report-page-visibility', { detail: { element: section, visible } }));
  }

  function restoreHiddenSinglePageSections() {
    if (!isSinglePageMode() || !editModeEnabled()) return;
    const hidden = [...document.querySelectorAll('.report-section[data-page-hidden="true"]')];
    hidden.forEach(section => section.removeAttribute('data-page-hidden'));
    buildSectionNav();
    refreshSectionNavActiveState();
    refreshSinglePageVisibilityControl();
    setPageVisibilityStatus(hidden.length ? `已恢复 ${hidden.length} 个隐藏章节。` : '当前没有隐藏章节。', hidden.length ? 'ok' : '');
  }

  function removeHiddenPagesFromClone(clone) {
    clone.querySelectorAll('.report-section[data-page-hidden="true"]').forEach(section => section.remove());
    const slides = [...clone.querySelectorAll('.slide')];
    if (!slides.length) return;
    const hiddenIndexes = slides
      .map((slide, index) => slide.dataset.pageHidden === 'true' ? index : -1)
      .filter(index => index >= 0);
    if (!hiddenIndexes.length) return;
    const deckData = clone.querySelector('#html-pptx-' + 'data');
    if (deckData) {
      try {
        const deck = JSON.parse(deckData.textContent);
        deck.slides = (deck.slides || []).filter((_slide, index) => !hiddenIndexes.includes(index));
        deckData.textContent = `\n${JSON.stringify(deck, null, 2)}\n  `;
      } catch (_error) {
        // Keep the source data when an unrelated malformed payload cannot be parsed.
      }
    }
    slides.filter(slide => slide.dataset.pageHidden === 'true').forEach(slide => slide.remove());
  }

  function setAccordionGroupOpen(group, open) {
    const toggle = group.querySelector(':scope > .control-group-toggle');
    const content = group.querySelector(':scope > .control-group-content');
    if (!toggle || !content) return;
    if (open) {
      accordionGroups().forEach(otherGroup => {
        if (otherGroup !== group) setAccordionGroupOpen(otherGroup, false);
      });
    }
    group.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    content.hidden = !open;
  }

  function initAccordionGroups() {
    accordionGroups().forEach((group, index) => {
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

  function restoreAccordionMarkupForStandalone(root = document) {
    root.querySelectorAll('.control-group[data-accordion-initialized="true"]').forEach(group => {
      const toggle = group.querySelector(':scope > .control-group-toggle');
      const content = group.querySelector(':scope > .control-group-content');
      if (!toggle || !content) return;
      const heading = (root.ownerDocument || root).createElement('h4');
      heading.textContent = toggle.textContent.trim();
      group.insertBefore(heading, toggle);
      [...content.childNodes].forEach(node => group.insertBefore(node, content));
      toggle.remove();
      content.remove();
      group.classList.remove('is-open');
      delete group.dataset.accordionInitialized;
    });
  }

  function openAccordionGroup(label) {
    const groups = accordionGroups();
    const target = groups.find(group => {
      const toggle = group.querySelector(':scope > .control-group-toggle');
      const heading = group.querySelector(':scope > h4');
      return (toggle?.textContent || heading?.textContent || '').trim() === label;
    });
    if (target) setAccordionGroupOpen(target, true);
  }

  function openDrawerGroupByIntent(intent) {
    const group = document.querySelector(`.drawer-body > .control-group[data-drawer-intent="${intent}"], .drawer-repair > .control-group[data-drawer-intent="${intent}"]`);
    if (group?.classList.contains('is-unavailable')) return;
    if (group) setAccordionGroupOpen(group, true);
  }

  function refreshDataGroupAvailability() {
    [
      {
        intent: 'table',
        available: document.body.dataset.dataEditContext === 'table',
        title: '选中表格单元格后可用',
      },
      {
        intent: 'chart',
        available: selectedElement && elementType(selectedElement) === 'chart',
        title: '选中 ECharts 图表后可用',
      },
    ].forEach(({ intent, available, title }) => {
      const group = document.querySelector(`.drawer-body > .control-group[data-drawer-intent="${intent}"]`);
      if (!group) return;
      const unavailable = editModeEnabled() && !available;
      group.classList.toggle('is-unavailable', unavailable);
      const toggle = group.querySelector(':scope > .control-group-toggle');
      if (toggle) {
        toggle.disabled = unavailable;
        toggle.setAttribute('aria-disabled', String(unavailable));
        toggle.title = unavailable ? title : '';
      }
      group.querySelectorAll('input, select, textarea, button').forEach(control => {
        if (!control.classList.contains('edit-only')) return;
        control.disabled = unavailable || !editModeEnabled();
      });
      if (unavailable && group.classList.contains('is-open')) setAccordionGroupOpen(group, false);
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
    refreshDataGroupAvailability();
    if (!selectedElement) {
      refreshChartDataControls();
      return;
    }
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
    refreshChartDataControls();
  }

  function rememberGlobalDefaults() {
    refreshGlobalControlsFromComputedTypography();
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
  }

  function scopeForGlobalControlSampling() {
    if (document.body.dataset.reportMode === 'ppt') {
      return document.querySelector('.slide.active-slide') || document.querySelector('#deck .slide') || document.querySelector('main');
    }
    return document.querySelector('main') || document.body;
  }

  function firstVisibleElement(selectors) {
    const scope = scopeForGlobalControlSampling();
    if (!scope) return null;
    const elements = selectors.flatMap(selector => [...scope.querySelectorAll(selector)]);
    return elements.find(element => {
      if (!(element instanceof Element)) return false;
      if (element.closest('.style-drawer, .drawer-toggle, #nav, #sectionNav')) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }) || null;
  }

  function computedPxInputValue(element, property = 'fontSize') {
    if (!element) return '';
    const value = pxNumber(getComputedStyle(element)[property], NaN);
    return Number.isFinite(value) ? String(Math.round(value)) : '';
  }

  function computedLineHeightValue(element) {
    if (!element) return '';
    const style = getComputedStyle(element);
    const lineHeight = pxNumber(style.lineHeight, NaN);
    const fontSize = pxNumber(style.fontSize, NaN);
    if (!Number.isFinite(lineHeight)) return '';
    if (Number.isFinite(fontSize) && fontSize > 0) {
      return String(Math.round((lineHeight / fontSize) * 100) / 100);
    }
    return String(Math.round(lineHeight));
  }

  function setGlobalInputDisplay(globalVar, value) {
    if (value === '') return;
    const input = document.querySelector(`[data-global-var="${globalVar}"]`);
    if (!input) return;
    input.value = value;
    const out = document.querySelector(`[data-global-out="${globalVar}"]`);
    if (out) out.textContent = value;
  }

  function refreshGlobalControlsFromComputedTypography() {
    const bodySample = firstVisibleElement(['[data-ppt-level="body"]', 'p', 'li', 'td', 'th', '.body-text']);
    setGlobalInputDisplay('--body-line-height', computedLineHeightValue(bodySample));

    const tableCell = firstVisibleElement(['td', 'th']);
    if (tableCell) {
      const style = getComputedStyle(tableCell);
      setGlobalInputDisplay('--table-cell-padding-y', computedPxInputValue(tableCell, 'paddingTop') || computedPxInputValue(tableCell, 'paddingBottom'));
      setGlobalInputDisplay('--table-cell-padding-x', computedPxInputValue(tableCell, 'paddingLeft') || computedPxInputValue(tableCell, 'paddingRight'));
    }
  }

  function resetSelectedStyles(properties) {
    if (!selectedElement) return;
    properties.forEach(property => { selectedElement.style[property] = ''; });
    resizeSelectedChart();
    refreshElementControls();
    window.dispatchEvent(new Event('resize'));
  }

  function addGroupReset(titles, label, onReset) {
    const titleList = Array.isArray(titles) ? titles : [titles];
    const group = [...document.querySelectorAll('.drawer-body > .control-group, .drawer-repair > .control-group, .drawer-subgroup')].find(candidate => {
      const toggle = candidate.querySelector(':scope > .control-group-toggle');
      const heading = candidate.querySelector(':scope > h5, :scope > h4');
      const title = (toggle?.textContent || heading?.textContent || '').trim();
      return titleList.includes(title);
    });
    const content = group?.querySelector(':scope > .control-group-content') || group;
    if (!content || content.querySelector(':scope > .group-reset-btn')) return;
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
    addGroupReset(['全局样式', '全局排版', '排版设置'], '重置排版设置', resetGlobalControls);
    addGroupReset('元素尺寸', '重置元素尺寸', () => resetSelectedStyles(['width', 'height']));
    addGroupReset('文本样式', '重置文本样式', () => resetSelectedStyles(['fontSize', 'color', 'fontWeight', 'textAlign', 'lineHeight']));
    addGroupReset('框体样式', '重置框体样式', () => resetSelectedStyles(['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius']));
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
    setDataEditContext(selectedElement && elementType(selectedElement) === 'chart' ? 'chart' : '');
    refreshElementControls();
    if (selectedElement) openDrawerGroupByIntent(elementType(selectedElement) === 'chart' ? 'chart' : 'object');
    document.dispatchEvent(new CustomEvent('html-report-element-selected', { detail: { element: selectedElement } }));
  }

  function recognitionStatus(message, kind = '') {
    const status = document.getElementById('recognitionStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-ok', kind === 'ok');
  }

  function setRecognitionCandidate(element) {
    recognitionCandidate?.classList.remove('recognition-candidate');
    recognitionCandidate = element || null;
    recognitionCandidate?.classList.add('recognition-candidate');
    const label = document.getElementById('recognitionCandidateLabel');
    if (label) {
      const name = recognitionCandidate
        ? recognitionCandidate.dataset.pptxName || recognitionCandidate.tagName.toLowerCase()
        : '未选择';
      label.textContent = `待识别：${name}`;
    }
  }

  function setRecognitionPickMode(enabled) {
    recognitionPickMode = Boolean(enabled && editModeEnabled());
    document.body.classList.toggle('recognition-pick-mode', recognitionPickMode);
    if (!recognitionPickMode && !editModeEnabled()) setRecognitionCandidate(null);
    const button = document.getElementById('pickRecognitionElement');
    if (button) button.classList.toggle('active', recognitionPickMode);
    if (recognitionPickMode) {
      openDrawerGroupByIntent('recognition');
      recognitionStatus('请点击页面中需要补充识别的主体元素。');
    }
    else recognitionStatus(recognitionCandidate ? '已选择元素，请选择识别类型。' : '编辑模式下可手动补充漏识别元素。');
  }

  function recognitionTargetFromClick(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest('.style-drawer, .drawer-toggle, nav, #nav, #sectionNav, .html-export-choice')) return null;
    const element = target.closest('main *');
    if (!element) return null;
    if (element.matches('.kicker, .foot, .page-number') || element.closest('.foot')) return null;
    return element;
  }

  function markEditableText(element) {
    element.classList.add('editable');
    element.dataset.editableElement = 'text';
    if (editModeEnabled()) element.setAttribute('contenteditable', 'true');
  }

  function markTableEditable(table) {
    table.querySelectorAll('th, td').forEach(cell => {
      cell.classList.add('editable');
      if (editModeEnabled()) cell.setAttribute('contenteditable', 'true');
    });
  }

  const AUTO_TEXT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'TD', 'TH', 'CAPTION', 'FIGCAPTION', 'BLOCKQUOTE', 'SMALL', 'LABEL', 'DT', 'DD', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'A', 'CODE']);
  const AUTO_TEXT_CLASS_PATTERN = /(?:^|[-_\s])(title|subtitle|heading|label|caption|note|description|summary|copy|text|content|root-label|category-label)(?:$|[-_\s])/i;
  const AUTO_SHAPE_CLASS_PATTERN = /(?:^|[-_\s])(card|panel|box|tile|module|widget|container|inner|surface|banner|callout)(?:$|[-_\s])/i;
  const AUTO_CHART_CLASS_PATTERN = /(?:^|[-_\s])(chart|graph|plot|visualization)(?:$|[-_\s])/i;
  let recognitionObserver = null;

  function isReportContentElement(element) {
    if (!(element instanceof Element) || !element.closest('main')) return false;
    if (element.closest('.style-drawer, .drawer-toggle, .html-export-choice, .preview-export-required, #nav, #sectionNav, script, style, template, svg, .foot, .kicker, .page-number')) return false;
    return true;
  }

  function classTokens(element) {
    return typeof element.className === 'string' ? element.className : '';
  }

  function hasMeaningfulText(element) {
    return (element.textContent || '').replace(/\s+/g, ' ').trim().length > 0;
  }

  function hasDirectText(element) {
    return [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
  }

  function recognizeReportElement(element) {
    if (!isReportContentElement(element) || element.dataset.editableElement) return;
    if (element.parentElement?.closest('[data-editable-element="text"], [data-editable-element="chart"], [data-editable-element="image"]')) return;
    const classes = classTokens(element);
    if (element.matches('img')) {
      element.dataset.editableElement = 'image';
      return;
    }
    if (element.matches('table')) {
      markTableEditable(element);
      return;
    }
    if (element.matches('th, td') && element.closest('table')) {
      element.classList.add('editable');
      if (editModeEnabled()) element.setAttribute('contenteditable', 'true');
      return;
    }
    if (element.matches('.chart, [data-chart-data], [data-chart-option]') || AUTO_CHART_CLASS_PATTERN.test(classes)) {
      element.classList.add('chart');
      element.dataset.editableElement = 'chart';
      return;
    }
    if ((element.matches('article, section, aside') || AUTO_SHAPE_CLASS_PATTERN.test(classes)) && !element.matches('main, .slide, .report-section')) {
      element.dataset.editableElement = 'shape';
      return;
    }
    if (AUTO_TEXT_TAGS.has(element.tagName) || element.matches('[data-ppt-level]') || (AUTO_TEXT_CLASS_PATTERN.test(classes) && hasMeaningfulText(element)) || (hasDirectText(element) && !element.querySelector('h1,h2,h3,h4,h5,h6,p,li,table,.chart,img'))) {
      markEditableText(element);
      return;
    }
  }

  function recognizeReportElements(root = document.querySelector('main')) {
    if (!(root instanceof Element)) return;
    if (isReportContentElement(root)) recognizeReportElement(root);
    root.querySelectorAll('img, table, .chart, [data-chart-data], [data-chart-option], h1, h2, h3, h4, h5, h6, p, li, td, th, caption, figcaption, blockquote, small, label, dt, dd, span, strong, em, b, i, a, code, div, article, section, aside, [data-ppt-level], [class]').forEach(recognizeReportElement);
  }

  function observeReportElementRecognition() {
    if (recognitionObserver || !document.querySelector('main')) return;
    recognitionObserver = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        recognizeReportElements(node);
      }));
    });
    recognitionObserver.observe(document.querySelector('main'), { childList: true, subtree: true });
  }

  function applyRecognitionType(type) {
    if (!editModeEnabled()) {
      recognitionStatus('请先开启编辑模式。', 'error');
      return;
    }
    const candidate = recognitionCandidate || selectedElement;
    if (!candidate) {
      recognitionStatus('请先点击“选择元素”，再点页面中的元素。', 'error');
      return;
    }

    let recognized = candidate;
    if (type === 'text') {
      markEditableText(recognized);
    } else if (type === 'shape') {
      recognized.dataset.editableElement = 'shape';
    } else if (type === 'chart') {
      recognized = candidate.closest('.chart') || (candidate.matches('.chart') ? candidate : candidate.querySelector('.chart') || candidate);
      recognized.dataset.editableElement = 'chart';
      recognized.classList.add('chart');
    } else if (type === 'image') {
      recognized = candidate.matches('img') ? candidate : candidate.querySelector('img');
      if (!recognized) {
        recognitionStatus('未找到图片元素，请直接点图片或包含图片的容器。', 'error');
        return;
      }
      recognized.dataset.editableElement = 'image';
    } else if (type === 'table') {
      recognized = candidate.matches('table') ? candidate : candidate.closest('table') || candidate.querySelector('table');
      if (!recognized) {
        recognitionStatus('未找到真实 table。伪表格需要先改成真实表格。', 'error');
        return;
      }
      markTableEditable(recognized);
      window.syncDeckJsonFromDom?.();
      setRecognitionCandidate(null);
      setRecognitionPickMode(false);
      setDataEditContext('table');
      openDrawerGroupByIntent('table');
      recognitionStatus('表格单元格已设为可编辑。', 'ok');
      return;
    } else {
      recognitionStatus('请选择有效的识别类型。', 'error');
      return;
    }

    window.syncDeckJsonFromDom?.();
    setRecognitionCandidate(null);
    setRecognitionPickMode(false);
    selectElement(recognized);
    openDrawerGroupByIntent(type === 'chart' ? 'chart' : 'object');
    recognitionStatus('元素已补充识别，可继续修改样式或文字。', 'ok');
  }

  function resizeSelectedChart() {
    if (!selectedElement || elementType(selectedElement) !== 'chart' || !window.echarts) return;
    const chartDom = chartDomFromElement(selectedElement);
    if (!chartDom) return;
    window.echarts.getInstanceByDom(chartDom)?.resize();
  }

  function chartDomFromElement(element) {
    if (!element) return null;
    return element.matches?.('.chart') ? element : element.querySelector?.('.chart');
  }

  function chartInstanceFromElement(element) {
    const chartDom = chartDomFromElement(element);
    if (!chartDom || !window.echarts) return null;
    return window.echarts.getInstanceByDom(chartDom) || null;
  }

  function plainSeriesData(data) {
    return (data || []).map(item => {
      if (item && typeof item === 'object' && 'value' in item) return item.value;
      return item;
    });
  }

  function editablePayloadFromChartOption(option) {
    const xAxis = Array.isArray(option?.xAxis) ? option.xAxis[0] : option?.xAxis;
    const yAxis = Array.isArray(option?.yAxis) ? option.yAxis[0] : option?.yAxis;
    const categoryAxis = yAxis?.data ? 'yAxis' : xAxis?.data ? 'xAxis' : '';
    const categories = categoryAxis === 'yAxis' ? yAxis.data : categoryAxis === 'xAxis' ? xAxis.data : [];
    return {
      categories,
      categoryAxis,
      series: (option?.series || []).map(series => ({
        name: series.name || '',
        type: series.type || '',
        data: plainSeriesData(series.data),
      })),
    };
  }

  function currentChartOption(element) {
    const chart = chartInstanceFromElement(element);
    if (chart) return chart.getOption();
    const stored = chartDomFromElement(element)?.dataset.chartOption;
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch (_error) {
      return null;
    }
  }

  function prettyJsonForEditor(value) {
    if (!value) return '';
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return JSON.stringify(parsed, null, 2);
    } catch (_error) {
      return String(value);
    }
  }

  function refreshChartDataControls() {
    const editor = document.getElementById('chartDataEditor');
    const status = document.getElementById('chartDataStatus');
    if (!editor || !status) return;
    status.classList.remove('is-error', 'is-ok');
    if (!selectedElement || elementType(selectedElement) !== 'chart') {
      editor.value = '';
      status.textContent = '支持 categories / series，或 { "option": {...} }。';
      return;
    }
    const option = currentChartOption(selectedElement);
    if (!option) {
      editor.value = '';
      status.textContent = '未找到 ECharts 实例。请确认图表已渲染。';
      status.classList.add('is-error');
      return;
    }
    const stored = chartDomFromElement(selectedElement)?.dataset.chartData;
    if (stored) editor.value = prettyJsonForEditor(stored);
    else editor.value = JSON.stringify(editablePayloadFromChartOption(option), null, 2);
    status.textContent = '修改 JSON 后点击“应用图表数据”。';
  }

  function mergedChartOption(baseOption, payload) {
    if (payload && typeof payload === 'object' && payload.option) return payload.option;
    const next = JSON.parse(JSON.stringify(baseOption || {}));
    const categoryAxis = payload.categoryAxis === 'xAxis' || payload.categoryAxis === 'yAxis'
      ? payload.categoryAxis
      : Array.isArray(next.yAxis) && next.yAxis[0]?.data
        ? 'yAxis'
        : 'xAxis';
    if (Array.isArray(payload.categories)) {
      const axes = Array.isArray(next[categoryAxis]) ? next[categoryAxis] : [next[categoryAxis] || {}];
      axes[0] = { ...axes[0], type: axes[0].type || 'category', data: payload.categories };
      next[categoryAxis] = axes;
    }
    if (Array.isArray(payload.series)) {
      const existing = Array.isArray(next.series) ? next.series : [];
      next.series = payload.series.map((series, index) => ({
        ...(existing[index] || {}),
        ...(series.type ? { type: series.type } : {}),
        ...(series.name ? { name: series.name } : {}),
        data: Array.isArray(series.data) ? series.data : Array.isArray(series.values) ? series.values : [],
      }));
    }
    return next;
  }

  function setChartDataStatus(message, kind = '') {
    const status = document.getElementById('chartDataStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-ok', kind === 'ok');
  }

  function applyChartDataEditor() {
    if (!editModeEnabled() || !selectedElement || elementType(selectedElement) !== 'chart') return;
    const editor = document.getElementById('chartDataEditor');
    const chartDom = chartDomFromElement(selectedElement);
    const chart = chartInstanceFromElement(selectedElement);
    if (!editor || !chartDom || !chart) {
      setChartDataStatus('未找到可编辑的 ECharts 图表。', 'error');
      return;
    }
    let payload;
    try {
      payload = JSON.parse(editor.value);
    } catch (error) {
      setChartDataStatus(`JSON 格式错误：${error.message}`, 'error');
      return;
    }
    const option = mergedChartOption(chart.getOption(), payload);
    chart.setOption(option, true);
    chart.resize();
    const normalizedPayload = payload.option ? editablePayloadFromChartOption(option) : payload;
    const payloadText = JSON.stringify(normalizedPayload, null, 2);
    chartDom.dataset.chartData = payloadText;
    chartDom.dataset.chartOption = JSON.stringify(option);
    editor.value = payloadText;
    window.syncDeckJsonFromDom?.();
    setChartDataStatus('图表数据已应用并保存到页面。', 'ok');
  }

  function applyStoredChartOptions() {
    if (!window.echarts) return;
    document.querySelectorAll('[data-editable-element="chart"].chart[data-chart-option], [data-editable-element="chart"] .chart[data-chart-option]').forEach(chartDom => {
      const chart = window.echarts.getInstanceByDom(chartDom);
      if (!chart) return;
      try {
        chart.setOption(JSON.parse(chartDom.dataset.chartOption), true);
        chart.resize();
      } catch (_error) {
        // Keep the chart's generated option when saved data is invalid.
      }
    });
  }

  function applyElementStyle(input) {
    if (!editModeEnabled() || !selectedElement) return;
    const mapping = STYLE_CONTROLS[input.id];
    if (!mapping) return;
    const [property, unit] = mapping;
    if (input.value === '') return;
    let nextValue = input.value;
    if (property === 'width' || property === 'height') {
      const computed = getComputedStyle(selectedElement);
      if (computed.display === 'inline') selectedElement.style.display = 'inline-block';
      if (property === 'width') {
        if (isSinglePageMode() && elementType(selectedElement) === 'chart') {
          const parentWidth = selectedElement.parentElement?.getBoundingClientRect().width || 0;
          const scaledParentWidth = Math.floor(parentWidth / reportScale());
          const numericValue = parseFloat(input.value);
          if (scaledParentWidth > 0 && Number.isFinite(numericValue)) nextValue = String(Math.min(numericValue, scaledParentWidth));
          selectedElement.style.maxWidth = '100%';
        } else {
          selectedElement.style.maxWidth = 'none';
        }
        const parent = selectedElement.parentElement;
        if (parent) {
          const parentStyle = getComputedStyle(parent);
          const mainAxis = parentStyle.flexDirection.startsWith('column') ? 'height' : 'width';
          if (parentStyle.display.includes('flex') && mainAxis === property) selectedElement.style.flex = `0 0 ${nextValue}${unit}`;
        }
      }
    }
    selectedElement.style.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), `${nextValue}${unit}`, 'important');
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
      });
      input.dataset.globalControlInitialized = 'true';
    });
    const fontFamily = document.getElementById('fontFamily');
    if (fontFamily?.dataset.globalControlInitialized === 'true') return;
    const applyFontFamily = event => {
      if (!editModeEnabled()) return;
      document.documentElement.style.setProperty('--font-family', event.target.value.replace(/\s*\n\s*/g, ' ').trim());
      document.body.classList.add('global-font-active');
    };
    fontFamily?.addEventListener('input', applyFontFamily);
    fontFamily?.addEventListener('change', applyFontFamily);
    if (fontFamily) fontFamily.dataset.globalControlInitialized = 'true';
  }

  function buildSectionNav() {
    if (!isSinglePageMode()) return;
    const nav = document.getElementById('sectionNav');
    if (!nav) return;
    nav.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'section-nav-panel';
    const collapse = document.createElement('button');
    collapse.className = 'section-nav-collapse';
    collapse.id = 'sectionNavCollapse';
    collapse.type = 'button';
    collapse.textContent = '‹';
    collapse.addEventListener('click', () => setSectionNavCollapsed(!document.body.classList.contains('section-nav-collapsed')));
    panel.appendChild(collapse);

    const sections = visibleReportSections();
    let previousChapter = '';
    sections.forEach((section, index) => {
      if (!section.id) section.id = `section-${index + 1}`;
      const chapter = (section.dataset.chapter || `第 ${String(index + 1).padStart(2, '0')} 章`).trim();
      if (chapter !== previousChapter) {
        const chapterGroup = document.createElement('div');
        chapterGroup.className = 'section-nav-chapter';
        const link = document.createElement('a');
        link.className = 'section-nav-chapter-link';
        link.href = `#${section.id}`;
        link.textContent = shortSectionTitle(chapter);
        link.title = chapter;
        link.dataset.sectionNavChapter = chapter;
        link.addEventListener('click', event => {
          event.preventDefault();
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        chapterGroup.appendChild(link);
        panel.appendChild(chapterGroup);
        previousChapter = chapter;
      }
    });
    nav.appendChild(panel);
    setSectionNavCollapsed(document.body.classList.contains('section-nav-collapsed'));
  }

  function setSectionNavStyle(style) {
    const nextStyle = SECTION_NAV_STYLES.includes(style) ? style : 'top';
    if (nextStyle === 'hidden' || nextStyle === 'top') {
      setSectionNavPresentation(nextStyle, currentSectionNavSide());
      return;
    }
    const [mode, side] = nextStyle.split('-');
    setSectionNavPresentation(mode, side);
  }

  function setSectionNavPresentation(mode, side) {
    if (!isSinglePageMode()) return;
    const nextMode = SECTION_NAV_MODES.includes(mode) ? mode : 'top';
    const nextSide = SECTION_NAV_SIDES.includes(side) ? side : 'left';
    document.body.classList.remove(...SECTION_NAV_STYLES.map(item => `section-nav-${item}`));
    document.body.classList.remove(...SECTION_NAV_SIDES.map(item => `section-nav-side-${item}`));
    document.body.classList.add(nextMode === 'top' || nextMode === 'hidden' ? `section-nav-${nextMode}` : `section-nav-${nextMode}-${nextSide}`);
    document.body.classList.add(`section-nav-side-${nextSide}`);
    if (nextMode !== 'embedded') setSectionNavCollapsed(false);
    const modeControl = document.getElementById('sectionNavStyleControl');
    const sideControl = document.getElementById('sectionNavSideControl');
    if (modeControl) modeControl.value = nextMode;
    if (sideControl) sideControl.value = nextSide;
  }

  function refreshSectionNavActiveState() {
    if (!isSinglePageMode()) return;
    const current = currentVisibleReportSection();
    if (!current) return;
    const sectionIndex = visibleReportSections().indexOf(current);
    const chapter = (current.dataset.chapter || `第 ${String(sectionIndex + 1).padStart(2, '0')} 章`).trim();
    document.querySelectorAll('#sectionNav a').forEach(link => {
      link.classList.toggle('active', link.dataset.sectionNavChapter === chapter);
    });
    refreshSinglePageVisibilityControl();
  }

  function bindSectionNavControls() {
    if (!isSinglePageMode() || sectionNavBound) return;
    const applySectionNavControls = () => setSectionNavPresentation(
      document.getElementById('sectionNavStyleControl')?.value,
      document.getElementById('sectionNavSideControl')?.value,
    );
    document.getElementById('sectionNavStyleControl')?.addEventListener('change', applySectionNavControls);
    document.getElementById('sectionNavSideControl')?.addEventListener('change', applySectionNavControls);
    document.getElementById('currentPageVisible')?.addEventListener('change', event => {
      setCurrentSinglePageVisibility(event.target.checked);
    });
    document.getElementById('restoreHiddenPages')?.addEventListener('click', restoreHiddenSinglePageSections);
    window.addEventListener('scroll', refreshSectionNavActiveState, { passive: true });
    window.addEventListener('resize', () => {
      refreshSectionNavActiveState();
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
    bindChartDataControls();
    bindRecognitionControls();
    if (documentClickBound) return;
    document.addEventListener('click', event => {
      if (!editModeEnabled()) return;
      if (recognitionPickMode) {
        const candidate = recognitionTargetFromClick(event.target);
        if (candidate) {
          event.preventDefault();
          event.stopPropagation();
          setRecognitionCandidate(candidate);
          setRecognitionPickMode(false);
          recognitionStatus(candidate.dataset.editableElement ? '该元素已被识别，可重新选择类型覆盖。' : '已选择元素，请选择识别类型。');
        }
        return;
      }
      const target = event.target.closest('[data-editable-element]');
      if (target) {
        if (target.matches('label[for]') && document.getElementById(target.htmlFor)) event.preventDefault();
        selectElement(target);
        return;
      }
      if (!event.target.closest('.style-drawer, #imageCropDialog')) selectElement(null);
    });
    documentClickBound = true;
  }

  function bindRecognitionControls() {
    const pick = document.getElementById('pickRecognitionElement');
    if (pick && pick.dataset.recognitionPickInitialized !== 'true') {
      pick.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!editModeEnabled()) {
          recognitionStatus('请先开启编辑模式。', 'error');
          return;
        }
        setRecognitionPickMode(!recognitionPickMode);
      });
      pick.dataset.recognitionPickInitialized = 'true';
    }
    document.querySelectorAll('[data-recognition-type]').forEach(button => {
      if (button.dataset.recognitionTypeInitialized === 'true') return;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        applyRecognitionType(button.dataset.recognitionType);
      });
      button.dataset.recognitionTypeInitialized = 'true';
    });
  }

  function bindChartDataControls() {
    const button = document.getElementById('applyChartData');
    if (!button || button.dataset.chartDataInitialized === 'true') return;
    button.addEventListener('click', event => {
      event.preventDefault();
      applyChartDataEditor();
    });
    button.dataset.chartDataInitialized = 'true';
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

  function setImageReplacementStatus(message, kind = '') {
    const status = document.getElementById('imageReplacementStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-ok', kind === 'ok');
  }

  function fileToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function selectedImageForReplacement() {
    if (!editModeEnabled() || !selectedElement || elementType(selectedElement) !== 'image' || !selectedElement.matches('img')) {
      setImageReplacementStatus('请先在编辑模式下选中一张图片。', 'error');
      return null;
    }
    return selectedElement;
  }

  function validImageFile(file) {
    if (file && /^image\//i.test(file.type)) return true;
    setImageReplacementStatus('请选择有效的图片文件。', 'error');
    return false;
  }

  function applyImageDataUrl(image, dataUrl, file, cropped = false) {
    if (!image || !document.contains(image)) return false;
    const scale = reportScale();
    const rect = image.getBoundingClientRect();
    const pixelValue = value => `${Math.round((value / scale) * 1000) / 1000}px`;
    image.style.setProperty('width', pixelValue(rect.width), 'important');
    image.style.setProperty('height', pixelValue(rect.height), 'important');
    image.setAttribute('src', dataUrl);
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    window.syncDeckJsonFromDom?.();
    refreshElementControls();
    document.dispatchEvent(new CustomEvent('html-report-image-replaced', { detail: { element: image, file, cropped } }));
    setImageReplacementStatus(`${cropped ? '已裁剪并替换为' : '已替换为'} ${file?.name || '本地图片'}，导出将保留新图片。`, 'ok');
    return true;
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
  }

  function ensureImageCropDialog() {
    let dialog = document.getElementById('imageCropDialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'imageCropDialog';
    dialog.className = 'image-crop-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'imageCropTitle');
    dialog.innerHTML = `
      <section class="image-crop-panel">
        <header class="image-crop-header">
          <div><h3 id="imageCropTitle">裁剪图片</h3><p>拖动图片调整位置，再用缩放控制画面范围。</p></div>
          <button type="button" class="image-crop-close" data-image-crop-cancel aria-label="取消裁剪">×</button>
        </header>
        <div class="image-crop-preview-wrap"><canvas id="imageCropPreview" aria-label="图片裁剪预览"></canvas></div>
        <label class="image-crop-zoom" for="imageCropZoom"><span>缩放</span><input id="imageCropZoom" type="range" min="100" max="600" value="100" step="1"><output id="imageCropZoomValue">100%</output></label>
        <footer class="image-crop-actions"><button type="button" class="image-crop-cancel" data-image-crop-cancel>取消</button><button type="button" class="image-crop-apply" id="applyImageCrop">应用裁剪</button></footer>
      </section>`;
    document.body.appendChild(dialog);

    const preview = dialog.querySelector('#imageCropPreview');
    const zoom = dialog.querySelector('#imageCropZoom');
    const cancel = () => closeImageCropDialog();
    dialog.querySelectorAll('[data-image-crop-cancel]').forEach(button => button.addEventListener('click', cancel));
    dialog.addEventListener('click', event => { if (event.target === dialog) cancel(); });
    zoom.addEventListener('input', () => {
      if (!imageCropState) return;
      imageCropState.scale = imageCropState.minScale * (Number(zoom.value) / 100);
      clampImageCropOffset(imageCropState);
      drawImageCropPreview();
    });
    preview.addEventListener('pointerdown', event => {
      if (!imageCropState) return;
      imageCropState.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: imageCropState.offsetX, offsetY: imageCropState.offsetY };
      preview.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    preview.addEventListener('pointermove', event => {
      const state = imageCropState;
      if (!state?.drag || state.drag.pointerId !== event.pointerId) return;
      state.offsetX = state.drag.offsetX + event.clientX - state.drag.x;
      state.offsetY = state.drag.offsetY + event.clientY - state.drag.y;
      clampImageCropOffset(state);
      drawImageCropPreview();
    });
    const stopDragging = event => {
      if (imageCropState?.drag?.pointerId === event.pointerId) imageCropState.drag = null;
    };
    preview.addEventListener('pointerup', stopDragging);
    preview.addEventListener('pointercancel', stopDragging);
    dialog.querySelector('#applyImageCrop').addEventListener('click', applyImageCrop);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !dialog.hidden) closeImageCropDialog();
    });
    return dialog;
  }

  function cropPreviewSize(aspect) {
    const maxWidth = Math.min(620, Math.max(260, window.innerWidth - 72));
    const maxHeight = Math.min(420, Math.max(190, window.innerHeight - 290));
    if (maxWidth / maxHeight > aspect) return { width: Math.round(maxHeight * aspect), height: Math.round(maxHeight) };
    return { width: Math.round(maxWidth), height: Math.round(maxWidth / aspect) };
  }

  function clampImageCropOffset(state) {
    const scaledWidth = state.source.naturalWidth * state.scale;
    const scaledHeight = state.source.naturalHeight * state.scale;
    const limitX = Math.max(0, (scaledWidth - state.stageWidth) / 2);
    const limitY = Math.max(0, (scaledHeight - state.stageHeight) / 2);
    state.offsetX = Math.min(limitX, Math.max(-limitX, state.offsetX));
    state.offsetY = Math.min(limitY, Math.max(-limitY, state.offsetY));
  }

  function drawImageCropPreview() {
    const state = imageCropState;
    const dialog = document.getElementById('imageCropDialog');
    const canvas = dialog?.querySelector('#imageCropPreview');
    const zoom = dialog?.querySelector('#imageCropZoom');
    const zoomValue = dialog?.querySelector('#imageCropZoomValue');
    if (!state || !canvas) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(state.stageWidth * dpr);
    canvas.height = Math.round(state.stageHeight * dpr);
    canvas.style.width = `${state.stageWidth}px`;
    canvas.style.height = `${state.stageHeight}px`;
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, state.stageWidth, state.stageHeight);
    const scaledWidth = state.source.naturalWidth * state.scale;
    const scaledHeight = state.source.naturalHeight * state.scale;
    context.drawImage(state.source, (state.stageWidth - scaledWidth) / 2 + state.offsetX, (state.stageHeight - scaledHeight) / 2 + state.offsetY, scaledWidth, scaledHeight);
    if (zoom) zoom.value = String(Math.round((state.scale / state.minScale) * 100));
    if (zoomValue) zoomValue.value = `${zoom?.value || 100}%`;
  }

  function closeImageCropDialog() {
    const dialog = document.getElementById('imageCropDialog');
    dialog?.setAttribute('hidden', '');
    dialog?.removeAttribute('data-crop-aspect');
    dialog?.removeAttribute('data-original-src');
    document.body.classList.remove('image-crop-open');
    imageCropState = null;
  }

  function croppedImageDataUrl(state) {
    const outputWidth = Math.round(Math.min(2400, Math.max(720, state.stageWidth * 2)));
    const outputHeight = Math.max(1, Math.round(outputWidth / state.aspect));
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const factor = outputWidth / state.stageWidth;
    const scaledWidth = state.source.naturalWidth * state.scale;
    const scaledHeight = state.source.naturalHeight * state.scale;
    canvas.getContext('2d').drawImage(
      state.source,
      ((state.stageWidth - scaledWidth) / 2 + state.offsetX) * factor,
      ((state.stageHeight - scaledHeight) / 2 + state.offsetY) * factor,
      scaledWidth * factor,
      scaledHeight * factor,
    );
    return canvas.toDataURL('image/png');
  }

  function applyImageCrop() {
    const state = imageCropState;
    if (!state) return;
    try {
      const dataUrl = croppedImageDataUrl(state);
      applyImageDataUrl(state.target, dataUrl, state.file, true);
      closeImageCropDialog();
    } catch (_error) {
      setImageReplacementStatus('图片裁剪失败，请重新选择图片。', 'error');
    }
  }

  async function openImageCropper(file) {
    const target = selectedImageForReplacement();
    if (!target || !validImageFile(file)) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const source = await loadImageFromDataUrl(dataUrl);
      if (!document.contains(target)) return;
      const rect = target.getBoundingClientRect();
      const fallbackAspect = target.naturalWidth && target.naturalHeight ? target.naturalWidth / target.naturalHeight : 1;
      const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : fallbackAspect;
      const { width: stageWidth, height: stageHeight } = cropPreviewSize(Math.max(.1, aspect));
      const minScale = Math.max(stageWidth / source.naturalWidth, stageHeight / source.naturalHeight);
      imageCropState = { target, file, source, aspect, stageWidth, stageHeight, minScale, scale: minScale, offsetX: 0, offsetY: 0, drag: null };
      const dialog = ensureImageCropDialog();
      dialog.dataset.cropAspect = String(aspect);
      dialog.dataset.originalSrc = target.getAttribute('src') || '';
      dialog.hidden = false;
      document.body.classList.add('image-crop-open');
      drawImageCropPreview();
      setImageReplacementStatus('请在裁剪面板中调整图片后应用。');
    } catch (_error) {
      setImageReplacementStatus('图片读取失败，请选择其他图片重试。', 'error');
    }
  }

  async function replaceSelectedImage(file) {
    const image = selectedImageForReplacement();
    if (!image || !validImageFile(file)) return;
    try {
      applyImageDataUrl(image, await fileToDataUrl(file), file);
    } catch (_error) {
      setImageReplacementStatus('图片读取失败，请选择其他图片重试。', 'error');
    }
  }

  function bindImageReplacementControl() {
    const trigger = document.getElementById('replaceImageTrigger');
    const input = document.getElementById('replaceImageInput');
    if (trigger && input && trigger.dataset.imageReplacementInitialized !== 'true') {
      trigger.addEventListener('click', event => {
        event.preventDefault();
        if (!selectedImageForReplacement()) return;
        input.click();
      });
      trigger.dataset.imageReplacementInitialized = 'true';
    }
    if (!input || input.dataset.imageReplacementInitialized === 'true') return;
    input.addEventListener('change', async () => {
      const [file] = input.files || [];
      input.value = '';
      await openImageCropper(file);
    });
    input.dataset.imageReplacementInitialized = 'true';
  }

  function canInlineStandaloneUrl(value) {
    return Boolean(value) && !/^(?:data:|blob:|#|javascript:|mailto:|tel:)/i.test(value.trim());
  }

  async function inlineStandaloneUrl(value, baseUrl = document.baseURI) {
    if (!canInlineStandaloneUrl(value)) return value;
    try {
      const resolved = new URL(value, baseUrl).href;
      const response = await fetch(resolved);
      if (!response.ok) return value;
      return await fileToDataUrl(await response.blob());
    } catch (_error) {
      return value;
    }
  }

  async function inlineStandaloneCssUrls(css, baseUrl) {
    const references = [];
    const withPlaceholders = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, reference) => {
      const index = references.push({ match, reference: reference.trim() }) - 1;
      return `__HTML_REPORT_ASSET_${index}__`;
    });
    const replacements = await Promise.all(references.map(async ({ match, reference }) => {
      if (!canInlineStandaloneUrl(reference)) return match;
      const inlined = await inlineStandaloneUrl(reference, baseUrl);
      return inlined === reference ? match : `url("${inlined}")`;
    }));
    return replacements.reduce((result, replacement, index) => result.replace(`__HTML_REPORT_ASSET_${index}__`, replacement), withPlaceholders);
  }

  async function inlineStandaloneJsonAssets(value, key = '') {
    if (Array.isArray(value)) return Promise.all(value.map(item => inlineStandaloneJsonAssets(item)));
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([childKey, childValue]) => (
        [childKey, await inlineStandaloneJsonAssets(childValue, childKey)]
      )));
      return Object.fromEntries(entries);
    }
    if (typeof value === 'string' && /^(?:src|imageSrc|imageUrl)$/i.test(key)) {
      return inlineStandaloneUrl(value);
    }
    return value;
  }

  async function inlineStandaloneAssets(clone) {
    for (const link of [...clone.querySelectorAll('link[rel="stylesheet"][href]')]) {
      try {
        const response = await fetch(link.href);
        if (!response.ok) continue;
        const style = clone.ownerDocument.createElement('style');
        style.dataset.inlineAsset = link.getAttribute('href');
        style.textContent = await inlineStandaloneCssUrls(await response.text(), link.href);
        link.replaceWith(style);
      } catch (_error) {
        // Keep the external stylesheet when the browser cannot inline it.
      }
    }
    for (const style of [...clone.querySelectorAll('style')]) {
      style.textContent = await inlineStandaloneCssUrls(style.textContent, document.baseURI);
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
      const original = image.getAttribute('src') || '';
      const inlined = await inlineStandaloneUrl(image.currentSrc || image.src);
      if (inlined !== image.currentSrc && inlined !== image.src && inlined !== original) {
        image.setAttribute('src', inlined);
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.closest('picture')?.querySelectorAll('source').forEach(source => source.remove());
      }
    }
    for (const image of [...clone.querySelectorAll('svg image[href], svg image[xlink\\:href]')]) {
      const attribute = image.hasAttribute('href') ? 'href' : 'xlink:href';
      const original = image.getAttribute(attribute) || '';
      const inlined = await inlineStandaloneUrl(original);
      if (inlined !== original) image.setAttribute(attribute, inlined);
    }
    for (const element of [...clone.querySelectorAll('[style*="url("]')]) {
      element.style.cssText = await inlineStandaloneCssUrls(element.style.cssText, document.baseURI);
    }
    for (const node of [...clone.querySelectorAll('script[type="application/json"]')]) {
      try {
        node.textContent = JSON.stringify(await inlineStandaloneJsonAssets(JSON.parse(node.textContent)));
      } catch (_error) {
        // Leave non-JSON or malformed data payloads untouched.
      }
    }
  }

  function triggerStandaloneHtmlDownload(html, filename) {
    const blob = new Blob(['<!doctype html>\n' + html], { type: 'text/html;charset=utf-8' });
    const anchor = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }, 1500);
  }

  async function downloadStandaloneHtml(preserveEditing = false) {
    if (!requirePreviewService()) return false;
    selectElement(null);
    const clone = document.documentElement.cloneNode(true);
    removeHiddenPagesFromClone(clone);
    clone.querySelector('#imageCropDialog')?.remove();
    clone.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
    clone.querySelectorAll('.selected-element, .selected-box, .selected-col').forEach(element => {
      element.classList.remove('selected-element', 'selected-box', 'selected-col');
    });
    restoreAccordionMarkupForStandalone(clone);
    const body = clone.querySelector('body');
    body?.classList.remove('drawer-open', 'edit-mode', 'preview-export-dialog-open');
    body?.classList.remove('export-dialog-open');
    if (!preserveEditing) body?.classList.add('standalone-export');
    const drawer = clone.querySelector('#styleDrawer');
    drawer?.classList.remove('open');
    const toggle = clone.querySelector('#drawerToggle');
    const choice = clone.querySelector('#htmlExportChoice');
    choice?.setAttribute('hidden', '');
    const previewExportRequired = clone.querySelector('#previewExportRequired');
    previewExportRequired?.setAttribute('hidden', '');
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
    // Do not introduce an async hop when assets are already inlined: browsers otherwise
    // may no longer treat the save action as initiated by the user's click.
    await inlineStandaloneAssets(clone);
    triggerStandaloneHtmlDownload(clone.outerHTML, htmlExportFileName());
    return true;
  }

  function exportSnapshotHtml(syncPptxData = false) {
    selectElement(null);
    if (syncPptxData) window.syncDeckJsonFromDom?.();
    const clone = document.documentElement.cloneNode(true);
    removeHiddenPagesFromClone(clone);
    clone.querySelector('#imageCropDialog')?.remove();
    clone.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
    clone.querySelectorAll('.selected-element, .selected-box, .selected-col').forEach(element => {
      element.classList.remove('selected-element', 'selected-box', 'selected-col');
    });
    const body = clone.querySelector('body');
    body?.classList.remove('drawer-open', 'edit-mode', 'preview-export-dialog-open');
    body?.classList.add('standalone-export');
    const drawer = clone.querySelector('#styleDrawer');
    drawer?.setAttribute('hidden', '');
    const toggle = clone.querySelector('#drawerToggle');
    toggle?.setAttribute('hidden', '');
    clone.querySelector('#previewExportRequired')?.setAttribute('hidden', '');
    return '<!doctype html>\n' + clone.outerHTML;
  }

  function previewServiceAvailable() {
    return location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  }

  function setPreviewExportRequiredOpen(open) {
    const dialog = document.getElementById('previewExportRequired');
    if (!dialog) return;
    dialog.toggleAttribute('hidden', !open);
    document.body.classList.toggle('preview-export-dialog-open', open);
  }

  function refreshPreviewExportHint() {
    const ready = previewServiceAvailable();
    document.querySelectorAll('[data-preview-export-hint]').forEach(hint => {
      hint.textContent = ready
        ? '本地预览服务已连接，可导出独立 HTML、图片、PDF 和 PPTX。'
        : '导出独立 HTML、图片、PDF 和 PPTX 前，请通过本地预览服务地址打开报告。';
      hint.classList.toggle('is-ready', ready);
    });
  }

  function requirePreviewService() {
    if (previewServiceAvailable()) return true;
    refreshPreviewExportHint();
    const dialog = document.getElementById('previewExportRequired');
    if (dialog) setPreviewExportRequiredOpen(true);
    else window.alert('请通过本地预览服务地址打开报告后，再导出独立 HTML、图片、PDF 或 PPTX。');
    return false;
  }

  function bindPreviewExportRequiredDialog() {
    const dialog = document.getElementById('previewExportRequired');
    if (dialog && dialog.dataset.previewExportRequiredInitialized !== 'true') {
      dialog.querySelectorAll('[data-preview-export-required-close]').forEach(button => {
        button.addEventListener('click', () => setPreviewExportRequiredOpen(false));
      });
      dialog.addEventListener('click', event => {
        if (event.target === dialog) setPreviewExportRequiredOpen(false);
      });
      dialog.dataset.previewExportRequiredInitialized = 'true';
    }
    refreshPreviewExportHint();
  }

  async function requestInstantExport(format) {
    if (!requirePreviewService()) return false;
    const buttons = [...document.querySelectorAll(`[data-export-format="${format}"], #printPdf, #exportPpt, #downloadLongPng, #downloadLongPdf`)];
    const activeButtons = buttons.filter(button => (
      button.matches(`[data-export-format="${format}"]`) ||
      (format === 'pdf' && button.matches('#printPdf, #downloadLongPdf')) ||
      (format === 'pptx' && button.matches('#exportPpt')) ||
      (format === 'png' && button.matches('#downloadLongPng'))
    ));
    const originalLabels = new Map(activeButtons.map(button => [button, button.textContent]));
    buttons.forEach(button => { button.disabled = true; });
    activeButtons.forEach(button => { button.textContent = format === 'png' ? '生成图片中…' : '导出中…'; });
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: document.body.dataset.reportMode, format, html: exportSnapshotHtml(format === 'pdf' || format === 'pptx'), title: document.title || 'html-report' }),
      });
      const result = await response.json();
      const downloadUrls = Array.isArray(result.downloadUrls) && result.downloadUrls.length
        ? result.downloadUrls
        : (result.downloadUrl ? [result.downloadUrl] : []);
      if (!response.ok || !downloadUrls.length) throw new Error(result.error || '导出失败。');
      downloadUrls.forEach((downloadUrl, index) => {
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = result.fileNames?.[index] || result.fileName || '';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      });
      if (format === 'png' && downloadUrls.length > 1) {
        window.alert(`已生成 ${downloadUrls.length} 张 PNG 图片（一页一张）。若浏览器拦截连续下载，可在报告目录的 exports 文件夹中直接获取全部图片。`);
      }
      return true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '导出失败。');
      return false;
    } finally {
      buttons.forEach(button => { button.disabled = false; });
      originalLabels.forEach((label, button) => { button.textContent = label; });
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
    recognizeReportElements();
    observeReportElementRecognition();
    rememberGlobalDefaults();
    initResetButtons();
    bindGlobalControls();
    bindElementControls();
    bindDeleteControl();
    bindImageReplacementControl();
    bindPreviewExportRequiredDialog();
    refreshElementControls();
    refreshDataGroupAvailability();
    window.setTimeout(applyStoredChartOptions, 0);
    window.addEventListener('load', applyStoredChartOptions, { once: true });
    if (isSinglePageMode()) {
      buildSectionNav();
      bindSectionNavControls();
      setSectionNavStyle(currentSectionNavStyle());
      refreshSectionNavActiveState();
      refreshSinglePageVisibilityControl();
      const download = document.getElementById('downloadHtml');
      if (download && !document.getElementById('htmlExportChoice')) download.onclick = downloadStandaloneHtml;
      bindLongExportDownloads();
    }
  }

  window.HTMLReportEditor = {
    init,
    initAccordionGroups,
    restoreAccordionMarkupForStandalone,
    openAccordionGroup,
    openDrawerGroupByIntent,
    refreshDataGroupAvailability,
    setDataEditContext,
    setRecognitionPickMode,
    applyRecognitionType,
    recognizeReportElements,
    buildSectionNav,
    setSectionNavStyle,
    setCurrentSinglePageVisibility,
    restoreHiddenSinglePageSections,
    removeHiddenPagesFromClone,
    getHtmlExportFileName: htmlExportFileName,
    shortSectionTitle,
    selectElement,
    getSelectedElement: () => selectedElement,
    downloadStandaloneHtml,
    inlineStandaloneAssets,
    exportSnapshotHtml,
    previewServiceAvailable,
    requirePreviewService,
    refreshPreviewExportHint,
    requestInstantExport,
    refreshGlobalControlsFromComputedTypography,
    refreshChartDataControls,
    applyChartDataEditor,
    applyStoredChartOptions,
    replaceSelectedImage,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
