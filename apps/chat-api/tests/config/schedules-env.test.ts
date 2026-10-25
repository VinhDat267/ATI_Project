import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('SCHEDULES_ENABLED policy', () => {
  it('is off by default and when empty', () => {
    expect(validateEnv({}).SCHEDULES_ENABLED).toBe(false);
    expect(validateEnv({ SCHEDULES_ENABLED: '' }).SCHEDULES_ENABLED).toBe(false);
    expect(validateEnv({ SCHEDULES_ENABLED: 'off' }).SCHEDULES_ENABLED).toBe(false);
  });

  it('is on only for the exact value on', () => {
    expect(validateEnv({ SCHEDULES_ENABLED: 'on' }).SCHEDULES_ENABLED).toBe(true);
  });

  it.each(['true', 'ON', '1', 'yes'])('rejects the flag value %j', (value) => {
    expect(() => validateEnv({ SCHEDULES_ENABLED: value })).toThrow('SCHEDULES_ENABLED must be on or off');
  });
});
