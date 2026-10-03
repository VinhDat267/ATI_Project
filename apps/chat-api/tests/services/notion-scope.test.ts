import { expect, it } from 'vitest';
import { getServiceDefinition } from '@wap/tool-schemas';
import { normalizeAllowedScope } from '../../src/services/registered-services.js';

it('canonicalizes and deduplicates Notion scope at the API boundary before storing credentials', () => {
  const definition = getServiceDefinition('notion'); expect(definition).toBeDefined();
  expect(normalizeAllowedScope(definition!, [' AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE ', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])).toEqual({ databases: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] });
  expect(normalizeAllowedScope(definition!, { databases: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] })).toEqual({ databases: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] });
  for (const scope of [[], ['bad'], ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'bad'], null]) expect(normalizeAllowedScope(definition!, scope)).toBeNull();
});
