import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';

it('removes the retired ServiceCard from the product tree after migrating its behavior to SettingsPage', () => {
  expect(existsSync('src/components/ServiceCard.tsx')).toBe(false);
});
