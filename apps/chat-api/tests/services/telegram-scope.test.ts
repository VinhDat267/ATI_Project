import { expect, it } from 'vitest';
import { getServiceDefinition } from '@wap/tool-schemas';
import { normalizeAllowedScope } from '../../src/services/registered-services.js';

it('normalizes signed chat IDs without Number precision loss and rejects incomplete scopes', () => {
  const service = getServiceDefinition('telegram'); expect(service).toBeDefined();
  expect(normalizeAllowedScope(service!, [' -001001234567890 ', '-1001234567890', '00042', '99999999999999999999'])).toEqual({ chats: ['-1001234567890', '42', '99999999999999999999'] });
  expect(normalizeAllowedScope(service!, { chats: ['42'] })).toEqual({ chats: ['42'] });
  for (const value of [[], {}, [''], ['42', '@outside'], [42], ['+42'], ['9'.repeat(21)]]) expect(normalizeAllowedScope(service!, value)).toBeNull();
});
