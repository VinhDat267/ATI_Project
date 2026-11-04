import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPlaybooks,
  savePlaybook,
  deletePlaybook,
  quarantineLegacyV1,
  PLAYBOOK_STORAGE_PREFIX,
  LEGACY_STORAGE_KEY,
  QUARANTINE_STORAGE_KEY,
  type CustomPlaybook,
} from '../../src/services/playbook-storage';

describe('Playbook Storage Isolation (FLOW-02, F2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const samplePlaybook: CustomPlaybook = {
    id: 'pb-1',
    title: 'Báo cáo cá nhân của A',
    prompt: 'Báo cáo công việc tuần này',
    services: ['github', 'slack'],
  };

  it('isolates playbooks between User A and User B on the same browser', () => {
    const userA = 'user_alpha';
    const userB = 'user_beta';
    const ws = 'personal';

    // User A saves a playbook
    const resA = savePlaybook(userA, ws, samplePlaybook);
    expect(resA.success).toBe(true);

    // User A can load their playbook
    const playbooksA = loadPlaybooks(userA, ws);
    expect(playbooksA).toHaveLength(1);
    expect(playbooksA[0]?.title).toBe('Báo cáo cá nhân của A');

    // User B on the same browser cannot see User A's playbook
    const playbooksB = loadPlaybooks(userB, ws);
    expect(playbooksB).toHaveLength(0);

    // User B cannot delete User A's playbook
    const deleted = deletePlaybook(userB, ws, 'pb-1');
    expect(deleted).toBe(false);

    // User A's playbook is still intact
    expect(loadPlaybooks(userA, ws)).toHaveLength(1);
  });

  it('isolates playbooks between personal workspace and organization workspace for the same user', () => {
    const userA = 'user_alpha';
    savePlaybook(userA, 'personal', {
      id: 'pb-personal',
      title: 'Personal playbook',
      prompt: 'Personal prompt',
      services: ['calendar'],
    });

    savePlaybook(userA, 'org_team_123', {
      id: 'pb-org',
      title: 'Org team playbook',
      prompt: 'Org prompt',
      services: ['jira', 'slack'],
    });

    const personalList = loadPlaybooks(userA, 'personal');
    const orgList = loadPlaybooks(userA, 'org_team_123');

    expect(personalList).toHaveLength(1);
    expect(personalList[0]?.id).toBe('pb-personal');

    expect(orgList).toHaveLength(1);
    expect(orgList[0]?.id).toBe('pb-org');
  });

  it('enforces maximum limit of 12 playbooks and rejects the 13th with explicit error', () => {
    const user = 'user_limit';
    const ws = 'personal';

    // Save 12 playbooks
    for (let i = 1; i <= 12; i++) {
      const res = savePlaybook(user, ws, {
        id: `pb-${i}`,
        title: `Playbook ${i}`,
        prompt: `Prompt ${i}`,
        services: ['slack'],
      });
      expect(res.success).toBe(true);
    }

    expect(loadPlaybooks(user, ws)).toHaveLength(12);

    // Attempting to save the 13th playbook must fail with explicit quota error
    const res13 = savePlaybook(user, ws, {
      id: 'pb-13',
      title: 'Playbook 13',
      prompt: 'Prompt 13',
      services: ['slack'],
    });

    expect(res13.success).toBe(false);
    expect(res13.error).toMatch(/PLAYBOOK_QUOTA_EXCEEDED|12/i);

    // The list must remain at 12, without silently dropping existing ones
    const currentList = loadPlaybooks(user, ws);
    expect(currentList).toHaveLength(12);
    expect(currentList[0]?.id).toBe('pb-12');
    expect(currentList[11]?.id).toBe('pb-1');
  });

  it('quarantines legacy v1 unowned playbooks without assigning them to first login user', () => {
    const legacyData = JSON.stringify([
      { id: 'old-1', title: 'Mẫu bí mật cũ', prompt: 'Prompt cũ', services: ['gmail'] },
    ]);
    localStorage.setItem(LEGACY_STORAGE_KEY, legacyData);

    // Run quarantine migration
    quarantineLegacyV1();

    // Legacy key must be cleared after quarantine
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    // Quarantine key must contain the preserved legacy data
    expect(localStorage.getItem(QUARANTINE_STORAGE_KEY)).toBe(legacyData);

    // A new user logging in does NOT automatically inherit the unowned legacy playbooks
    const freshUserPlaybooks = loadPlaybooks('user_new', 'personal');
    expect(freshUserPlaybooks).toHaveLength(0);
  });

  it('gracefully handles corrupted JSON in storage without throwing', () => {
    const user = 'user_corrupt';
    const ws = 'personal';
    const key = `${PLAYBOOK_STORAGE_PREFIX}:${user}:${ws}`;

    localStorage.setItem(key, 'invalid-non-json{{{{');

    expect(() => {
      const list = loadPlaybooks(user, ws);
      expect(list).toEqual([]);
    }).not.toThrow();
  });

  it('rejects anonymous or empty userId to prevent shared unauthenticated storage leakage', () => {
    const resAnon = savePlaybook('anonymous', 'personal', samplePlaybook);
    expect(resAnon.success).toBe(false);
    expect(resAnon.error).toMatch(/PLAYBOOK_AUTH_REQUIRED/i);

    const resEmpty = savePlaybook('   ', 'personal', samplePlaybook);
    expect(resEmpty.success).toBe(false);
    expect(resEmpty.error).toMatch(/PLAYBOOK_AUTH_REQUIRED/i);

    expect(loadPlaybooks('anonymous', 'personal')).toEqual([]);
    expect(loadPlaybooks('', 'personal')).toEqual([]);
    expect(deletePlaybook('anonymous', 'personal', 'pb-1')).toBe(false);
  });
});
