// Runs in the page: it is sent there as its own source text, so it can use nothing but its argument and the page.
export function collectVisibleText(tools) {
  const results = [], skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const up = node => node.parentElement || node.getRootNode()?.host || null;
  const shortSelector = element => {
    if (element.id) return `#${element.id}`;
    const parent = up(element);
    const prefix = parent?.id ? `#${parent.id} > ` : '';
    return prefix + element.localName + [...element.classList].slice(0, 3).map(name => `.${name}`).join('');
  };
  const all = root => [...root.querySelectorAll('*')].flatMap(element => element.shadowRoot ? [element, ...all(element.shadowRoot)] : [element]);
  const elements = all(document);
  const topDialog = [...document.querySelectorAll('dialog[open]')].filter(element => element.matches(':modal')).at(-1);
  const media = elements.filter(element => ['img', 'video', 'canvas', 'svg'].includes(element.localName.toLowerCase())).map(element => ({ element, rect: element.getBoundingClientRect() })).filter(item => item.rect.width > 0 && item.rect.height > 0);
  const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  function visibleRects(element, range) {
    let rects = [...(range ? range.getClientRects() : element.getClientRects())].filter(rect => rect.width > 1 && rect.height > 1 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight);
    for (let at = element; at && rects.length; at = up(at)) {
      const style = getComputedStyle(at);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return [];
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const box = at.getBoundingClientRect();
        rects = rects.filter(rect => overlaps(rect, box));
      }
    }
    return rects;
  }
  function measure(element, text, kind, style, rects) {
    const reasons = new Set(), layers = [];
    let opaque = false;
    for (let at = element; at; at = up(at)) {
      const computed = getComputedStyle(at);
      if (Number(computed.opacity) !== 1) reasons.add('ancestor opacity');
      if (computed.filter !== 'none' || computed.backdropFilter !== 'none') reasons.add('filter or backdrop filter');
      if (computed.mixBlendMode !== 'normal') reasons.add('blend mode');
      if (computed.boxShadow.includes('inset')) reasons.add('inset box shadow');
      for (const pseudo of ['::before', '::after']) {
        const decoration = getComputedStyle(at, pseudo);
        if (!['none', 'normal'].includes(decoration.content) && decoration.display !== 'none' && decoration.visibility === 'visible' && Number(decoration.opacity) !== 0) reasons.add('pseudo-element decoration');
      }
      if (!opaque) {
        if (computed.backgroundImage !== 'none') reasons.add('gradient or background image');
        const color = tools.parseColor(computed.backgroundColor);
        if (!color) reasons.add('unsupported background color space');
        else { if (color.a) layers.unshift(color); if (color.a === 1) opaque = true; }
      }
    }
    if (!opaque) reasons.add('no opaque CSS background established');
    if (style.textShadow !== 'none') reasons.add('text shadow');
    if (kind === 'placeholder' && Number(style.opacity) !== 1) reasons.add('placeholder opacity');
    if (element.matches('select')) reasons.add('native select rendering');
    for (const item of media) if (item.element !== element && rects.some(rect => overlaps(rect, item.rect))) reasons.add(`${item.element.localName.toLowerCase()} overlaps text bounds`);
    const colorText = kind === 'placeholder' ? style.color : element instanceof SVGElement ? style.fill : style.webkitTextFillColor || style.color;
    const foreground = tools.parseColor(colorText);
    if (!foreground) reasons.add('unsupported foreground color space');
    const background = layers.reduce((base, layer) => tools.composite(layer, base), { r: 0, g: 0, b: 0, a: 0 });
    const fontSize = parseFloat(style.fontSize), fontWeight = Number(style.fontWeight) || 400;
    const required = tools.threshold(fontSize, fontWeight);
    const calculatedRatio = foreground && background.a === 1 ? tools.ratio(foreground, background) : null;
    const status = reasons.size ? 'manual' : calculatedRatio >= required ? 'passed' : 'failed';
    results.push({
      selector: shortSelector(element), kind, text: text.trim().replace(/\s+/gu, ' ').slice(0, 180), status, reasons: [...reasons], foreground: colorText,
      computedColor: style.color, backgroundLayers: layers, effectiveBackground: background, ratio: reasons.size ? null : calculatedRatio,
      estimatedSolidOnlyRatio: reasons.size ? calculatedRatio : null, required, fontSize, fontWeight
    });
  }
  for (const element of elements) {
    if (element.closest('script, style, template, noscript')) continue;
    const nodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const field = element.matches('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="password"]), textarea, select');
    if (!nodes.length && !field) continue;
    if (topDialog && !topDialog.contains(element)) { skip('behind modal'); continue; }
    if (element.closest(':disabled, [aria-disabled="true"], [inert]')) { skip('inactive control'); continue; }
    const style = getComputedStyle(element);
    if (element.matches('option, optgroup')) continue;
    for (const node of nodes) {
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = visibleRects(element, range);
      if (!rects.length) { skip('hidden, clipped, or outside viewport'); continue; }
      measure(element, node.textContent, 'text', style, rects);
    }
    if (field) {
      const rects = visibleRects(element);
      if (!rects.length) { skip('hidden field or outside viewport'); continue; }
      if (element.matches('select')) measure(element, element.selectedOptions[0]?.textContent || '', 'selected option', style, rects);
      else if (!element.value && element.placeholder) measure(element, element.placeholder, 'placeholder', getComputedStyle(element, '::placeholder'), rects);
      // Input values are deliberately not collected: this is visual QA, not a form-data logger.
    }
  }
  const counts = Object.fromEntries(['passed', 'failed', 'manual'].map(status => [status, results.filter(item => item.status === status).length]));
  return { seen: results.length, counts, skipped, results, viewport: { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY } };
}
