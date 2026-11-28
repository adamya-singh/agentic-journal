import test from 'node:test';
import assert from 'node:assert/strict';
import { darkCss, darkOf } from '../src/lib/dark-css.ts';

test('a light colour turns dark, ink turns light, an accent stays an accent', () => {
  const [w] = darkOf([255, 255, 255]), [k] = darkOf([34, 19, 10]);
  assert.ok(w < 45 && k > 200);
  const accent = darkOf([168, 84, 28]);
  assert.ok(accent[0] > accent[2] + 60, 'still orange');
});

test('the dark rules restate only colours, under .dark, and leave dark islands and shadows alone', () => {
  const css = `
/* a pane */
.srp{--a:#c2551b;background:#fff;color:#22130a;padding:4px}
.srw-bar{border-bottom:1px solid rgba(60,30,10,.12);box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex}
.xw-cmd{background:#0d1018;color:#f3efe7}
.xw-cmd b,.srw-x{color:#fff}
@keyframes spin{from{color:#000}to{color:#fff}}
@media (max-width:600px){.srw-bar{background:rgba(255,255,255,.5)}.srw-y{display:none}}
.card{background:#fff}`;
  const dark = darkCss(css, { under: '.dark', root: '.srp', only: /\.(srp|srw|xw)/, keep: /\.xw-cmd(?![\w-])/ });
  assert.match(dark, /\.dark \.srp\{--a:rgb\([^)]+\);background:rgb\([^)]+\);color:rgb\([^)]+\)\}/);
  assert.match(dark, /\.dark \.srw-bar\{border-bottom:1px solid rgb\(\d+ \d+ \d+ \/ 0\.12\)\}/);
  assert.ok(!dark.includes('box-shadow') && !dark.includes('padding') && !dark.includes('display'));
  assert.ok(!dark.includes('.xw-cmd'), 'a block that is dark in daylight stays as it is');
  assert.match(dark, /\.dark \.srw-x\{color:/);
  assert.match(dark, /@media \(max-width:600px\)\{\.dark \.srw-bar\{background:rgb\(\d+ \d+ \d+ \/ 0\.5\)\}\}/);
  assert.ok(!dark.includes('spin') && !dark.includes('.card'));
  assert.equal(darkCss('.a{color:#fff}', { under: '.dark .srp' }).trim(), `.dark .srp .a{color:rgb(${darkOf([255, 255, 255]).join(' ')})}`);
});
