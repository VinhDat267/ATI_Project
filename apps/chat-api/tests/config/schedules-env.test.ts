import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('SCHEDULES_ENABLED policy', () => {
  it('is on by default and when empty', () => {
    expect(validateEnv({}).SCHEDULES_ENABLED).toBe(true);
    expect(validateEnv({ SCHEDULES_ENABLED: '' }).SCHEDULES_ENABLED).toBe(true);
    expect(validateEnv({ SCHEDULES_ENABLED: 'on' }).SCHEDULES_ENABLED).toBe(true);
  });

  it('is off only for the exact value off', () => {
    expect(validateEnv({ SCHEDULES_ENABLED: 'off' }).SCHEDULES_ENABLED).toBe(false);
  });

  it.each(['true', 'ON', '1', 'yes', 'false', 'OFF', '0', 'no'])('rejects the flag value %j', (value) => {
    expect(() => validateEnv({ SCHEDULES_ENABLED: value })).toThrow('SCHEDULES_ENABLED must be on or off');
  });
});
