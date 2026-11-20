// Adapted from an earlier application's browser contrast and coverage checks.
// Product selectors, theme rewriting, and black/white-only text rules are omitted.
// W3C contrast method: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
// Relative luminance: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
export function contrastTools() {
  const clamp = value => Math.max(0, Math.min(1, value));
  function parseColor(value) {
    const text = String(value).trim().toLowerCase();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (/^#[0-9a-f]{3,8}$/u.test(text)) {
      let hex = text.slice(1);
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map(part => part + part).join('');
      if (![6, 8].includes(hex.length)) return null;
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
    }
    const match = text.match(/^rgba?\((.+)\)$/u);
    if (match) {
      const values = match[1].trim().split(/[\s,/]+/u);
      if (values.length < 3 || values.length > 4) return null;
      const channels = values.slice(0, 3).map(item => item.endsWith('%') ? Number(item.slice(0, -1)) * 2.55 : Number(item));
      const alpha = values[3] ?? '1';
      const a = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
      if (![...channels, a].every(Number.isFinite)) return null;
      return { r: clamp(channels[0] / 255) * 255, g: clamp(channels[1] / 255) * 255, b: clamp(channels[2] / 255) * 255, a: clamp(a) };
    }
    const srgb = text.match(/^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+))?\)$/u);
    if (srgb) return { r: clamp(Number(srgb[1])) * 255, g: clamp(Number(srgb[2])) * 255, b: clamp(Number(srgb[3])) * 255, a: clamp(Number(srgb[4] ?? 1)) };
    return null;
  }
  function composite(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (!a) return { r: 0, g: 0, b: 0, a: 0 };
    const channel = key => (top[key] * top.a + bottom[key] * bottom.a * (1 - top.a)) / a;
    return { r: channel('r'), g: channel('g'), b: channel('b'), a };
  }
  function luminance(color) {
    return [color.r, color.g, color.b].map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  }
  function ratio(foreground, background) {
    const drawn = composite(foreground, background);
    const a = luminance(drawn), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }
  function threshold(fontSize, fontWeight) {
    return fontSize >= 24 || (fontSize >= 18.666666 && fontWeight >= 700) ? 3 : 4.5;
  }
  return { parseColor, composite, luminance, ratio, threshold };
}
