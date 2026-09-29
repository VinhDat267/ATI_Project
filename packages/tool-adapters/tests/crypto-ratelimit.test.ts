import { describe, it, expect } from 'vitest';
import {
  encryptCredentials,
  decryptCredentials,
  GlobalRateLimiter,
  BaseAdapter,
  StepError,
  type ErrorCategory,
} from '../src/index.js';

describe('packages/tool-adapters (Task 3: Crypto, Rate Limiter & Base Adapter)', () => {
  const secretKey = '01234567890123456789012345678901'; // 32 bytes

  describe('Credential Encryption (AES-256-GCM)', () => {
    it('encrypts and decrypts credentials with format v1:iv:tag:ciphertext', () => {
      const raw = { apiKey: 'trello-key-123', token: 'trello-token-456' };
      const encrypted = encryptCredentials(raw, secretKey);

      expect(encrypted.startsWith('v1:')).toBe(true);
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');

      const decrypted = decryptCredentials<typeof raw>(encrypted, secretKey);
      expect(decrypted).toEqual(raw);
    });

    it('rejects tampered ciphertext or wrong secret key', () => {
      const raw = { apiKey: 'secret' };
      const encrypted = encryptCredentials(raw, secretKey);
      const wrongKey = '99999999999999999999999999999999';

      expect(() => decryptCredentials(encrypted, wrongKey)).toThrow();

      // Tamper ciphertext part
      const parts = encrypted.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:AAAA`;
      expect(() => decryptCredentials(tampered, secretKey)).toThrow();
    });

    it('rejects invalid format without v1 prefix', () => {
      expect(() => decryptCredentials('invalid:format', secretKey)).toThrow(
        /Invalid encrypted credentials format/i
      );
    });
  });

  describe('GlobalRateLimiter', () => {
    it('enforces rate limiting tokens per window and resets', async () => {
      const limiter = new GlobalRateLimiter({ maxRequests: 2, windowMs: 50 });

      expect(await limiter.acquire('trello')).toBe(true);
      expect(await limiter.acquire('trello')).toBe(true);
      expect(await limiter.acquire('trello')).toBe(false);

      // Different key is unaffected
      expect(await limiter.acquire('slack')).toBe(true);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(await limiter.acquire('trello')).toBe(true);

      // Manual reset
      limiter.reset('trello');
      expect(await limiter.acquire('trello')).toBe(true);
    });
  });

  describe('BaseAdapter & StepError', () => {
    it('creates StepError with appropriate categories and retryable flag', () => {
      const error = new StepError({
        message: 'Rate limit exceeded',
        category: 'RATE_LIMIT',
        statusCode: 429,
        retryable: true,
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('StepError');
      expect(error.category).toBe('RATE_LIMIT');
      expect(error.statusCode).toBe(429);
      expect(error.retryable).toBe(true);
    });

    it('validates allowed scope for boards and channels in BaseAdapter subclass', async () => {
      class TestAdapter extends BaseAdapter {
        public service = 'test';

        async execute(toolName: string, args: Record<string, any>): Promise<any> {
          if (args.boardId) {
            this.assertAllowedScope('board', args.boardId);
          }
          if (args.channelId) {
            this.assertAllowedScope('channel', args.channelId);
          }
          return { success: true };
        }
      }

      const adapter = new TestAdapter({
        allowedScope: {
          boards: ['board_allowed_1'],
          channels: ['C_GENERAL'],
        },
      });

      // Allowed access
      await expect(adapter.execute('test.run', { boardId: 'board_allowed_1' })).resolves.toEqual({
        success: true,
      });
      await expect(adapter.execute('test.run', { channelId: 'C_GENERAL' })).resolves.toEqual({
        success: true,
      });

      // Denied board
      await expect(adapter.execute('test.run', { boardId: 'board_forbidden' })).rejects.toThrow(
        /Allowed scope restriction/i
      );

      // Denied channel
      await expect(adapter.execute('test.run', { channelId: 'C_SECRET' })).rejects.toThrow(
        /Allowed scope restriction/i
      );
    });
  });
});
