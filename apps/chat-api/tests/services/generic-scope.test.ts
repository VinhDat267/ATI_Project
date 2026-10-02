import { expect, it } from 'vitest';
import { normalizeAllowedScope } from '../../src/services/registered-services.js';
import { SERVICE_REGISTRY, type ServiceDefinition } from '@wap/tool-schemas';

const definition: ServiceDefinition = {
  id: 'demo', name: 'Demo', description: 'Test contract', scopeKey: 'projects', scopeLabel: 'Project key',
  scopePattern: /^P\d+$/g, scopes: [], credentialFields: [{ key: 'secret', label: 'Secret', type: 'multiline' }], intentKeywords: ['demo'],
};

it('normalizes custom scope keys using the definition pattern, without mutable regexp state', () => {
  expect(normalizeAllowedScope(definition, [' P1 ', 'P1', 'P2'])).toEqual({ projects: ['P1', 'P2'] });
  expect(normalizeAllowedScope(definition, { projects: ['P2', 'P1'] })).toEqual({ projects: ['P2', 'P1'] });
  expect(normalizeAllowedScope(definition, ['wrong'])).toBeNull();
  expect(definition.scopePattern!.lastIndex).toBe(0);
});

it.each([null, [], [''], ['P1', 2], { projects: 'P1' }])('rejects malformed or empty scopes %j', value => {
  expect(normalizeAllowedScope(definition, value)).toBeNull();
});

it('keeps repository validation in GitHub metadata', () => {
  const github = SERVICE_REGISTRY.find(service => service.id === 'github')!;
  expect(normalizeAllowedScope(github, ['owner/repo'])).toEqual({ repos: ['owner/repo'] });
  expect(normalizeAllowedScope(github, ['owner'])).toBeNull();
  expect(github.scopeLabel).toBe('Repository');
});
