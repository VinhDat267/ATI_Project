import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyExactFreeTierPrice } from './pilot-quality-pricing.mjs';

const model = 'gemini-3.7-flash';
const title = 'Gemini 3.7 Flash';
function page(inputPrice, outputPrice) {
  return `<h2>${title}</h2><p>${model}</p><h3>Standard</h3><table>
    <tr><th>Free Tier</th><th>Paid Tier</th></tr>
    <tr><td>Input price</td><td>${inputPrice}</td></tr>
    <tr><td>Output price (including thinking tokens)</td><td>${outputPrice}</td></tr>
    </table><h3>Batch</h3><p>Free of charge</p><h2>Another model</h2>`;
}

test('accepts exact model standard input and output free tier', () => {
  assert.doesNotThrow(() => verifyExactFreeTierPrice(page('Free of charge', 'Free of charge'), model, title));
});

test('does not borrow free wording from another section or next model', () => {
  assert.throws(() => verifyExactFreeTierPrice(page('$1', '$2'), model, title), /MODEL_FREE_TIER_PRICE_NOT_FOUND/);
  assert.throws(() => verifyExactFreeTierPrice('<h2>Another model</h2><h3>Standard</h3>Free of charge', model, title),
    /MODEL_PRICE_SECTION_NOT_FOUND/);
});

test('rejects a paid output even with free input', () => {
  assert.throws(() => verifyExactFreeTierPrice(page('Free of charge', '$1'), model, title),
    /MODEL_FREE_TIER_PRICE_NOT_FOUND/);
});
