import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function ratio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
const css = readFileSync('src/index.css', 'utf8');
// This catches a washed-out text token across the actual app surfaces in either theme.
it.each([':root', 'html.dark'])('keeps every declared text/background pair readable in %s', selector => {
  const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  const tokens = Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map(match => [match[1], match[2]]));
  for (const name of ['bg-page', 'surface', 'surface-inset', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'primary-text', 'primary-tint', 'success-text', 'success-tint', 'warning-text', 'warning-tint', 'danger-text', 'danger-tint']) expect(tokens[name], `missing ${name}`).toMatch(/^#/);
  for (const text of ['text', 'text-secondary', 'text-muted']) for (const bg of ['bg-page', 'surface', 'surface-inset', 'surface-raised']) expect(ratio(tokens[text], tokens[bg]), `${selector}: ${text}/${bg}`).toBeGreaterThanOrEqual(4.5);
  for (const role of ['primary', 'success', 'warning', 'danger']) for (const bg of [tokens[`${role}-tint`], tokens.surface, tokens['surface-raised']]) expect(ratio(tokens[`${role}-text`], bg), `${selector}: ${role}-text`).toBeGreaterThanOrEqual(4.5);
  // Approved exceptions are white labels on solid primary/success/warning buttons only (spec 3.2.1).
  expect(ratio('#FFFFFF', tokens.danger)).toBeGreaterThanOrEqual(4.5);
});
