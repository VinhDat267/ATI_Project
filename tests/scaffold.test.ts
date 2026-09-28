import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('V3 Monorepo Scaffolding & Config', () => {
  const pkgs = [
    'packages/tool-schemas',
    'packages/tool-adapters',
    'packages/planner',
    'packages/executor',
    'apps/chat-api',
  ];

  it('verifies all packages have exports and tsconfig setup', () => {
    expect(existsSync(resolve('vitest.workspace.ts')), 'missing vitest.workspace.ts').toBe(true);
    expect(existsSync(resolve('.env.example')), 'missing .env.example').toBe(true);

    for (const pkg of pkgs) {
      expect(existsSync(resolve(pkg, 'package.json')), `missing ${pkg}/package.json`).toBe(true);
      expect(existsSync(resolve(pkg, 'tsconfig.json')), `missing ${pkg}/tsconfig.json`).toBe(true);
      const pkgJson = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8'));
      expect(pkgJson.name).toMatch(/^@wap\//);
      expect(pkgJson.exports).toBeDefined();
      expect(pkgJson.exports['.']).toBe('./src/index.ts');
    }
  });
});
