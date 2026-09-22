import { expect, it, describe } from 'vitest';
import {
  loadPilotConfig,
  redactSecrets,
  redactObject,
  type PilotConfig,
} from '../src/pilot/config.js';

describe('pilot/config', () => {
  const sampleConfig: PilotConfig = {
    enabled: true,
    principals: ['operator-a', 'operator-b'],
    spreadsheetId: 'sheet-123',
    tabId: 'tab-requests',
    boardId: 'board-789',
    google: {
      clientEmail: 'service@project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...\n-----END PRIVATE KEY-----',
    },
    trello: {
      apiKey: 'trello-key-abc123xyz',
      apiToken: 'trello-token-secret999',
    },
  };

  it('validates and loads a complete configuration', () => {
    const config = loadPilotConfig(sampleConfig);
    expect(config.enabled).toBe(true);
    expect(config.principals).toEqual(['operator-a', 'operator-b']);
    expect(config.spreadsheetId).toBe('sheet-123');
    expect(config.boardId).toBe('board-789');
  });

  it('fails closed when enabled but required credentials or allowlists are missing', () => {
    expect(() =>
      loadPilotConfig({
        ...sampleConfig,
        spreadsheetId: '',
      }),
    ).toThrow('CONFIG_ERROR');

    expect(() =>
      loadPilotConfig({
        ...sampleConfig,
        principals: [],
      }),
    ).toThrow('CONFIG_ERROR');

    expect(() =>
      loadPilotConfig({
        ...sampleConfig,
        trello: { apiKey: '', apiToken: '' },
      }),
    ).toThrow('CONFIG_ERROR');
  });

  it('allows disabled configuration with minimal empty placeholders without crashing', () => {
    const disabledConfig = loadPilotConfig({
      enabled: false,
      principals: [],
      spreadsheetId: '',
      tabId: '',
      boardId: '',
    });
    expect(disabledConfig.enabled).toBe(false);
  });

  it('redacts configured secrets from string messages and URLs', () => {
    const rawMsg =
      'Request to https://api.trello.com/1/cards?key=trello-key-abc123xyz&token=trello-token-secret999 failed';
    const secrets = [sampleConfig.trello?.apiKey!, sampleConfig.trello?.apiToken!];
    const cleaned = redactSecrets(rawMsg, secrets);
    expect(cleaned).not.toContain('trello-key-abc123xyz');
    expect(cleaned).not.toContain('trello-token-secret999');
    expect(cleaned).toContain('[REDACTED]');
  });

  it('recursively redacts secrets in objects', () => {
    const secrets = ['secret-token-123'];
    const dirtyObj = {
      message: 'Failed with secret-token-123',
      nested: {
        headers: { Authorization: 'Bearer secret-token-123' },
        safe: 42,
      },
    };
    const cleaned = redactObject(dirtyObj, secrets) as typeof dirtyObj;
    expect(cleaned.message).toBe('Failed with [REDACTED]');
    expect(cleaned.nested.headers.Authorization).toBe('Bearer [REDACTED]');
    expect(cleaned.nested.safe).toBe(42);
  });
});
