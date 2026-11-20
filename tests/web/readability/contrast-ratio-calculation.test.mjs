import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastTools } from './contrast-ratio-calculation.mjs';
const tools = contrastTools(), black = tools.parseColor('#000'), white = tools.parseColor('#fff');
test('black and white are 21:1, regardless of polarity', () => { assert.equal(tools.ratio(black, white), 21); assert.equal(tools.ratio(white, black), 21); });
test(
  'foreground alpha composites before luminance',
  () => { const half = tools.parseColor('rgba(0,0,0,.5)'), result = tools.composite(half, white); assert.deepEqual(result, { r: 127.5, g: 127.5, b: 127.5, a: 1 }); assert.ok(Math.abs(tools.ratio(half, white) - 3.9766530249) < 1e-8); }
);
test(
  'multiple translucent backgrounds preserve painter order',
  () => { const back = tools.composite(tools.parseColor('rgba(0,0,0,.5)'), white), front = tools.composite(tools.parseColor('rgba(255,0,0,.5)'), back); assert.deepEqual(front, { r: 191.25, g: 63.75, b: 63.75, a: 1 }); }
);
test(
  'large text threshold has correct CSS-pixel and bold boundaries',
  () => { assert.equal(tools.threshold(24, 400), 3); assert.equal(tools.threshold(23.99, 400), 4.5); assert.equal(tools.threshold(18.667, 700), 3); assert.equal(tools.threshold(18.667, 500), 4.5); assert.equal(tools.threshold(18, 700), 4.5); }
);
test(
  'unfamiliar colors remain unsupported rather than silently becoming black',
  () => { assert.equal(tools.parseColor('oklch(.5 .2 20)'), null); assert.equal(tools.parseColor('garbage'), null); assert.deepEqual(tools.parseColor('#1234'), { r: 17, g: 34, b: 51, a: 68 / 255 }); }
);
